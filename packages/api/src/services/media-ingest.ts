/**
 * File Name: media-ingest.ts
 * Purpose: Shared media ingestion — takes raw bytes and produces a stored,
 *          queryable media asset: original on disk, system thumbnail and
 *          workspace preset variants for images (Sharp), and the DB record.
 *          Used by the upload route and by AI image generation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: image-processor (Sharp), @tangen/db (mediaAssets,
 *          mediaFolders), Bun.write (creates parent dirs). mediaDir is
 *          injectable for tests; defaults to MEDIA_DIR.
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { eq, and } from 'drizzle-orm'
import { mediaAssets, mediaFolders } from '@tangen/db'
import {
  resolveVariants,
  applyImageOverrides,
  processVariant,
  processSystemThumbnail,
  extractDimensions,
} from './image-processor'
import { createLocalStorage } from './storage/local'
import { resolveStorage } from './storage'
import type { MediaAsset, VariantMeta, ImageVariant } from '@tangen/types'
import { queueAssetKnowledgeSync } from './knowledge-sync'

// ─── Pure helpers (shared with the upload route) ──────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
}

/**
 * Resolves a file extension from a MIME type, falling back to the MIME subtype
 * or 'bin' when no mapping exists.
 * @param mimeType - Standard MIME type string (e.g. 'image/jpeg')
 * @returns A lowercase file extension without a leading dot (e.g. 'jpg')
 */
/**
 * `{workspace}/{env}/{asset}` - the key namespace EVERY storage adapter writes
 * under (local disk and S3 alike; the S3 adapter only prepends its bucket
 * prefix). Two environments sharing a bucket or a volume never share a key,
 * which is what makes media environment-scoped in storage (plan I12).
 */
export function mediaAssetKeyPrefix(workspaceId: string, assetId: string): string {
  return `${workspaceId}/${assetId}`
}

/**
 * The key prefix an asset's objects live under, with the trailing slash: read
 * from its stored path (an asset ingested under the environment-era layout
 * keeps its objects where they are), else the layout this build writes.
 */
export function mediaAssetKeyPrefixOf(asset: { workspaceId: string; id: string; storagePath?: string | null }): string {
  const path = asset.storagePath ?? ''
  const cut = path.lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut + 1) : `${mediaAssetKeyPrefix(asset.workspaceId, asset.id)}/`
}

export function getFileExtension(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? mimeType.split('/')[1] ?? 'bin'
}

/** Provenance for AI-generated assets — stored in metadata.ai, shown in the gallery. */
export interface AIProvenance {
  provider: string
  model: string
  /** The full generation prompt, kept for reuse (altText only holds a trimmed copy). */
  prompt: string
}

export interface BuildAssetRecordOptions {
  id: string
  workspaceId: string
  originalName: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  dimensions: { width: number; height: number } | null
  thumbnailPath: string | null
  variants: Record<string, VariantMeta>
  folderId: string | null
  altText: string | null
  createdBy: string | null
  ai?: AIProvenance
  /** Extra keys merged into the JSONB metadata (e.g. variantOf for locale variants). */
  extraMetadata?: Record<string, unknown>
}

/**
 * Assembles a complete MediaAsset object from upload processing results,
 * embedding variant metadata inside the JSONB metadata field.
 * @param opts - All required fields for the new asset record
 * @returns A fully-formed MediaAsset ready for database insertion
 */
export function buildMediaAssetRecord(opts: BuildAssetRecordOptions): MediaAsset {
  const now = new Date().toISOString()
  return {
    id: opts.id,
    workspaceId: opts.workspaceId,
    folderId: opts.folderId,
    filename: opts.filename,
    originalName: opts.originalName,
    mimeType: opts.mimeType,
    sizeBytes: opts.sizeBytes,
    width: opts.dimensions?.width ?? null,
    height: opts.dimensions?.height ?? null,
    altText: opts.altText,
    tags: [],
    metadata: {
      variantsStatus: 'complete',
      variants: opts.variants,
      ...(opts.ai ? { ai: opts.ai } : {}),
      ...(opts.extraMetadata ?? {}),
    },
    storagePath: opts.storagePath,
    thumbnailPath: opts.thumbnailPath,
    variantsStatus: 'complete',
    variants: opts.variants,
    createdAt: now,
    createdBy: opts.createdBy,
    ...(opts.ai ? { ai: opts.ai } : {}),
  }
}

export interface IngestContext {
  db: any
  workspaceId: string
  workspaceProjects: any[] | undefined
}

export interface IngestOptions {
  buffer: Buffer
  mimeType: string
  originalName: string
  folderId?: string | null
  altText?: string | null
  createdBy?: string | null
  /** Extra variants requested by a field (upload route passes these through). */
  fieldVariants?: ImageVariant[]
  /** Skip workspace preset variants (field opt-out). */
  skipPresets?: boolean
  /** Schema-level quality/format override applied to every generated variant. */
  imageOverrides?: { quality?: number; format?: ImageVariant['format'] }
  /** Override the storage root — tests point this at a tmp dir. */
  mediaDir?: string
  /** AI generation provenance — provider, model, and the full prompt. */
  ai?: AIProvenance
  /** Extra keys merged into the JSONB metadata (e.g. variantOf for locale variants). */
  extraMetadata?: Record<string, unknown>
}

