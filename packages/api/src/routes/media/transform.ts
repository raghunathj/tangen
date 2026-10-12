/**
 * File Name: transform.ts
 * Purpose: On-the-fly image transformation endpoint — resizes, re-encodes,
 *   and optionally blurs a media asset or one of its named variants, then
 *   writes the result to a disk cache for subsequent requests.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, sharp (via
 *   image-processor service), Bun file API (async I/O on the request path),
 *   mediaDirFor from lib/media-dir (the deployment's storage.mediaDir)
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { processVariant } from '../../services/image-processor'
import type { ImageVariant } from '@tangen/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransformParams {
  w?: number
  h?: number
  format: 'webp' | 'avif' | 'jpeg' | 'png'
  quality: number
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  position?: string
  blur?: number
}

const VALID_FORMATS = new Set(['webp', 'avif', 'jpeg', 'png'])
const VALID_FITS = new Set(['cover', 'contain', 'fill', 'inside', 'outside'])
const MAX_DIMENSION = 4000

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parses and validates image-transform query parameters, applying safe
 * defaults and clamping quality and blur to their allowed ranges.
 * At least one of w or h must be present; both are validated as positive
 * integers not exceeding MAX_DIMENSION (4000 px).
 * @param query - Raw query-string parameters
 * @returns A validated TransformParams object ready for use in processing
 */
export function parseTransformParams(query: Record<string, string>): TransformParams {
  const wRaw = query.w
  const hRaw = query.h

  if (!wRaw && !hRaw) {
    throw new RequestError('VALIDATION_ERROR', 'At least one dimension (w or h) is required')
  }

  function parseDim(val: string, name: string): number {
    const n = Number(val)
    if (!Number.isFinite(n) || n !== Math.floor(n)) {
      throw new RequestError('VALIDATION_ERROR', `${name} must be an integer`)
    }
    if (n <= 0) {
      throw new RequestError('VALIDATION_ERROR', `${name} must be greater than 0`)
    }
    if (n > MAX_DIMENSION) {
      throw new RequestError('VALIDATION_ERROR', `${name} must not exceed ${MAX_DIMENSION}px`)
    }
    return n
  }

  const w = wRaw !== undefined ? parseDim(wRaw, 'w') : undefined
  const h = hRaw !== undefined ? parseDim(hRaw, 'h') : undefined

  const format = (query.format ?? 'webp') as TransformParams['format']
  if (!VALID_FORMATS.has(format)) {
    throw new RequestError('VALIDATION_ERROR', `format must be one of: ${[...VALID_FORMATS].join(', ')}`)
  }

  const qualityRaw = query.quality !== undefined ? Number(query.quality) : 80
  const quality = Math.min(100, Math.max(1, Math.round(qualityRaw)))

  const fit = (query.fit ?? 'cover') as TransformParams['fit']
  if (!VALID_FITS.has(fit)) {
    throw new RequestError('VALIDATION_ERROR', `fit must be one of: ${[...VALID_FITS].join(', ')}`)
  }

  const position = query.position
  const blurRaw = query.blur !== undefined ? Number(query.blur) : undefined
  const blur = blurRaw !== undefined ? Math.min(100, Math.max(0, Math.round(blurRaw))) : undefined

  return { w, h, format, quality, fit, position, blur }
}

/**
 * Produces a short deterministic hash of the transform parameters for use as
 * a disk-cache key, ensuring undefined fields are omitted before hashing.
 * @param params - Validated TransformParams
 * @returns A 16-character hex string uniquely representing the param set
 */
