/**
 * File Name: tree-collapse.ts
 * Purpose: Collapsing branches of the navigator.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Auto-wrapping (W-T3) puts every widget inside a
 *          section, so a real page nests two or three levels deeper than it
 *          reads on the canvas and the tree grew past a screenful. Collapse
 *          is what makes it navigable again.
 *
 *          Visibility is decided by PATH prefix, the same rule the breadcrumb
 *          uses for ancestry - one notion of "contains", not two.
 */
import type { BlockRow } from './model'

/** True when `a` is a strict ancestor path of `b`. */
function isAncestorPath(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length === 0 || a.length >= b.length) return false
  return a.every((seg, i) => seg === b[i])
}

/**
 * The rows to draw. A row is hidden when ANY ancestor is collapsed - one
 * collapsed grandparent is enough, or a grandchild would reappear merely
 * because its own parent happens to be expanded.
 */
export function visibleRows(rows: BlockRow[], collapsed: Set<string>): BlockRow[] {
  if (collapsed.size === 0) return rows
  const collapsedPaths = rows.filter((r) => collapsed.has(r.key)).map((r) => r.path)
  if (collapsedPaths.length === 0) return rows
  return rows.filter((r) => !collapsedPaths.some((p) => isAncestorPath(p, r.path)))
}

/** True when something nests under this row - a chevron on a leaf does nothing. */
export function hasChildren(rows: BlockRow[], row: BlockRow): boolean {
  return rows.some((r) => isAncestorPath(row.path, r.path))
}

/** Collapse or expand one key. Returns a NEW set so React sees the change. */
export function toggleCollapsed(collapsed: Set<string>, key: string): Set<string> {
  const next = new Set(collapsed)
  if (!next.delete(key)) next.add(key)
  return next
}