/**
 * Stores a buffer as a full media asset: writes the original (and, for images,
 * a system thumbnail plus configured variants), inserts the DB record, and
 * returns the assembled MediaAsset.
 */
export async function ingestMediaBuffer(ctx: IngestContext, opts: IngestOptions): Promise<MediaAsset> {
  const { db, workspaceId, workspaceProjects } = ctx
  // Storage backend: explicit test override (mediaDir) → the workspace/env's
  // configured adapter (local disk by default)
  const project = (workspaceProjects ?? []).find((p: any) => p.workspaceId === workspaceId)
  const storage = opts.mediaDir
    ? createLocalStorage({ mediaDir: opts.mediaDir })
    : resolveStorage(project)

  const id = `med_${randomBytes(12).toString('hex')}`
  const ext = getFileExtension(opts.mimeType)
  const originalFilename = `original.${ext}`

  // Per-asset key prefix: {wid}/{id}/ - the provider-agnostic layout
  const keyPrefix = mediaAssetKeyPrefix(workspaceId, id)
  const storagePath = `${keyPrefix}/${originalFilename}`

  // Any failure past the first write (variant processing, later writes, the
  // DB insert) must not strand orphaned objects in the backend — clean the
  // whole asset prefix best-effort, then rethrow so the caller sees the error.
  try {
    await storage.write(storagePath, opts.buffer, { contentType: opts.mimeType })

  const isImage = opts.mimeType.startsWith('image/')
  let dimensions: { width: number; height: number } | null = null
  let thumbnailPath: string | null = null
  const variants: Record<string, VariantMeta> = {}
  let generatedRecipes: ImageVariant[] = []

  if (isImage) {
    dimensions = await extractDimensions(opts.buffer)

    const thumb = await processSystemThumbnail(opts.buffer)
    thumbnailPath = `${keyPrefix}/_thumb.webp`
    await storage.write(thumbnailPath, thumb.outputBuffer, { contentType: 'image/webp' })

    const workspacePresets: Record<string, ImageVariant> | undefined =
      project?.config?.imagePresets ?? (project as any)?.imagePresets

    const toGenerate = applyImageOverrides(
      resolveVariants(workspacePresets, opts.fieldVariants ?? [], opts.skipPresets ?? false),
      opts.imageOverrides,
    )
    generatedRecipes = toGenerate
    for (const variant of toGenerate) {
      const processed = await processVariant(opts.buffer, variant)
      const variantFilename = `${variant.name}.${processed.format}`
      const variantPath = `${keyPrefix}/${variantFilename}`
      await storage.write(variantPath, processed.outputBuffer, { contentType: `image/${processed.format}` })
      variants[variant.name] = {
        storagePath: variantPath,
        width: processed.width,
        height: processed.height,
        format: processed.format,
        sizeBytes: processed.sizeBytes,
      }
    }
  }

  const assetRecord = buildMediaAssetRecord({
    id,
    workspaceId,
    originalName: opts.originalName || originalFilename,
    filename: originalFilename,
    mimeType: opts.mimeType,
    sizeBytes: opts.buffer.byteLength,
    storagePath,
    dimensions,
    thumbnailPath,
    variants,
    folderId: opts.folderId ?? null,
    altText: opts.altText ?? null,
    createdBy: opts.createdBy ?? null,
    ...(opts.ai ? { ai: opts.ai } : {}),
    // Recipes are remembered so locale variants can replay the exact same set
    extraMetadata: {
      // Which backend holds the files — 'local' | 's3' | custom adapter name.
      // Lets the admin badge cloud assets and future sync tooling target them.
      storage: storage.name,
      ...(generatedRecipes.length > 0 ? { variantRecipes: generatedRecipes } : {}),
      ...(opts.extraMetadata ?? {}),
    },
  })

    await db.insert(mediaAssets).values({
      id: assetRecord.id,
      workspaceId: assetRecord.workspaceId,
      folderId: assetRecord.folderId,
      filename: assetRecord.filename,
      originalName: assetRecord.originalName,
      mimeType: assetRecord.mimeType,
      sizeBytes: assetRecord.sizeBytes,
      width: assetRecord.width,
      height: assetRecord.height,
      altText: assetRecord.altText,
      tags: assetRecord.tags,
      metadata: assetRecord.metadata,
      storagePath: assetRecord.storagePath,
      thumbnailPath: assetRecord.thumbnailPath,
      createdBy: assetRecord.createdBy,
    })

    // Knowledge-base tap — document assets in configured folders index
    // fire-and-forget (never blocks or fails the upload)
    queueAssetKnowledgeSync(db, ctx.workspaceProjects, assetRecord as never, opts.buffer)

    return assetRecord
  } catch (err) {
    await storage.deletePrefix(`${keyPrefix}/`).catch(() => {})
    throw err
  }
}

/**
 * Finds a media folder by name in the workspace/env, creating it when missing.
 * @returns The folder id.
 */
export async function findOrCreateFolder(db: any, workspaceId: string, name: string): Promise<string> {
  const rows = await db
    .select()
    .from(mediaFolders)
    .where(and(
      eq(mediaFolders.workspaceId, workspaceId),
      eq(mediaFolders.name, name),
    ))
    .limit(1)
  const existing = (rows as any[])[0]
  if (existing) return existing.id as string

  const id = `fld_${randomBytes(8).toString('hex')}`
  await db.insert(mediaFolders).values({ id, workspaceId, name, parentId: null })
  return id
}
