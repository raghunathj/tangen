/**
 * File Name: sidebar.ts
 * Purpose: Groups content types into a structured sidebar navigation tree,
 *   separating top-level items from taxonomy children and sorting by menu order.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

export interface SidebarTypeItem {
  name: string
  label: string
  admin?: {
    menu?: { icon?: string; label?: string; order?: number; show?: boolean; parentExtension?: string }
    taxonomy?: { hierarchical?: boolean; parentType?: string; orderable?: boolean }
  }
}

export interface SidebarGroupResult {
  /** Types shown at the top level of the Content section, sorted by menu.order. */
  topLevel: SidebarTypeItem[]
  /** Map from parent type name → its taxonomy children, sorted by menu.order. */
  childrenOf: Map<string, SidebarTypeItem[]>
}

/**
 * Splits the flat type list into a top-level nav list and a map of taxonomy
 * children grouped by their parent type name.
 *
 * Rules:
 * - Types with `menu.show === false` are excluded entirely.
 * - Types with `taxonomy.parentType` set are excluded from `topLevel` **if**
 *   their declared parent exists in the type list; otherwise they fall back to `topLevel`.
 * - Both `topLevel` and each `childrenOf` array are sorted by `menu.order` ascending.
 * @param types - Flat list of all content type definitions for the current workspace/env
 * @returns SidebarGroupResult with sorted topLevel items and a childrenOf map
 */
export function groupTypesBySidebar(types: SidebarTypeItem[]): SidebarGroupResult {
  const visible = types.filter(t => t.admin?.menu?.show !== false)
  const typeNames = new Set(visible.map(t => t.name))

  const childrenOf = new Map<string, SidebarTypeItem[]>()
  const topLevel: SidebarTypeItem[] = []

  for (const t of visible) {
    const parentType = t.admin?.taxonomy?.parentType
    if (parentType && typeNames.has(parentType)) {
      if (!childrenOf.has(parentType)) childrenOf.set(parentType, [])
      childrenOf.get(parentType)!.push(t)
    } else {
      topLevel.push(t)
    }
  }

  const byOrder = (a: SidebarTypeItem, b: SidebarTypeItem) =>
    (a.admin?.menu?.order ?? 0) - (b.admin?.menu?.order ?? 0)

  topLevel.sort(byOrder)
  for (const children of childrenOf.values()) children.sort(byOrder)

  return { topLevel, childrenOf }
}
