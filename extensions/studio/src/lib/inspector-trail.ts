/**
 * File Name: inspector-trail.ts
 * Purpose: The inspector header's trail - Section > Row > Heading - so the
 *          rail states WHERE the selected block sits, not only what it is.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shopify gets location for free by drilling IN to a
 *          block's settings; Studio keeps a fixed inspector, so the tree stays
 *          visible but location has to be said explicitly. Each crumb selects
 *          its block, which is also the quickest way to the container you
 *          actually meant.
 *
 *          Ancestry comes from `ancestorPaths` (the same walk the
 *          select-parent affordance uses), matched to rows by PATH: a row in
 *          a loop template is listed once and rendered many times, and only
 *          its path says which container holds it. Labels are the rows' own -
 *          the block's name or its derived label - never a second derivation.
 */
import type { BlockRow } from './model'
import { ancestorPaths } from './canvas-resize'
import { ELLIPSIS, type Crumb } from './breadcrumb'

/** Longest trail the 320px rail draws before the middle folds. */
const DEFAULT_MAX = 4

const samePath = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((seg, i) => seg === b[i])

/**
 * The trail from the outermost container down to `selectedKey`. Empty with
 * nothing selected - the header then says "Page" on its own. Beyond `max`
 * the middle folds to an unclickable ellipsis, keeping the outermost
 * container, the parent and the selection.
 */
export function inspectorTrail(
  rows: BlockRow[],
  selectedKey: string | null,
  opts: { max?: number } = {},
): Crumb[] {
  if (!selectedKey) return []
  const selected = rows.find((r) => r.key === selectedKey)
  if (!selected) return []

  const crumb = (r: BlockRow): Crumb => ({ key: r.key, label: r.label, icon: r.icon ?? null })
  const ancestors = ancestorPaths(selected.path)
    .map((p) => rows.find((r) => samePath(r.path, p)))
    .filter((r): r is BlockRow => !!r)
  const trail = [...ancestors.map(crumb), crumb(selected)]

  const max = opts.max ?? DEFAULT_MAX
  if (trail.length <= max) return trail
  const tail = trail.slice(trail.length - (max - 1))
  return [trail[0], { key: null, label: ELLIPSIS, icon: null }, ...tail]
}
