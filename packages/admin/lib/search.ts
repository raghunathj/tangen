/**
 * File Name: search.ts
 * Purpose: Global search utilities — status badge variants and URL construction
 *   for navigating to content records from search results.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

export interface SearchHit {
  id: string
  title: string | null
  kind?: 'content' | string
  typeName: string
  status: string
  updatedAt: string
  /** Provider group label (Content/Users/Forms/…) — set by the search route. */
  group?: string
  /** Explicit destination from an extension provider (relative to the workspace). */
  url?: string
}

export type BadgeVariant = 'success' | 'warning' | 'neutral' | 'default'

/**
 * Maps a content status string to a Tremor BadgeVariant for consistent colour coding.
 * @param status - Content status (e.g. "published", "archived", "scheduled")
 * @returns A BadgeVariant string compatible with the Tremor Badge component
 */
export function getStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'published': return 'success'
    case 'archived': return 'neutral'
    case 'scheduled': return 'default'
    default: return 'warning'
  }
}

/**
 * Constructs the admin URL for navigating to a specific search result record.
 * @param workspaceId - The workspace identifier
 * @param env - The environment slug (e.g. "production")
 * @param hit - The search hit containing typeName and id
 * @returns Absolute path to the content record's detail page
 */
export function buildSearchUrl(workspaceId: string, hit: SearchHit): string {
  // Extension providers carry their own destination (relative to the workspace).
  if (hit.url) return `/${workspaceId}${hit.url.startsWith('/') ? hit.url : `/${hit.url}`}`
  if (hit.kind === 'form') return `/${workspaceId}/extensions/forms/${hit.id}`
  return `/${workspaceId}/objects/${hit.typeName}/${hit.id}`
}

/**
 * Palette group heading for a search hit. The content provider's server-side
 * label is "Content", but the palette already has a "Content" group for nav
 * content types, so content *records* render under "Content records"; every
 * other provider (Users, Forms, an extension's label) keeps its own group.
 */
export function hitGroupLabel(hit: SearchHit): string {
  if (!hit.group || hit.group === 'Content') return 'Content records'
  return hit.group
}
