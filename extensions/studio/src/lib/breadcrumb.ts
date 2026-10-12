/**
 * File Name: breadcrumb.ts
 * Purpose: The ancestry trail above the canvas - where the selected block
 *          sits in the page, and a way back up to each ancestor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Auto-wrapping (W-T3) means every widget sits inside a
 *          section, so real pages nest deeper than they read on the canvas.
 *          Clicking into a heading gives no clue what contains it; this is
 *          how you find out, and how you select the container you actually
 *          meant.
 *
 *          Ancestry comes from the row PATH, not from re-walking the tree:
 *          `blockRows` already computed it, and deriving it twice invites the
 *          two disagreeing.
 */
import type { BlockRow } from './model'

/** The page itself - selecting it clears the block selection (see I-T3). */
export const ROOT_LABEL = 'Page'
/** Stands in for the crumbs dropped from the middle of a deep trail. */
export const ELLIPSIS = '…'

/** Longest trail drawn before the middle collapses. */
const DEFAULT_MAX = 5

export interface Crumb {
  /** null = not selectable: the page root, or the collapsed middle. */
  key: string | null
  label: string
  icon: string | null
}

/** True when `a` is an ancestor path of `b` - a strict prefix. */
function isAncestorPath(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length === 0 || a.length >= b.length) return false
  return a.every((seg, i) => seg === b[i])
}

/**
 * The trail from the page down to `selectedKey`. Always starts at the page,
 * so there is a way back to the page inspector even from a deep selection.
 */
export function breadcrumbFor(
  rows: BlockRow[],
  selectedKey: string | null,
  opts: { max?: number } = {},
): Crumb[] {
  const root: Crumb = { key: null, label: ROOT_LABEL, icon: null }
  if (!selectedKey) return [root]

  const selected = rows.find((r) => r.key === selectedKey)
  if (!selected) return [root]

  const ancestors = rows
    .filter((r) => isAncestorPath(r.path, selected.path))
    .sort((a, b) => (a.path?.length ?? 0) - (b.path?.length ?? 0))

  const trail: Crumb[] = [
    root,
    ...ancestors.map((r) => ({ key: r.key, label: r.label, icon: r.icon ?? null })),
    { key: selected.key, label: selected.label, icon: selected.icon ?? null },
  ]

  const max = opts.max ?? DEFAULT_MAX
  if (trail.length <= max) return trail

  // Keep the page, then as much of the TAIL as fits: where you are and the
  // step above it are what you act on. The middle is context you can get
  // from the navigator.
  const tail = trail.slice(trail.length - (max - 2))
  return [root, { key: null, label: ELLIPSIS, icon: null }, ...tail]
}
