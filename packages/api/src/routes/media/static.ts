/**
 * File Name: static.ts
 * Purpose: Serves media files at path-based URLs (/media/*) directly from
 *   MEDIA_DIR with path-traversal protection and long-lived cache headers.
 *   This is the CDN-style public endpoint; use serve.ts for ID-based access.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Bun file API (async — no sync fs calls on the
 *   request path), MEDIA_DIR from lib/media-dir; no database access — files
 *   are resolved by path only
 */
import { extname } from 'node:path'
import { Elysia } from 'elysia'
import { resolveStorage } from '../../services/storage'
import type { StorageAdapter } from '@tangen/types'

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
}

/**
 * Resolves a requested path inside baseDir and streams the file with MIME and
 * immutable cache headers. Traversal attempts and missing files return 404.
 * @param baseDir - Media root directory
 * @param requestedPath - Raw wildcard path from the URL
 * @returns A streaming Response (Bun.file) or a 404
 */
/**
 * Types a browser will treat as a DOCUMENT if it is navigated to, rather than
 * as an image. An SVG is the one that matters here: media-ingest accepts
 * `image/svg+xml` and /media/* is public, so an SVG carrying a `<script>` or
 * an `onload=` used to run in the API's own origin for anyone who opened the
 * URL. Uploading needs only `media:write`, which an editor has.
 */
const NAVIGABLE_MIME = new Set(['image/svg+xml', 'application/pdf'])

/**
 * The headers that stop user-uploaded bytes executing.
 *
 * `nosniff` on everything, so a file whose extension disagrees with its
 * contents is not re-interpreted as something scriptable. Then, for a type a
 * browser would render as a document, a CSP permitting nothing but inline
 * style.
 *
 * Deliberately NOT `Content-Disposition: attachment`: a response CSP applies
 * to the document when it is NAVIGATED to and is ignored by an `<img>` that
 * embeds the same URL, so an uploaded icon or logo still renders everywhere it
 * is used while direct navigation can no longer execute.
 */
export function hardeningHeaders(mimeType: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' }
  if (NAVIGABLE_MIME.has(mimeType)) {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }
  return headers
}

export async function serveStaticMedia(
  storage: StorageAdapter,
  requestedPath: string,
): Promise<Response> {
  let streamed: Awaited<ReturnType<StorageAdapter['stream']>>
  try {
    // The local adapter enforces traversal containment and throws on escapes
    streamed = await storage.stream(requestedPath.replace(/^[/\\]+/, ''))
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!streamed) return new Response('Not found', { status: 404 })

  const mimeType = EXT_MIME[extname(requestedPath).toLowerCase()] ?? 'application/octet-stream'
  return new Response(streamed.body as BodyInit, {
    headers: { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=31536000, immutable', ...hardeningHeaders(mimeType) },
  })
}

/**
 * Registers GET /media/* — wildcard delivery through the workspace's storage adapter.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with the static media route registered
 */
export const mediaStaticRoute = (app: Elysia) =>
  app.get('/media/*', (ctx: any) => {
    const requestedPath = (ctx.params as any)['*'] as string
    // Keys are {workspaceId}/{}/… — resolve that workspace's adapter
    const [wsId] = requestedPath.replace(/^[/\\]+/, '').split('/')
    const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === wsId)
    const storage = resolveStorage(project)
    return serveStaticMedia(storage, requestedPath)
  })
