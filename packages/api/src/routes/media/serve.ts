/**
 * File Name: serve.ts
 * Purpose: Serves media asset files directly from disk by asset ID, supporting
 *   the original file, the system thumbnail (_thumb), or any named variant
 *   via the ?variant query parameter.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, Bun file API,
 *   storage adapters from services/storage
 */
import { extname } from 'node:path'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { resolveStorage } from '../../services/storage'
import type { StorageAdapter } from '@tangen/types'
import { hardeningHeaders } from './static'


const EXT_TO_MIME: Record<string, string> = {
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
 * Streams a stored object through the workspace's storage adapter with the correct MIME type,
 * Content-Length, and a one-year immutable Cache-Control header.
 * @param storagePath - Relative storage path within MEDIA_DIR
 * @param set         - Elysia response-mutation object for setting headers
 * @returns A Bun Response streaming the file bytes
 */
async function serveFile(storage: StorageAdapter, storagePath: string, set: any): Promise<Response> {
  const streamed = await storage.stream(storagePath)
  if (!streamed) {
    throw new RequestError('NOT_FOUND', 'File not found', 404)
  }
  const ext = extname(storagePath).toLowerCase()
  const mimeType = EXT_TO_MIME[ext] ?? 'application/octet-stream'
  set.headers['Content-Type'] = mimeType
  if (streamed.size != null) set.headers['Content-Length'] = String(streamed.size)
  set.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  // Same hardening as the public /media/* route: user-uploaded bytes must not
  // execute in the API's origin. A private asset is reached with a signed
  // link, which does not make its contents any safer to render.
  for (const [k, v] of Object.entries(hardeningHeaders(mimeType))) set.headers[k] = v
  return new Response(streamed.body as BodyInit)
}

/**
 * Registers GET /api/v1/media/file.
 * Resolves the asset by ?id, then serves the original file, the _thumb
 * variant, or a named variant depending on the optional ?variant param.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with the media-serve route registered
 */
export const mediaServeRoute = (app: Elysia) =>
  // GET /api/v1/media/file?id=med_xxx              → serves the original file
  // GET /api/v1/media/file/med_xxx                 → same (path form)
  // GET /api/v1/media/file?id=med_xxx&variant=hero → serves a named variant
  //
  // Both forms are served: the query form is historical, the path form is what
  // every object route trained callers to guess - and a 404 on an image is
  // invisible, so the wrong guess cost real debugging time (finding #3).
  app
    .get('/api/v1/media/file/:id', (ctx: any) => serveById(ctx, String(ctx.params.id ?? '').trim()))
    .get('/api/v1/media/file', (ctx: any) => {
      const id = (ctx.query.id as string | undefined)?.trim()
      if (!id) {
        throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: id')
      }
      return serveById(ctx, id)
    })

/** The shared handler behind both URL forms. */
async function serveById(ctx: any, id: string) {
  {
    const { query, db, set } = ctx
    const projects = (ctx.workspaceProjects ?? []) as any[]

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1)

    if (!asset) {
      throw new RequestError('NOT_FOUND', `Media asset "${id}" not found`, 404)
    }

    const storage = resolveStorage(
      projects.find((p) => p.workspaceId === asset.workspaceId),
      )
    const variantName = (query.variant as string | undefined)?.trim()

    if (variantName) {
      if (variantName === '_thumb') {
        if (!asset.thumbnailPath) {
          throw new RequestError('NOT_FOUND', 'No thumbnail for this asset', 404)
        }
        return serveFile(storage, asset.thumbnailPath, set)
      }
      const variants = (asset.metadata as any)?.variants ?? {}
      const variant = variants[variantName]
      if (!variant?.storagePath) {
        throw new RequestError('NOT_FOUND', `Variant "${variantName}" not found`, 404)
      }
      return serveFile(storage, variant.storagePath, set)
    }

    return serveFile(storage, asset.storagePath, set)
  }
}
