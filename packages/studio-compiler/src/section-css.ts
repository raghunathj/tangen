/**
 * File Name: section-css.ts
 * Purpose: Per-section raw CSS - the declarations a designer wrote on ONE
 *          block, compiled into a single-class rule unique to that block and
 *          refused, per declaration, by the block's protection.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Escape hatches are legitimate: without one, the tweak
 *          a campaign needs becomes a developer ticket. What makes this one
 *          safe to offer is that the designer writes DECLARATIONS and the
 *          compiler owns the SELECTOR. The selector is `.tg-s-<key>`, one
 *          class the runtime stamps on the block's wrapper, so:
 *
 *          - the no-combinator invariant holds - a rule that names one class
 *            cannot reach inside a Block or into a neighbour, whatever the
 *            text says, because the text is never a selector;
 *          - one bad declaration breaks one section, not the site, which
 *            Shopify's unscoped snippet injection cannot say;
 *          - protection is not weakened to fit raw text. Each declaration is
 *            parsed and judged by `styleAccess` exactly as a class property
 *            is, so a Guided root refuses `display` here too, with the
 *            reason, and keeps the declarations beside it.
 *
 *          Emitted AFTER the workspace stylesheet. Section CSS is the most
 *          specific intent a page carries ("this section"), so it wins over
 *          any class the block wears, at every breakpoint - a designer who
 *          wrote it meant it for this block.
 *
 *          The selector is derived from the block key, so the output is
 *          stable across edits and sorted by key, so two pages with the same
 *          sections compile to the same bytes whatever order they arrived
 *          in - the artifact id is a hash of this.
 */
import { styleAccess, sectionClassName, type BlockProtection } from '@tangen/studio-schema'
import { rawCssError, splitDeclarations, RAW_CSS_FORBIDDEN } from './raw-css'
import type { Refusal } from './enforce'

export { rawCssError, safeRawCss, splitDeclarations, MAX_RAW_CSS, RAW_CSS_FORBIDDEN } from './raw-css'

/** One block's raw CSS, as the page declares it. */
export interface SectionStyle {
  /** The block's `_key` - what the generated class is derived from. */
  key: string
  /** The block's `_type` - what its protection is looked up by. */
  blockType: string
  /** The declaration list the designer wrote. */
  css: string
}

export interface SectionStylesInput {
  sections?: SectionStyle[]
  /** Protection declared per block type. An absent entry means Open. */
  protections?: Record<string, BlockProtection>
}

export interface CompiledSectionStyles {
  css: string
  refused: Refusal[]
}

/** The whole block was refused, not one declaration of it. */
export const WHOLE_BLOCK = '*'

/** A property name a browser would parse: `color`, `-webkit-x`, `--custom`. */
const PROPERTY_NAME = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/

/** A value that cannot terminate its own rule. Semicolons are fine here - the list is already split. */
function declarationValueError(value: string): string | null {
  if (value === '') return 'has no value'
  if (/[{}<>]/.test(value)) return 'cannot contain braces or angle brackets'
  const lower = value.toLowerCase()
  for (const [needle, reason] of RAW_CSS_FORBIDDEN) {
    if (lower.includes(needle)) return reason
  }
  return null
}

/** One declaration, split at its first colon. */
function parseDeclaration(text: string): { property: string; value: string } | null {
  const at = text.indexOf(':')
  if (at <= 0) return null
  const property = text.slice(0, at).trim().toLowerCase()
  const value = text.slice(at + 1).trim()
  if (!PROPERTY_NAME.test(property)) return null
  return { property, value }
}

/**
 * Compiles the sections of a page. Every refusal carries the generated class
 * as its `rule` and the declaration's property (or `*` for the whole block),
 * so a panel can show the designer exactly what did not make it and why.
 */
export function compileSectionStyles(input: SectionStylesInput): CompiledSectionStyles {
  const refused: Refusal[] = []
  const rules: string[] = []

  const sections = [...(input.sections ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (const section of sections) {
    const raw = typeof section.css === 'string' ? section.css.trim() : ''
    if (raw === '') continue

    const className = sectionClassName(section.key)
    const rule = className ?? `tg-s-${String(section.key)}`
    if (!className) {
      refused.push({ rule, property: WHOLE_BLOCK, reason: 'This block\'s key cannot be a class name, so its custom CSS has nowhere to land' })
      continue
    }

    // The whole block first, for the refusals that are about the text
    // rather than any one declaration - a brace anywhere means the author
    // pasted a rule, and no part of it is a declaration list.
    const error = rawCssError(raw)
    if (error) {
      refused.push({ rule, property: WHOLE_BLOCK, reason: error })
      continue
    }

    const protection = input.protections?.[section.blockType]
    const decls: string[] = []
    for (const text of splitDeclarations(raw)) {
      const parsed = parseDeclaration(text)
      if (!parsed) {
        refused.push({ rule, property: text.split(':')[0].trim() || text, reason: `"${text}" is not a property:value declaration` })
        continue
      }
      const valueError = declarationValueError(parsed.value)
      if (valueError) {
        refused.push({ rule, property: parsed.property, reason: `"${parsed.property}" ${valueError}` })
        continue
      }
      // The same judge as a class property on this block's root. A custom
      // property (`--x`) is not in any registry, and protection has no
      // opinion about it, so it passes like any unlisted property would.
      const access = styleAccess({ protection, scope: 'workspace', target: { kind: 'root' }, propertyId: parsed.property })
      if (!access.allowed) {
        refused.push({ rule, property: parsed.property, reason: access.reason ?? `"${parsed.property}" is refused on this Block` })
        continue
      }
      decls.push(`${parsed.property}:${parsed.value}`)
    }

    // A block left with nothing to say is dropped rather than emitted empty.
    if (decls.length > 0) rules.push(`.${className}{${decls.join(';')}}`)
  }

  return { css: rules.join(''), refused }
}

/** A block as the platform stores it, loosely. */
type AnyRecord = Record<string, unknown>

const isRecord = (v: unknown): v is AnyRecord => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Every block on a page that carries raw CSS, however deeply nested - the
 * input `compileSectionStyles` wants, read from a block tree.
 *
 * Reads `_studio.css` only: the wrapper lives under the reserved key by
 * design, and a flat `css` prop would be the developer's own. Hidden blocks
 * are skipped - the runtime renders nothing for them, and a rule for an
 * element that is not there is dead weight in the artifact.
 */
export function sectionsFromBlocks(blocks: unknown): SectionStyle[] {
  const out: SectionStyle[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!isRecord(node)) return
    if (node._disabled === true) return
    if (typeof node._type === 'string' && typeof node._key === 'string') {
      const bag = node._studio
      const css = isRecord(bag) && typeof bag.css === 'string' ? bag.css.trim() : ''
      if (css !== '') out.push({ key: node._key, blockType: node._type, css })
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === '_studio') continue
      walk(v)
    }
  }
  walk(blocks)
  return out
}
