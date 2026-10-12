/**
 * File Name: block-label.ts
 * Purpose: What a row in the block tree is CALLED. A tree reading
 *          "Section / Section / Section" tells you nothing about the page,
 *          so a block is named by its content wherever it has any.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Precedence is deliberate: an explicit `_label` (a
 *          rename) always wins, then content, then the component's label,
 *          then the raw type. Content derivation is GENERIC first - the
 *          first plausible text prop - with per-type rules only where the
 *          generic answer would be wrong or useless, so site-authored
 *          components get meaningful names without registering anything.
 */

/** Longest label the tree shows before truncating. */
export const LABEL_MAX = 42

type Block = Record<string, unknown>
type Def = { label?: string; name?: string } | null | undefined

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Collapse whitespace, strip tags, and cut to length. */
function clean(raw: string): string {
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return ''
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX).trimEnd()}…` : text
}

/** Pull readable text out of a richtext value (TipTap doc, node array, or string). */
function richtextText(value: unknown, depth = 0): string {
  if (depth > 6) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const node of value) {
      const found = richtextText(node, depth + 1)
      if (found.trim()) return found
    }
    return ''
  }
  if (value && typeof value === 'object') {
    const node = value as { text?: unknown; content?: unknown; html?: unknown }
    if (typeof node.text === 'string' && node.text.trim()) return node.text
    if (typeof node.html === 'string') return node.html
    if (node.content !== undefined) return richtextText(node.content, depth + 1)
  }
  return ''
}

/** Child block arrays, in declaration order. */
function childArrays(block: Block): Block[][] {
  const out: Block[][] = []
  for (const value of Object.values(block)) {
    if (!Array.isArray(value)) continue
    const blocks = value.filter((v): v is Block => !!v && typeof v === 'object' && typeof (v as Block)._type === 'string')
    if (blocks.length > 0) out.push(blocks)
  }
  return out
}

/** The first heading text anywhere beneath a container. */
function firstHeadingText(block: Block, depth = 0): string {
  if (depth > 5) return ''
  for (const list of childArrays(block)) {
    for (const child of list) {
      if (child._type === 'kit.heading') {
        const t = clean(str(child.text))
        if (t) return t
      }
      const nested = firstHeadingText(child, depth + 1)
      if (nested) return nested
    }
  }
  return ''
}

/** Props worth naming a block after, when no per-type rule applies. */
const TEXTY = ['text', 'heading', 'title', 'label', 'name', 'headline', 'alt', 'body', 'subtitle']

/** Per-type rules, only where the generic answer would be useless. */
const BY_TYPE: Record<string, (b: Block) => string> = {
  'kit.section': (b) => firstHeadingText(b),
  'kit.row': (b) => firstHeadingText(b),
  'kit.container': (b) => firstHeadingText(b),
  'kit.div': (b) => firstHeadingText(b),
  'kit.grid': (b) => firstHeadingText(b),
  'kit.loop': (b) => (str(b.source) ? `Loop of ${str(b.source)}` : ''),
  'kit.form': (b) => (str(b.formSlug) ? `Form: ${str(b.formSlug)}` : ''),
  'kit.buttons': (b) => {
    const first = Array.isArray(b.items) ? b.items.find((i) => !!i && typeof i === 'object') as Block | undefined : undefined
    return first ? str(first.label) : ''
  },
  'kit.video': (b) => str(b.url),
  // A reference names WHAT it points at, and says that it is one. The cached
  // label is used rather than a lookup, so the tree still reads when the
  // instance cannot be read; an unresolved reference falls through to the
  // component label ("Instance") rather than showing a raw id.
  'kit.instance': (b) => (str(b.label) ? `Instance -> ${str(b.label)}` : ''),
  'kit.list': (b) => {
    const first = Array.isArray(b.items) ? b.items.find((i) => !!i && typeof i === 'object') as Block | undefined : undefined
    return first ? str(first.text) : ''
  },
  'kit.accordion': (b) => {
    const first = Array.isArray(b.items) ? b.items.find((i) => !!i && typeof i === 'object') as Block | undefined : undefined
    return first ? str(first.title) : ''
  },
  // Spacers and dividers have nothing to say - their component label is the
  // honest answer, so no rule here.
}

/**
 * The name a block shows in the tree. `_label` (an explicit rename) wins,
 * then derived content, then the component's label, then the raw type.
 */
export function blockLabel(block: Block | null | undefined, def: Def): string {
  if (!block || typeof block !== 'object') return def?.label || 'Block'

  const explicit = clean(str(block._label))
  if (explicit) return explicit

  const type = str(block._type)
  const rule = BY_TYPE[type]
  const derived = rule ? clean(rule(block)) : ''
  if (derived) return derived

  if (!rule) {
    for (const prop of TEXTY) {
      const value = block[prop]
      if (value === undefined || value === null) continue
      const text = clean(typeof value === 'string' ? value : richtextText(value))
      if (text) return text
    }
  }

  return def?.label || type || 'Block'
}
