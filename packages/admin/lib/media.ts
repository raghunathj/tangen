/**
 * File Name: media.ts
 * Purpose: URL builders and formatting helpers for the admin media library — static paths,
 *          API-served file URLs, thumbnails, on-demand transforms, size formatting, and MIME categorization.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The API host is resolved at RUNTIME (lib/api-origin), so
 *          one Admin build serves any host (tangen:config). It was read from VITE_API_URL at
 *          build time, which forced a rebuild per API host.
 */
import { apiOrigin } from './api-origin'

function resolvedHost(): string {
  return apiOrigin()
}

/** Direct static URL — no DB hit, CDN-friendly. */
export function buildStaticUrl(storagePath: string): string {
  return `${resolvedHost()}/media/${storagePath}`
}

export type MediaCategory = 'image' | 'video' | 'audio' | 'document' | 'other'

/**
 * Formats a byte count as a human-readable file size string (B, KB, MB, or GB).
 * @param bytes - Non-negative byte count
 * @returns A formatted size string such as "2.3 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Determines the broad media category for a MIME type (image, video, audio, document, or other).
 * @param mimeType - MIME type string (e.g. "image/png", "application/pdf")
 * @returns The matching MediaCategory
 */
export function getMediaCategory(mimeType: string): MediaCategory {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType === 'application/pdf') return 'document'
  return 'other'
}

/** Stable URL for the original file — survives workspace renames. */
export function buildFileUrl(assetId: string, variant?: string): string {
  const base = `${resolvedHost()}/api/v1`
  const params = new URLSearchParams({ id: assetId })
  if (variant) params.set('variant', variant)
  return `${base}/media/file?${params.toString()}`
}

/** Thumbnail URL — 200px webp, pre-generated on upload. */
export function buildThumbnailUrl(assetId: string): string {
  return buildFileUrl(assetId, '_thumb')
}

/** On-demand transform — resize/reformat on the fly. */
export function buildTransformUrl(
  assetId: string,
  opts: { variant?: string; w?: number; h?: number; format?: string } = {},
): string {
  const base = `${resolvedHost()}/api/v1`
  const params = new URLSearchParams({ id: assetId })
  if (opts.variant) params.set('variant', opts.variant)
  if (opts.w) params.set('w', String(opts.w))
  if (opts.h) params.set('h', String(opts.h))
  if (opts.format) params.set('format', opts.format)
  return `${base}/media/transform?${params.toString()}`
}
