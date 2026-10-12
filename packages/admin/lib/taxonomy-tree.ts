/**
 * File Name: taxonomy-tree.ts
 * Purpose: Builds and manipulates hierarchical taxonomy trees from flat record lists,
 *   with utilities for flattening, searching, and collecting descendant IDs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

export interface TaxTreeRow {
  id: string
  [key: string]: unknown
}

export interface TaxTreeNode {
  row: TaxTreeRow
  depth: number
  parentId: string | null
  children: TaxTreeNode[]
}

/** Normalises a parent field value (null | string | { id: string }) → ID string or null. */
function resolveParentId(val: unknown, selfId: string): string | null {
  if (!val) return null
  const id = typeof val === 'string' ? val : (val as Record<string, unknown>).id as string | undefined
  if (!id || id === selfId) return null  // null or self-reference → root
  return id
}

/**
 * Builds a forest (array of root nodes) from a flat list of records.
 * Children are sorted by `position` field if present; input order otherwise.
 * Rows whose `parentField` value references an ID not in the dataset are treated as roots.
 * @param rows - Flat array of content records to organise into a tree
 * @param parentField - The field name on each row that holds the parent ID (or parent object)
 * @returns Array of root TaxTreeNode objects, each with nested children
 */
export function buildTaxonomyTree(rows: TaxTreeRow[], parentField: string): TaxTreeNode[] {
  const idSet = new Set(rows.map(r => r.id))
  const childrenOf = new Map<string | null, TaxTreeRow[]>()
  childrenOf.set(null, [])

  for (const r of rows) {
    let pid = resolveParentId(r[parentField], r.id)
    if (pid !== null && !idSet.has(pid)) pid = null  // orphan → root
    if (!childrenOf.has(pid)) childrenOf.set(pid, [])
    childrenOf.get(pid)!.push(r)
  }

  const hasPosition = rows.some(r => typeof r.position === 'number')
  if (hasPosition) {
    for (const list of childrenOf.values()) {
      list.sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0))
    }
  }

  function makeNodes(parentId: string | null, depth: number): TaxTreeNode[] {
    return (childrenOf.get(parentId) ?? []).map(r => ({
      row: r,
      depth,
      parentId,
      children: makeNodes(r.id, depth + 1),
    }))
  }

  return makeNodes(null, 0)
}

/**
 * Depth-first flattening of a tree into a single ordered list.
 * @param nodes - Root-level nodes of the taxonomy tree
 * @returns All nodes in depth-first traversal order
 */
export function flattenTree(nodes: TaxTreeNode[]): TaxTreeNode[] {
  const result: TaxTreeNode[] = []
  function visit(nodes: TaxTreeNode[]) {
    for (const n of nodes) { result.push(n); visit(n.children) }
  }
  visit(nodes)
  return result
}

/**
 * Client-side search filter for a flat (pre-flattened) node list.
 * Matches against `title` (case-insensitive); falls back to `id` when title is null.
 * Returns all nodes when `search` is empty or whitespace.
 * @param nodes - Flat list of nodes (typically from flattenTree)
 * @param search - Search string to filter by
 * @returns Filtered subset of nodes whose title or id contains the search string
 */
export function filterFlatNodes(nodes: TaxTreeNode[], search: string): TaxTreeNode[] {
  const q = search.trim().toLowerCase()
  if (!q) return nodes
  return nodes.filter(n => {
    const text = n.row.title != null ? String(n.row.title) : n.row.id
    return text.toLowerCase().includes(q)
  })
}

/**
 * Returns the IDs of all descendants of the node with `targetId` (not including self).
 * @param nodes - Root-level nodes of the taxonomy tree to search
 * @param targetId - The ID of the node whose descendants to collect
 * @returns Set of descendant IDs, or an empty Set if the target is not found
 */
export function getDescendantIds(nodes: TaxTreeNode[], targetId: string): Set<string> {
  function findNode(nodes: TaxTreeNode[]): TaxTreeNode | undefined {
    for (const n of nodes) {
      if (n.row.id === targetId) return n
      const found = findNode(n.children)
      if (found) return found
    }
  }
  const target = findNode(nodes)
  if (!target) return new Set()

  const ids = new Set<string>()
  function collect(nodes: TaxTreeNode[]) {
    for (const n of nodes) { ids.add(n.row.id); collect(n.children) }
  }
  collect(target.children)
  return ids
}
