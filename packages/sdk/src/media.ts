/**
 * File Name: media.ts
 * Purpose: The typed read surface for the media library (closure plan Phase
 *          7, Unit 3). The endpoints have been stable since before v1; the
 *          SDK simply had no way to name them, so a site rendering an asset
 *          had to hand-build the URL.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Read-only on purpose. Uploading is multipart and
 *          belongs to the Admin and to `tangen` tooling; adding it here would
 *          mean a file-handling surface that differs between the browser and
 *          the server, which is more than parity needs. `fileUrl` and
 *          `transformUrl` build public URLs and issue no request at all.
 */
import type { HttpClient, RequestOptions } from './client'

/** A media asset as the library returns it. */
export interface MediaAsset {
  id: string
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altText: string | null
  tags: string[]
  folderId: string | null
  /** Direct URL when the storage adapter serves keys itself (CDN, public bucket). */
  url?: string
  thumbnailUrl?: string
  variantUrls?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface MediaListOptions extends RequestOptions {
  /** Free-text over filename, original name, alt text and tags. */
  q?: string
  /** A high-level kind: image, video, audio, document, other. */
  category?: 'image' | 'video' | 'audio' | 'document' | 'other'
  folderId?: string
  limit?: number
  offset?: number
  /** Which locale's editorial overrides (alt text) to read. */
  locale?: string
}

export interface MediaListResult {
  data: MediaAsset[]
  meta?: { total?: number; limit?: number; offset?: number }
}

/** Options for a derived image. Omitted parts keep the original's. */
export interface MediaTransform {
  width?: number
  height?: number
  format?: 'webp' | 'avif' | 'jpeg' | 'png'
  quality?: number
  fit?: 'cover' | 'contain' | 'inside' | 'outside' | 'fill'
}

export interface MediaAccessor {
  /** The workspace's assets, newest first. */
  list(options?: MediaListOptions): Promise<MediaListResult>
  /** One asset by id. */
  get(id: string, options?: RequestOptions): Promise<{ data: MediaAsset }>
  /** The public URL that serves this asset's bytes. Issues no request. */
  fileUrl(id: string): string
  /** The public URL for a derived image. Issues no request. */
  transformUrl(id: string, transform: MediaTransform): string
}

/**
 * Builds the media accessor over the client's HTTP layer and API base, so
 * URLs point at the same deployment the client reads from.
 */
export function createMediaAccessor(http: HttpClient, apiBase: string): MediaAccessor {
  const base = apiBase.replace(/\/$/, '')
  return {
    async list(options = {}) {
      const { signal, ...rest } = options
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
      }
      const qs = params.size > 0 ? `?${params}` : ''
      return http.get(`/media${qs}`, signal ? { signal } : undefined)
    },
    async get(id, options) {
      return http.get(`/media/asset/${encodeURIComponent(id)}`, options)
    },
    fileUrl(id) {
      return `${base}/media/file/${encodeURIComponent(id)}`
    },
    transformUrl(id, transform) {
      // The route reads `w` and `h`; the public type says `width` and
      // `height`. Serializing verbatim produced a URL the server answered 422
      // to, so the only working call was one that did not typecheck (Stage
      // G6). The mapping lives here, once, rather than in every caller.
      const WIRE: Record<string, string> = { width: 'w', height: 'h' }
      const params = new URLSearchParams({ id })
      for (const [k, v] of Object.entries(transform)) {
        if (v !== undefined) params.set(WIRE[k] ?? k, String(v))
      }
      return `${base}/media/transform?${params}`
    },
  }
}
