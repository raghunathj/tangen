/**
 * File Name: localize.ts
 * Purpose: Asset-level localization — a media asset carries per-locale variant
 *   assets (metadata.localeAssets: locale → asset id). Content that references
 *   the default asset automatically serves the locale's variant on localized
 *   reads, so language versions are managed once per asset, not per usage.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, services/media-ingest
 *   (variant uploads run the full ingest pipeline and are tagged
 *   metadata.variantOf so the gallery hides them), services/i18n +
 *   routes/i18n/locales for locale validation.
 */
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { canWriteLocale } from '../../lib/field-access'
import { assertMediaPermission } from '../../lib/permissions'
import { projectLocalization } from '../../services/i18n'
import { resolveLocalization, type ResolvedLocalization } from '../i18n/locales'
import { ingestMediaBuffer, mediaAssetKeyPrefixOf } from '../../services/media-ingest'
import type { ImageVariant } from '@tangen/types'
import { validateUploadFile } from './upload'
import { resolveStorage } from '../../services/storage'
import type { StorageAdapter } from '@tangen/types'
import { resolveActorId } from '../../lib/actor'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Reads the locale → variant-asset-id map from an asset's metadata. */
export function readLocaleAssets(metadata: unknown): Record<string, string> {
  const map = (metadata as any)?.localeAssets
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

/**
 * Validates a target locale for variant management: localization must be on,
 * the locale must be an enabled non-default code.
 */
export function assertVariantLocale(locale: string, localization: ResolvedLocalization): void {
  if (!localization.enabled) {
    throw new RequestError('VALIDATION_ERROR', 'Localization is not enabled for this workspace', 422)
  }
  if (locale === localization.defaultLocale) {
    throw new RequestError('VALIDATION_ERROR', 'The default locale is the asset itself - variants are for other locales', 422)
  }
  if (!localization.locales.some((l) => l.code === locale)) {
    throw new RequestError('VALIDATION_ERROR', `Unknown locale "${locale}"`, 422)
  }
}

const VARIANT_FORMATS = new Set(['webp', 'avif', 'jpeg', 'png'])

/**
 * The image-variant recipes a locale upload should replay so the language's
 * asset gets the same named renditions (hero, card, …) as the parent. Exact
 * recipes are stored at ingest (metadata.variantRecipes); older assets fall
 * back to a reconstruction from the achieved variant dimensions.
 */
export function parentVariantRecipes(metadata: unknown): ImageVariant[] {
  const meta = metadata as any
  if (Array.isArray(meta?.variantRecipes) && meta.variantRecipes.length > 0) {
    return meta.variantRecipes as ImageVariant[]
  }
  const variants = meta?.variants
  if (!variants || typeof variants !== 'object') return []
  return Object.entries(variants).map(([name, v]: [string, any]) => ({
    name,
    width: v.width,
    height: v.height,
    fit: 'cover' as const,
    ...(typeof v.format === 'string' && VARIANT_FORMATS.has(v.format)
      ? { format: v.format as ImageVariant['format'] } : {}),
  }))
}

/** Variants must stay in the parent's media family (image → image, etc.). */
export function sameMimeFamily(a: string, b: string): boolean {
  return a.split('/')[0] === b.split('/')[0]
}

/** Returns new metadata with the locale linked to the variant asset id. */
export function linkLocaleAsset(metadata: unknown, locale: string, assetId: string): Record<string, unknown> {
  const meta = { ...((metadata as Record<string, unknown>) ?? {}) }
  meta.localeAssets = { ...readLocaleAssets(metadata), [locale]: assetId }
  return meta
}

/** Returns new metadata with the locale's variant unlinked (map removed when empty). */
export function unlinkLocaleAsset(metadata: unknown, locale: string): Record<string, unknown> {
  const meta = { ...((metadata as Record<string, unknown>) ?? {}) }
  const map = readLocaleAssets(metadata)
  delete map[locale]
  if (Object.keys(map).length === 0) delete meta.localeAssets
  else meta.localeAssets = map
  return meta
}

// ─── Route plumbing ───────────────────────────────────────────────────────────

/**
 * Loads an asset the caller is permitted to write.
 *
 * The folder check lives HERE rather than at each handler because every
 * handler below reaches its asset through this one function - including the
 * variant TARGET in the link handler, which a folder-scoped key could
 * otherwise attach from a folder it was never given. A gate at the four call
 * sites would be four chances to forget one.
 */
async function loadAsset(db: any, id: string, workspaceId: string, permissions: any): Promise<any> {
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(and(
      eq(mediaAssets.id, id),
      eq(mediaAssets.workspaceId, workspaceId),
      ))
    .limit(1)
  const row = (rows as any[])[0]
  if (!row) throw new RequestError('NOT_FOUND', 'Asset not found', 404)
  assertMediaPermission(permissions, 'write', row.folderId ?? null)
  return row
}

/**
 * Deletes a locale-variant upload (row + files) when it is owned by the parent
 * (metadata.variantOf === parentId). Library assets linked as variants are
 * only ever unlinked, never deleted.
 */
/** Resolves the storage adapter for an asset's workspace. */
function storageFor(ctx: any, asset: { workspaceId: string }): StorageAdapter {
  const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === asset.workspaceId)
  return resolveStorage(project)
}

