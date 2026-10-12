/**
 * File Name: section-css.ts
 * Purpose: A block's own raw CSS (X-T1) in the extension - where it is
 *          stored on the block, what the inspector tells the designer about
 *          it, and the page CSS the canvas previews and publish writes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Stored as `_studio.css` on the block, beside the
 *          classes it wears. The wrapper key is reserved to Studio, so it
 *          cannot collide with a developer's `css` prop, and it rides the
 *          block through draft, revision, publish and Porter for free - the
 *          platform already carries the bag.
 *
 *          The compiler owns the selector and the refusals (section-css.ts
 *          in @tangen/studio-compiler): the designer writes declarations,
 *          the compiler wraps them in `.tg-s-<key>` and judges each one by
 *          the block's protection. This module does not re-implement any of
 *          that; it reads the compiler's answer and shapes it for a panel.
 *
 *          The page's own raw CSS (X-T2) lives in Studio's store under
 *          `page:<objectId>` - the object's values are the type's fields and
 *          the platform refuses an unknown key, so the page settings store
 *          is the extension's, beside `class:` and `tag:`. It is scoped by
 *          the compiler to the page's top-level blocks (page-css.ts explains
 *          why: the runtime stamps no page root).
 *
 *          `pageStyles` is the ONE function both edges call. The canvas has
 *          unsaved blocks in hand and compiles client-side; publish reads the
 *          published snapshot and compiles server-side. Same function, same
 *          input shape, same bytes - the draft-parity rule Studio holds for
 *          the workspace stylesheet, extended to the page's own CSS.
 *
 *          Browser-safe: the compiler's root export carries no node imports.
 */
import { compileStyles, sectionsFromBlocks, topLevelBlocks, rawCssError, type Refusal } from '@tangen/studio-compiler'
import type { BlockProtection } from '@tangen/studio-schema'
import { writeWrapper } from './wrapper'
import { blockProtection } from './style-protection'

/** The wrapper field the raw CSS lives under. */
export const SECTION_CSS_FIELD = 'css'

/**
 * What the governance audit calls a section raw-CSS edit - one name, so the
 * trail can answer "who stepped outside the tokens, on what" for sections
 * the way it does for classes (`custom`).
 */
export const SECTION_CSS_OVERRIDE = 'section-css'

type Block = Record<string, unknown>

/** The block's raw CSS, or '' for none. Reads the bag only - a flat `css` prop is the developer's. */
export function readSectionCss(block: Block | null | undefined): string {
  const bag = block?._studio
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return ''
  const v = (bag as Record<string, unknown>)[SECTION_CSS_FIELD]
  return typeof v === 'string' ? v : ''
}

/** Writes the block's raw CSS, immutably. Blank clears it. */
export function writeSectionCss(block: Block, css: string): Block {
  const value = typeof css === 'string' ? css.trim() : ''
  // The write goes through the shared writer so the bag is folded and
  // pruned the same way every other wrapper value is.
  return writeWrapper(block, SECTION_CSS_FIELD, value === '' ? undefined : value)
}

export interface SectionCssState {
  /** The sanitiser's reason the text cannot be used at all, or null. */
  error: string | null
  /** Declarations the block's protection refused, with the compiler's reason each. */
  refused: Refusal[]
}

/**
 * What the inspector shows under the box: the sanitiser's error when the
 * text is not a declaration list, else the declarations protection refused.
 * Both come from the compiler, so the panel says exactly what publish will do.
 */
export function sectionCssState(input: {
  key: string
  blockType: string
  css: string
  protection: BlockProtection | undefined
}): SectionCssState {
  const css = typeof input.css === 'string' ? input.css : ''
  if (css.trim() === '') return { error: null, refused: [] }
  const error = rawCssError(css)
  if (error) return { error, refused: [] }
  const out = compileStyles({
    sections: [{ key: input.key, blockType: input.blockType, css }],
    protections: input.protection ? { [input.blockType]: input.protection } : {},
  })
  return { error: null, refused: out.refused }
}

/**
 * The protection map the compiler wants, from the component defs the editor
 * holds - the same reader the Style panel uses for the selected block, so
 * the two cannot disagree about a Block's level.
 */
export function protectionsFromDefs(defs: ReadonlyArray<unknown>): Record<string, BlockProtection> {
  const out: Record<string, BlockProtection> = {}
  for (const def of defs ?? []) {
    if (!def || typeof def !== 'object') continue
    const name = (def as { name?: unknown }).name
    if (typeof name !== 'string' || !name) continue
    const protection = blockProtection(def)
    if (protection) out[name] = protection
  }
  return out
}

/**
 * What the page inspector shows under the page's own box (X-T2): the
 * sanitiser's error, else what each top-level block's protection refused.
 */
export function pageCssState(input: {
  css: string
  blocks: unknown
  protections: Record<string, BlockProtection>
}): SectionCssState {
  const css = typeof input.css === 'string' ? input.css : ''
  if (css.trim() === '') return { error: null, refused: [] }
  const error = rawCssError(css)
  if (error) return { error, refused: [] }
  const out = compileStyles({ page: { css, blocks: topLevelBlocks(input.blocks) }, protections: input.protections })
  return { error: null, refused: out.refused }
}

/**
 * The page's own CSS: the page-level raw CSS scoped to its top-level blocks
 * (X-T2), then every section's raw CSS (X-T1), compiled and scoped. Called
 * by the canvas with the blocks in hand and by publish with the published
 * snapshot, so the two cannot drift.
 */
export function pageStyles(input: {
  blocks: unknown
  protections: Record<string, BlockProtection>
  /** The page-level raw CSS, as stored with the page. Absent or blank means none. */
  page?: string
}): { css: string; refused: Refusal[] } {
  const sections = sectionsFromBlocks(input.blocks)
  const page = typeof input.page === 'string' && input.page.trim() !== ''
    ? { css: input.page, blocks: topLevelBlocks(input.blocks) }
    : undefined
  if (sections.length === 0 && !page) return { css: '', refused: [] }
  const out = compileStyles({ sections, page, protections: input.protections })
  return { css: out.css, refused: out.refused }
}
