/**
 * File Name: media.ts
 * Purpose: Media asset and folder type definitions for files uploaded to Tangen
 *   workspaces, including image variant metadata.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — standalone type definitions with no external imports.
 */

/**
 * Storage metadata for a single generated image variant (dimensions, format, size).
 */
export interface VariantMeta {
  storagePath: string
  width: number
  height: number
  format: string
  sizeBytes: number
}

/**
 * Processing status of user-defined image variant generation for an asset.
 */
export type VariantsStatus = 'pending' | 'complete' | 'failed'

/**
 * A single uploaded media asset with all its storage and variant metadata.
 */
export interface MediaAsset {
  id: string
  workspaceId: string
  folderId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altText: string | null
  tags: string[]
  metadata: Record<string, unknown>
  storagePath: string
  /** Always set for image/* uploads; null for non-image files */
  thumbnailPath: string | null
  /** Status of user-defined variant generation */
  variantsStatus: VariantsStatus
  /** User-defined variants (workspace presets + field variants) */
  variants: Record<string, VariantMeta>
  createdAt: string
  createdBy: string | null
  /** AI generation provenance (also stored in metadata.ai); absent for uploads. */
  ai?: { provider: string; model: string; prompt: string }
}

/**
 * A folder used to organise media assets within a workspace environment.
 */
export interface MediaFolder {
  id: string
  workspaceId: string
  name: string
  parentId: string | null
  createdAt: string
}

// ─── Media categories — the ergonomic layer over raw MIME types ──────────────

/** High-level media groupings used by field `accept` lists and admin filters. */
export type MediaCategory = 'image' | 'video' | 'audio' | 'document' | 'other'

/** MIME shapes that count as documents (beyond just PDF). */
const DOCUMENT_MIME_PATTERNS: Array<string | RegExp> = [
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/vnd\.oasis\.opendocument\./,
  /^text\//,
]

/** Canonical mime → category mapping (single source for admin + server). */
export function getMediaCategoryForMime(mimeType: string): MediaCategory {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (DOCUMENT_MIME_PATTERNS.some((p) => typeof p === 'string' ? p === mimeType : p.test(mimeType))) {
    return 'document'
  }
  return 'other'
}

/**
 * Does a MIME type satisfy a media field's constraints? `accept` (categories)
 * and `mimeTypes` (granular) combine as a UNION — a file passes when it
 * matches either list. No constraints → everything allowed.
 *
 * mimeTypes entries match exactly ('image/jpeg'), by wildcard ('image/*'),
 * or by bare type prefix ('image' ⇒ image/*).
 */
export function matchesMediaConstraint(
  mimeType: string,
  accept?: MediaCategory[] | null,
  mimeTypes?: string[] | null,
): boolean {
  const hasAccept = Array.isArray(accept) && accept.length > 0
  const hasMimes = Array.isArray(mimeTypes) && mimeTypes.length > 0
  if (!hasAccept && !hasMimes) return true

  if (hasAccept && accept!.includes(getMediaCategoryForMime(mimeType))) return true
  if (hasMimes) {
    for (const entry of mimeTypes!) {
      if (entry === mimeType) return true
      if (entry.endsWith('/*') && mimeType.startsWith(entry.slice(0, -1))) return true
      if (!entry.includes('/') && mimeType.startsWith(`${entry}/`)) return true
    }
  }
  return false
}