async function deleteOwnedVariant(db: any, parent: any, variantId: string, storage: StorageAdapter): Promise<void> {
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(and(
      eq(mediaAssets.id, variantId),
      eq(mediaAssets.workspaceId, parent.workspaceId),
      ))
    .limit(1)
  const variant = (rows as any[])[0]
  if (!variant || (variant.metadata as any)?.variantOf !== parent.id) return
  await db.delete(mediaAssets).where(eq(mediaAssets.id, variantId))
  await storage.deletePrefix(mediaAssetKeyPrefixOf(variant))
    .catch(() => {})
}

function resolveCtxLocalization(ctx: any): ResolvedLocalization {
  const project = (ctx.workspaceProjects as any[])?.find((p: any) => p.workspaceId === ctx.workspaceId)
  return resolveLocalization(projectLocalization(project))
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * Registers the asset-localization endpoints (all require media:write):
 * - PUT    /api/v1/media/asset/:id/locale/:locale         { assetId } — link a library asset as the locale's variant
 * - POST   /api/v1/media/asset/:id/locale/:locale/upload  multipart file — upload a new variant (hidden from the gallery)
 * - DELETE /api/v1/media/asset/:id/locale/:locale         — unlink (and delete the variant if it was an owned upload)
 */
export const mediaLocalizeRoutes = (app: Elysia) =>
  app
    .put('/api/v1/media/asset/:id/locale/:locale', async (ctx: any) => {
      const { db, workspaceId, permissions, params, body } = ctx
      assertMediaPermission(permissions, 'write')
      assertVariantLocale(params.locale, resolveCtxLocalization(ctx))
      if (!canWriteLocale(ctx, params.locale, resolveCtxLocalization(ctx).defaultLocale)) {
        throw new RequestError('FORBIDDEN', `Your role cannot edit ${params.locale} content`, 403)
      }

      const parent = await loadAsset(db, params.id, workspaceId, permissions)
      const assetId = String((body as any)?.assetId ?? '').trim()
      if (!assetId) throw new RequestError('VALIDATION_ERROR', 'Missing required field: assetId')
      if (assetId === parent.id) {
        throw new RequestError('VALIDATION_ERROR', 'An asset cannot be its own locale variant', 422)
      }
      const target = await loadAsset(db, assetId, workspaceId, permissions)
      if (!sameMimeFamily(parent.mimeType, target.mimeType)) {
        throw new RequestError('VALIDATION_ERROR',
          `Variant must match the asset's media type (${parent.mimeType.split('/')[0]})`, 422)
      }

      // Replacing an owned upload with a library pick cleans up the old files
      const previous = readLocaleAssets(parent.metadata)[params.locale]
      if (previous && previous !== assetId) await deleteOwnedVariant(db, parent, previous, storageFor(ctx, parent))

      const metadata = linkLocaleAsset(parent.metadata, params.locale, assetId)
      await db.update(mediaAssets).set({ metadata }).where(eq(mediaAssets.id, parent.id))
      return { data: { localeAssets: readLocaleAssets(metadata) } }
    })
    .post('/api/v1/media/asset/:id/locale/:locale/upload', async (ctx: any) => {
      const { db, workspaceId, permissions, params, workspaceProjects } = ctx
      assertMediaPermission(permissions, 'write')
      assertVariantLocale(params.locale, resolveCtxLocalization(ctx))
      if (!canWriteLocale(ctx, params.locale, resolveCtxLocalization(ctx).defaultLocale)) {
        throw new RequestError('FORBIDDEN', `Your role cannot edit ${params.locale} content`, 403)
      }

      const parent = await loadAsset(db, params.id, workspaceId, permissions)

      const rawBody = ctx.body as FormData | Record<string, unknown> | undefined
      const file = (typeof (rawBody as any)?.get === 'function'
        ? (rawBody as FormData).get('file')
        : (rawBody as Record<string, unknown>)?.file) as File | null
      if (!file || typeof file.arrayBuffer !== 'function') {
        throw new RequestError('VALIDATION_ERROR', 'Missing required form field: file')
      }
      validateUploadFile({ type: file.type, size: file.size })
      if (!sameMimeFamily(parent.mimeType, file.type)) {
        throw new RequestError('VALIDATION_ERROR',
          `Variant must match the asset's media type (${parent.mimeType.split('/')[0]})`, 422)
      }

      const asset = await ingestMediaBuffer(
        { db, workspaceId, workspaceProjects },
        {
          buffer: Buffer.from(await file.arrayBuffer()),
          mimeType: file.type,
          originalName: file.name || '',
          folderId: parent.folderId ?? null,
          createdBy: resolveActorId(ctx.memberId, ctx.apiKeyId),   // K0: the member, else the key
          fieldVariants: parentVariantRecipes(parent.metadata),
          extraMetadata: { variantOf: parent.id, variantLocale: params.locale },
        },
      )

      // Replacing a previous owned upload cleans up its files
      const previous = readLocaleAssets(parent.metadata)[params.locale]
      if (previous) await deleteOwnedVariant(db, parent, previous, storageFor(ctx, parent))

      const metadata = linkLocaleAsset(parent.metadata, params.locale, asset.id)
      await db.update(mediaAssets).set({ metadata }).where(eq(mediaAssets.id, parent.id))
      ctx.set.status = 201
      return { data: { asset, localeAssets: readLocaleAssets(metadata) } }
    })
    .delete('/api/v1/media/asset/:id/locale/:locale', async (ctx: any) => {
      const { db, workspaceId, permissions, params } = ctx
      assertMediaPermission(permissions, 'write')
      if (!canWriteLocale(ctx, params.locale, resolveCtxLocalization(ctx).defaultLocale)) {
        throw new RequestError('FORBIDDEN', `Your role cannot edit ${params.locale} content`, 403)
      }

      const parent = await loadAsset(db, params.id, workspaceId, permissions)
      const current = readLocaleAssets(parent.metadata)[params.locale]
      if (!current) throw new RequestError('NOT_FOUND', `No ${params.locale} variant on this asset`, 404)

      await deleteOwnedVariant(db, parent, current, storageFor(ctx, parent))
      const metadata = unlinkLocaleAsset(parent.metadata, params.locale)
      await db.update(mediaAssets).set({ metadata }).where(eq(mediaAssets.id, parent.id))
      return { data: { localeAssets: readLocaleAssets(metadata) } }
    })
