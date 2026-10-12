/**
 * File Name: tree-search.ts
 * Purpose: Searching the navigator by label, type or class name.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Auto-wrapping (W-T3) put every widget inside a
 *          section, so a real page's tree runs past a screenful and a
 *          heading three levels down is found by scrolling. Webflow's
 *          navigator has "Search layers" for exactly this.
 *
 *          A match is shown WITH its ancestors, by the same path-prefix rule
 *          collapse and the breadcrumb use: a bare name with no place is not
 *          a result anyone can act on. Descendants of a match are not dragged
 *          along - "section" asks for sections, not for everything in them.
 *
 *          Classes are resolved by the caller: rows do not carry the block,
 *          and this module must stay free of the tree.
 */
import type { BlockRow } from './model'

/** True when `a` is a strict ancestor path of `b`. */
function isAncestorPath(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length === 0 || a.length >= b.length) return false
  return a.every((seg, i) => seg === b[i])
}

/**
 * Whether one row answers the query: its label, its type (with or without
 * the `kit.` prefix - nobody types that), or a class on its block.
 */
export function rowMatches(row: BlockRow, query: string, classes: readonly string[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  if (row.label.toLowerCase().includes(q)) return true
  const type = row.type.toLowerCase()
  if (type.includes(q) || type.replace(/^kit\./, '').includes(q)) return true
  return classes.some((c) => c.toLowerCase().includes(q))
}

export interface SearchResult {
  /** The rows to draw: every match and every ancestor of one, in tree order. */
  rows: BlockRow[]
  /** The keys that actually matched, for the highlight. */
  matched: Set<string>
}

/** Filters the tree to the query. An empty query is the whole tree, untouched. */
export function searchRows(
  rows: BlockRow[],
  query: string,
  classesFor: (row: BlockRow) => readonly string[],
): SearchResult {
  if (!query.trim()) return { rows, matched: new Set() }
  const matched = new Set(rows.filter((r) => rowMatches(r, query, classesFor(r))).map((r) => r.key))
  if (matched.size === 0) return { rows: [], matched }
  const hits = rows.filter((r) => matched.has(r.key))
  const shown = rows.filter((r) => matched.has(r.key) || hits.some((h) => isAncestorPath(r.path, h.path)))
  return { rows: shown, matched }
}
