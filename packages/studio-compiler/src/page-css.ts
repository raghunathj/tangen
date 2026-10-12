/**
 * File Name: page-css.ts
 * Purpose: Per-page raw CSS - the declarations a designer wrote for ONE
 *          page, scoped to that page's own top-level blocks and judged, per
 *          block, by protection.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The "restyle it on this campaign page" case, stored
 *          with the page in Studio's own store and compiled here. The
 *          question was what to scope it BY.
 *
 *          The runtime stamps no page root: StudioBlocks and StudioPage
 *          render fragments, so the site's own layout is the parent, and
 *          inventing a root would change every site's markup for one
 *          feature. The cheaper honest scope is the page's own blocks.
 *          `data-tangen-block="<key>"` is already on every wrapper, so a
 *          `:is([data-tangen-block="a"],[data-tangen-block="b"])` list of
 *          the page's top-level keys reaches exactly this page and nothing
 *          the site rendered around it - no combinator (the list is one
 *          compound selector per block), nothing new stamped, and the
 *          specificity of one class, so a page tweak beats the workspace
 *          class it is meant to override and loses to a section's own CSS,
 *          which is the more specific intent.
 *
 *          Declarations land on each top-level block; inheritable ones
 *          (colour, font) flow down from there, which is what "page-level"
 *          means visually. Non-inheritable ones (a background, a padding)
 *          apply to each section, which is the only honest reading when
 *          there is no page element to apply them to.
 *
 *          Protection is judged PER BLOCK: a Guided section refuses
 *          `display` while an Open one beside it takes it, so blocks are
 *          grouped by what they may take and one rule is emitted per group.
 *          A refused declaration is reported once per property and block
 *          type, with the block type in the reason, so the designer learns
 *          which Block said no rather than seeing the same line five times.
 */
import { styleAccess, type BlockProtection } from '@tangen/studio-schema'
import { rawCssError, splitDeclarations, RAW_CSS_FORBIDDEN } from './raw-css'
import type { Refusal } from './enforce'

/** One top-level block of a page, as the scope needs it. */
export interface PageBlockRef {
  key: string
  blockType: string
}

/** A page's raw CSS and the blocks it lands on. */
export interface PageStyle {
  css: string
  blocks: PageBlockRef[]
}

export interface PageStylesInput {
  page?: PageStyle
  protections?: Record<string, BlockProtection>
}

export interface CompiledPageStyles {
  css: string
  refused: Refusal[]
}

/** The refusal `rule` for page CSS - there is no class to name. */
export const PAGE_RULE = 'page'

/** A key safe inside a double-quoted attribute value. Minted keys are base-36. */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/

const PROPERTY_NAME = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/

function declarationValueError(value: string): string | null {
  if (value === '') return 'has no value'
  if (/[{}<>]/.test(value)) return 'cannot contain braces or angle brackets'
  const lower = value.toLowerCase()
  for (const [needle, reason] of RAW_CSS_FORBIDDEN) {
    if (lower.includes(needle)) return reason
  }
  return null
}

function parseDeclaration(text: string): { property: string; value: string } | null {
  const at = text.indexOf(':')
  if (at <= 0) return null
  const property = text.slice(0, at).trim().toLowerCase()
  const value = text.slice(at + 1).trim()
  if (!PROPERTY_NAME.test(property)) return null
  return { property, value }
}

/** The selector one group of blocks is reached through. */
function scopeFor(keys: string[]): string {
  return `:is(${keys.map((k) => `[data-tangen-block="${k}"]`).join(',')})`
}

export function compilePageStyles(input: PageStylesInput): CompiledPageStyles {
  const refused: Refusal[] = []
  const raw = typeof input.page?.css === 'string' ? input.page.css.trim() : ''
  if (raw === '') return { css: '', refused }

  const error = rawCssError(raw)
  if (error) return { css: '', refused: [{ rule: PAGE_RULE, property: '*', reason: error }] }

  // The declarations that survive the text-level checks, in written order.
  const decls: Array<{ property: string; value: string }> = []
  for (const text of splitDeclarations(raw)) {
    const parsed = parseDeclaration(text)
    if (!parsed) {
      refused.push({ rule: PAGE_RULE, property: text.split(':')[0].trim() || text, reason: `"${text}" is not a property:value declaration` })
      continue
    }
    const valueError = declarationValueError(parsed.value)
    if (valueError) {
      refused.push({ rule: PAGE_RULE, property: parsed.property, reason: `"${parsed.property}" ${valueError}` })
      continue
    }
    decls.push(parsed)
  }

  const blocks = [...(input.page?.blocks ?? [])]
    .filter((b) => b && typeof b.key === 'string' && typeof b.blockType === 'string')
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const usable = blocks.filter((b) => SAFE_KEY.test(b.key))
  if (usable.length < blocks.length) {
    refused.push({ rule: PAGE_RULE, property: '*', reason: `${blocks.length - usable.length} block${blocks.length - usable.length === 1 ? '' : 's'} on this page have a key that cannot be a selector, so the page CSS does not reach them` })
  }
  if (usable.length === 0) {
    refused.push({ rule: PAGE_RULE, property: '*', reason: 'This page has no blocks for its custom CSS to land on' })
    return { css: '', refused }
  }

  // Group blocks by the declarations their protection lets through. The
  // group key is the list of kept declarations, so blocks that agree share
  // one rule and the output stays small on a page of twenty Open sections.
  const groups = new Map<string, { keys: string[]; decls: string[] }>()
  const seenRefusal = new Set<string>()
  for (const block of usable) {
    const protection = input.protections?.[block.blockType]
    const kept: string[] = []
    for (const d of decls) {
      const access = styleAccess({ protection, scope: 'workspace', target: { kind: 'root' }, propertyId: d.property })
      if (access.allowed) {
        kept.push(`${d.property}:${d.value}`)
        continue
      }
      const seen = `${block.blockType} ${d.property}`
      if (seenRefusal.has(seen)) continue
      seenRefusal.add(seen)
      refused.push({
        rule: PAGE_RULE, property: d.property,
        reason: `${access.reason ?? `"${d.property}" is refused`} (${block.blockType})`,
      })
    }
    if (kept.length === 0) continue
    const id = kept.join(';')
    const group = groups.get(id) ?? { keys: [], decls: kept }
    group.keys.push(block.key)
    groups.set(id, group)
  }

  // Group order follows the first key of each, so the output is stable
  // whatever order the blocks arrived in.
  const rules = [...groups.values()]
    .sort((a, b) => (a.keys[0] < b.keys[0] ? -1 : a.keys[0] > b.keys[0] ? 1 : 0))
    .map((g) => `${scopeFor(g.keys)}{${g.decls.join(';')}}`)
  return { css: rules.join(''), refused }
}

/**
 * A page's top-level blocks, as the scope wants them: key and type, hidden
 * blocks skipped because the runtime renders nothing for them.
 */
export function topLevelBlocks(blocks: unknown): PageBlockRef[] {
  if (!Array.isArray(blocks)) return []
  const out: PageBlockRef[] = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue
    const node = b as Record<string, unknown>
    if (node._disabled === true) continue
    if (typeof node._key !== 'string' || typeof node._type !== 'string') continue
    out.push({ key: node._key, blockType: node._type })
  }
  return out
}
