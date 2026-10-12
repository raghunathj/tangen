/**
 * File Name: media-browse.ts
 * Purpose: Browsing the real media library from Studio - folders, every file
 *          type, and the query that fetches them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio's Media panel listed 60 assets flat, with no
 *          folder and no type filter, and drew one generic icon for anything
 *          that was not an image. The platform's media API has supported
 *          folders, categories, search and uploads all along - the panel used
 *          none of it, so a workspace with organised media looked like a
 *          jumble and non-image assets were effectively invisible.
 *
 *          Everything here is pure: the panel does the fetching, this decides
 *          what to ask for and how to read the answer back.
 */

/** The categories the media API filters by, plus the unfiltered default. */
export const MEDIA_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'document', label: 'Docs' },
  { id: 'other', label: 'Other' },
] as const

export type MediaFilter = (typeof MEDIA_FILTERS)[number]['id']

/** What a tile should draw for a file. */
export type FileKind = 'image' | 'video' | 'audio' | 'document'

/** One folder as the API returns it, with its children nested. */
export interface MediaFolderNode {
  id: string
  name: string
  parentId: string | null
  children?: MediaFolderNode[]
}

/**
 * The folder list out of whatever /media/folders returned.
 *
 * The API sends ONE synthetic root node - `{ id: null, name: 'Root',
 * children: [...] }` - not an array. The first version of this panel spread
 * the root as if it were a list and threw "tree is not iterable" the moment
 * Media was opened, because its tests had been written against an array the
 * API never produces. Normalising here, once, means every reader below sees
 * the same thing regardless of which shape arrives.
 */
export function folderNodes(raw: unknown): MediaFolderNode[] {
  if (Array.isArray(raw)) return raw as MediaFolderNode[]
  if (raw && typeof raw === 'object') {
    const children = (raw as { children?: unknown }).children
    if (Array.isArray(children)) return children as MediaFolderNode[]
  }
  // Anything else reads as "no folders" rather than a crash - an
  // unreachable library must never break the builder.
  return []
}

/** One row of a folder dropdown: the folder, and how deep it sits. */
export interface FolderOption {
  id: string
  name: string
  depth: number
}

/**
 * Every folder as a flat, ordered list for a dropdown - parents before
 * children, depth recorded so nesting can be shown by indent.
 *
 * A dropdown beats a breadcrumb plus a grid of folder tiles for a small
 * panel: the whole hierarchy is one control, "All media" is the natural
 * default, and the asset grid gets the space back.
 */
export function flattenFolders(tree: readonly MediaFolderNode[], depth = 0): FolderOption[] {
  const out: FolderOption[] = []
  for (const node of tree) {
    out.push({ id: node.id, name: node.name, depth })
    out.push(...flattenFolders(node.children ?? [], depth + 1))
  }
  return out
}

/**
 * The folders matching a typed query, for the searchable picker.
 *
 * Case-insensitive substring on the name. An empty query returns the whole
 * list in tree order so indent still means something; a query flattens the
 * result, because a match deep in a tree is useless if its indent hides it.
 */
export function filterFolders(options: readonly FolderOption[], query: string): FolderOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...options]
  return options
    .filter((f) => f.name.toLowerCase().includes(q))
    .map((f) => ({ ...f, depth: 0 }))
}

/** How many assets one page asks for. */
const PAGE = 60

export interface MediaQueryInput {
  folderId?: string | null
  filter?: MediaFilter
  q?: string
}

/**
 * The query string for one listing.
 *
 * Absent beats empty throughout: the API reads a missing `folderId` as "every
 * folder" and a missing `category` as "every type", so sending an empty
 * string would filter to nothing instead of everything.
 */
export function mediaListQuery(input: MediaQueryInput): Record<string, string> {
  const out: Record<string, string> = { limit: String(PAGE) }
  if (input.folderId) out.folderId = input.folderId
  if (input.filter && input.filter !== 'all') out.category = input.filter
  const q = input.q?.trim()
  if (q) out.q = q
  return out
}

/** Depth-first search for one folder, carrying the path that reached it. */
function find(nodes: readonly MediaFolderNode[], id: string, trail: MediaFolderNode[]): MediaFolderNode[] | null {
  for (const node of nodes) {
    const here = [...trail, node]
    if (node.id === id) return here
    const deeper = find(node.children ?? [], id, here)
    if (deeper) return deeper
  }
  return null
}

/**
 * The breadcrumb trail to a folder, root first.
 *
 * An unknown id yields an empty trail rather than throwing: a folder can be
 * deleted in another tab while Studio still holds its id, and landing back at
 * the root is the right recovery.
 */
export function folderTrail(tree: readonly MediaFolderNode[], folderId: string | null): MediaFolderNode[] {
  if (!folderId) return []
  return find(tree, folderId, []) ?? []
}

/** The folders directly inside the open one (or the root). */
export function folderChildren(tree: readonly MediaFolderNode[], folderId: string | null): MediaFolderNode[] {
  if (!folderId) return [...tree]
  const trail = find(tree, folderId, [])
  return trail ? [...(trail[trail.length - 1].children ?? [])] : []
}

/**
 * What kind of file this is, for the tile.
 *
 * Anything unrecognised reads as a document rather than being guessed at or
 * hidden - the library holds real files and the panel must show all of them.
 */
export function fileKind(mimeType: string | undefined | null): FileKind {
  const head = String(mimeType ?? '').split('/')[0]
  if (head === 'image') return 'image'
  if (head === 'video') return 'video'
  if (head === 'audio') return 'audio'
  return 'document'
}

/** Whether a picked file is worth sending. */
export function isUploadable(file: { name: string; size: number }): boolean {
  // A zero-byte file uploads happily and then serves as a broken asset, so it
  // is refused here rather than discovered later on a live page.
  return !!file && !!file.name && file.size > 0
}