export function buildParamsHash(params: TransformParams): string {
  const stable = JSON.stringify(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
  return createHash('sha256').update(stable).digest('hex').slice(0, 16)
}

/**
 * Builds the absolute path where a transformed image is cached on disk.
 * @param id       - Hashed identifier of the source storage path
 * @param hash     - Transform-params hash from buildParamsHash
 * @param format   - Output image format (e.g. 'webp')
 * @param cacheDir - Root directory for cached transforms (the media directory)
 * @returns Absolute file path for the cached transform result
 */
export function buildTransformCachePath(
  id: string,
  hash: string,
  format: string,
  cacheDir: string,
): string {
  return join(cacheDir, '_transforms', id, `${hash}.${format}`)
}

// ─── Route ────────────────────────────────────────────────────────────────────

import { mediaDirFor } from '../../lib/media-dir'
import { resolveStorage } from '../../services/storage'

const FORMAT_MIME: Record<string, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/**
 * Registers GET /api/v1/media/transform.
 * Resolves the asset by ?id, optionally selects a named variant as the source,
 * applies the requested resize/format/blur transform via Sharp, writes the
 * result to a disk cache, and responds with a 1-year immutable Cache-Control
 * header and ETag for efficient subsequent delivery.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with the transform route registered
 */
export const mediaTransformRoute = (app: Elysia) =>
  // GET /api/v1/media/transform?id=med_xxx&w=800&format=webp
  // GET /api/v1/media/transform?id=med_xxx&variant=hero&w=400&format=webp
  app.get('/api/v1/media/transform', async (ctx: any) => {
    const { query, db, set } = ctx

    const id = (query.id as string | undefined)?.trim()
    if (!id) {
      throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: id')
    }

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1)

    if (!asset) {
      throw new RequestError('NOT_FOUND', `Media asset "${id}" not found`, 404)
    }

    // Optionally transform a named variant instead of the original
    const variantName = (query.variant as string | undefined)?.trim()
    let storagePath: string = asset.storagePath
    if (variantName) {
      if (variantName === '_thumb') {
        if (!asset.thumbnailPath) {
          throw new RequestError('NOT_FOUND', 'No thumbnail for this asset', 404)
        }
        storagePath = asset.thumbnailPath
      } else {
        const variants = (asset.metadata as any)?.variants ?? {}
        const variant = variants[variantName]
        if (!variant?.storagePath) {
          throw new RequestError('NOT_FOUND', `Variant "${variantName}" not found`, 404)
        }
        storagePath = variant.storagePath
      }
    }

    const transformParams = parseTransformParams(query)
    const hash = buildParamsHash(transformParams)
    const pathId = createHash('sha256').update(storagePath).digest('hex').slice(0, 16)
    const cachePath = buildTransformCachePath(pathId, hash, transformParams.format, mediaDirFor(asset.workspaceId))

    // Cache hit — stream the cached file directly, no buffering
    const cachedFile = Bun.file(cachePath)
    if (await cachedFile.exists()) {
      set.headers['Content-Type'] = FORMAT_MIME[transformParams.format] ?? 'application/octet-stream'
      set.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
      set.headers['ETag'] = `"${pathId}-${hash}"`
      return new Response(cachedFile, { headers: set.headers })
    }

    // Fetch the original through the workspace's storage adapter
    // (the transform cache itself stays on local disk — it's rebuildable)
    const storage = resolveStorage(
      ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === asset.workspaceId),
      )
    const originalBytes = await storage.read(storagePath)
    if (!originalBytes) {
      throw new RequestError('NOT_FOUND', `File not found for asset "${id}"`, 404)
    }
    const original = Buffer.from(originalBytes)

    // Build variant spec from transform params
    const variantSpec: ImageVariant = {
      name: '_transform',
      width: transformParams.w,
      height: transformParams.h,
      format: transformParams.format,
      quality: transformParams.quality,
      fit: transformParams.fit,
      position: transformParams.position as any,
    }

    const processed = await processVariant(original, variantSpec)

    // Apply blur if requested
    let outputBuffer = processed.outputBuffer
    if (transformParams.blur && transformParams.blur > 0) {
      const sharp = (await import('sharp')).default
      outputBuffer = await sharp(outputBuffer)
        .blur(transformParams.blur)
        .toBuffer()
    }

    // Write to cache — Bun.write creates parent directories automatically
    await Bun.write(cachePath, outputBuffer)

    set.headers['Content-Type'] = FORMAT_MIME[transformParams.format] ?? 'application/octet-stream'
    set.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    set.headers['ETag'] = `"${pathId}-${hash}"`
    return new Response(outputBuffer, { headers: set.headers })
  })
