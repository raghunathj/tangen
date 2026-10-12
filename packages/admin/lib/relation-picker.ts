/**
 * File Name: relation-picker.ts
 * Purpose: Utilities for the relation-field picker modal — query building, ID toggle,
 *   and status badge rendering for candidate content records.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

export type RelationStatusFilter = 'all' | 'draft' | 'published' | 'archived'

/** The body of `POST /objects/<type>/query`: only keys the query validation accepts (the type is in the path). */
export interface RelationQuery {
  limit: number
  offset: number
  /** A status, or `any` for every status including archived. */
  status: string
  query?: Record<string, unknown>
}

/**
 * Constructs a RelationQuery for fetching candidate records, applying search text and status filters.
 * @param targetType - The content type name to query
 * @param search - Free-text search string matched against the title field
 * @param statusFilter - Status filter to apply; "all" asks for `any`
 * @param offset - Pagination offset (default 0)
 * @returns A RelationQuery ready to pass to the objects API
 */
export function buildRelationQuery(
  targetType: string,
  search: string,
  statusFilter: RelationStatusFilter,
  offset = 0,
  filter?: Record<string, unknown>,
): RelationQuery {
  const trimmed = search.trim()
  const q: RelationQuery = { limit: 20, offset, status: statusFilter === 'all' ? 'any' : statusFilter }
  // The field's config.filter restricts candidates; the search rides on top of it.
  const query: Record<string, unknown> = { ...(filter ?? {}) }
  if (trimmed) query.title = { contains: trimmed }
  if (Object.keys(query).length > 0) q.query = query
  return q
}

/**
 * Adds id to the array if absent, removes it if present; used for multi-select relation fields.
 * @param ids - Current array of selected IDs
 * @param id - The ID to toggle
 * @returns Updated array with the ID added or removed
 */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export interface StatusBadge {
  label: string
  className: string
}

/**
 * Returns the display label and Tailwind class string for a given content status.
 * @param status - Content status string (e.g. "published", "draft", "archived", "staged")
 * @returns StatusBadge with a label and Tailwind className
 */
export function statusBadge(status: string): StatusBadge {
  switch (status) {
    case 'published':
      return { label: 'Published', className: 'bg-green-50 text-green-700 border-green-200' }
    case 'draft':
      return { label: 'Draft', className: 'bg-surface-hover text-fg-muted border-border' }
    case 'archived':
      return { label: 'Archived', className: 'bg-orange-50 text-orange-700 border-orange-200' }
    case 'staged':
      return { label: 'Staged', className: 'bg-accent-muted text-accent-fg border-indigo-200' }
    default:
      return { label: status, className: 'bg-surface-hover text-fg-muted border-border' }
  }
}
