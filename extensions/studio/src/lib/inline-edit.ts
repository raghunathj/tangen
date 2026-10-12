/**
 * File Name: inline-edit.ts
 * Purpose: Editing copy ON the canvas - which prop a double-click edits,
 *          and how a double-click is recognised in the first place.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A double-click needs NO protocol addition: the
 *          overlay already posts a select per click, so two selects on the
 *          same block in quick succession IS the gesture. Cheaper than a
 *          fifth message and it cannot drift out of sync with selection.
 *
 *          Only single-line PLAIN TEXT is editable inline. Richtext and
 *          textarea stay in the rail - inline richtext is its own problem
 *          (toolbars, marks, paste handling), and pretending otherwise would
 *          ship an editor that silently eats formatting.
 */

/** Two selects on one block within this window read as a double-click. */
export const DOUBLE_SELECT_MS = 400

export interface LastSelect { key: string; at: number }

/** Was this select the second half of a double-click? */
export function isDoubleSelect(last: LastSelect | null, key: string, now: number): boolean {
  if (!last || last.key !== key) return false
  return now - last.at < DOUBLE_SELECT_MS
}

interface DefLike {
  name?: string
  fields?: Array<{ name: string; fieldType: string }>
}

/** Blocks whose text props are CONFIGURATION, not copy on the page. */
const NEVER_INLINE = new Set(['kit.section', 'kit.row', 'kit.loop'])

/** Where a block's editable words live, when the generic rule would miss. */
const EXPLICIT: Record<string, string> = {
  // An image's alt text is the only words it has, and it is worth making
  // easy to write rather than easy to skip.
  'kit.image': 'alt',
}

/** Field types that are single-line copy. */
const INLINE_TYPES = new Set(['text'])

/**
 * The prop a double-click edits, or null when the block has no inline copy.
 * Generic first - the first single-line text field - so a developer's own
 * component is editable on the canvas with nothing registered.
 */
export function inlineEditableProp(type: string, def: DefLike | null | undefined): string | null {
  if (!type || NEVER_INLINE.has(type)) return null
  const fields = def?.fields ?? []

  const explicit = EXPLICIT[type]
  if (explicit) {
    return fields.some((f) => f.name === explicit && INLINE_TYPES.has(f.fieldType)) ? explicit : null
  }

  const first = fields.find((f) => INLINE_TYPES.has(f.fieldType))
  return first ? first.name : null
}
