/**
 * File Name: preview-model.ts
 * Purpose: Pure helpers behind the Review modal's content preview: which of
 *          a draft's raw field values are worth showing (strings and
 *          richtext only - system keys, objects, numbers, and empties are
 *          skipped), richtext-doc -> plain-text extraction, field-name
 *          humanization, the per-block character cap, and the modal's
 *          action-note confirm guard. Browser-safe, React-free.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Works on the editor's object GET payload
 *          (GET /objects/<type>/<id> - fields spread under their names next
 *          to the system columns). Unit-tested without a DOM in
 *          __tests__/preview-model.test.ts.
 */

/** One preview block: a field worth reading before acting on the item. */
export interface PreviewBlock {
  name: string
  label: string
  text: string
  /** True when the text was cut at PREVIEW_BLOCK_CAP (the UI fades it out). */
  truncated: boolean
}

/** Characters kept per preview block - enough to judge, not to read it all. */
export const PREVIEW_BLOCK_CAP = 400

/**
 * System/bookkeeping keys of the object GET payload - never content, never
 * previewed (the header shows title and updated-at separately).
 */
export const SYSTEM_FIELD_KEYS = new Set([
  'id', 'title', 'slug', 'status', 'locale',
  'created_at', 'updated_at', 'published_at', 'scheduled_at',
  'createdAt', 'updatedAt', 'publishedAt', 'scheduledAt',
  'published_values', 'extensionData', 'publishedExtensionData',
])

/** A TipTap/ProseMirror richtext document (how richtext fields are stored). */
export function isRichTextDoc(value: unknown): value is { type: 'doc'; content: unknown[] } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (value as { type?: unknown }).type === 'doc' &&
    Array.isArray((value as { content?: unknown }).content)
}

/** Containers whose children read as separate lines (not inline runs). */
const BLOCK_CONTAINERS = new Set(['doc', 'bulletList', 'orderedList', 'blockquote', 'listItem'])

function nodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(nodeText).filter(Boolean).join('\n')
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (typeof n.text === 'string') return n.text
  if (n.type === 'hardBreak') return '\n'
  if (!Array.isArray(n.content)) return ''
  const parts = n.content.map(nodeText).filter((s) => s !== '')
  return parts.join(BLOCK_CONTAINERS.has(n.type ?? '') ? '\n' : '')
}

/**
 * Plain text out of a richtext doc: text nodes concatenated inline, block
 * nodes on their own lines, blank runs collapsed. '' for anything that is
 * not a doc (callers skip empties).
 */
export function richTextToPlainText(value: unknown): string {
  if (!isRichTextDoc(value)) return ''
  return nodeText(value).replace(/\n{3,}/g, '\n\n').trim()
}

/** "hero_title" / "heroTitle" -> "Hero title" - readable labels off raw field names. */
export function humanizeFieldLabel(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name
}

/** Cap a block's text, flagging the cut so the UI can fade it. */
export function clampPreviewText(text: string, cap: number = PREVIEW_BLOCK_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  return { text: text.slice(0, cap).trimEnd(), truncated: true }
}

/**
 * The readable field blocks of a draft, in the payload's own key order:
 * non-empty strings kept as-is, richtext docs reduced to plain text, and
 * everything else (system keys, underscore-prefixed keys, numbers, bools,
 * arrays, plain objects, empties) skipped.
 */
export function summarizeObjectFields(data: Record<string, unknown>): PreviewBlock[] {
  const blocks: PreviewBlock[] = []
  for (const [name, value] of Object.entries(data)) {
    if (SYSTEM_FIELD_KEYS.has(name) || name.startsWith('_')) continue
    let text = ''
    if (typeof value === 'string') text = value.trim()
    else if (isRichTextDoc(value)) text = richTextToPlainText(value)
    if (!text) continue
    const clamped = clampPreviewText(text)
    blocks.push({ name, label: humanizeFieldLabel(name), ...clamped })
  }
  return blocks
}

/** The Review modal's action steps (the footer's inline state machine). */
export type ReviewModalMode = 'view' | 'advance' | 'reject' | 'assign'

/**
 * Whether the current action step may confirm: rejecting REQUIRES a note
 * (same contract as RejectDialog), advancing never blocks on one.
 */
export function canConfirmReviewAction(mode: ReviewModalMode, note: string): boolean {
  if (mode === 'reject') return note.trim().length > 0
  return true
}
