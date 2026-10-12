/**
 * File Name: delete.ts
 * Purpose: DELETE /api/v1/media/asset/:id — full asset removal (DB rows +
 *          stored files via the workspace's storage adapter + local
 *          transform-cache cleanup). Closes the long-standing gap where
 *          uploads could never be removed through the API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Assets that own locale variants (metadata.localeAssets)
 *          refuse deletion unless ?cascade=true, which removes the owned
 *          variants too. Media delete permission required.
 */
import { mediaAssetKeyPrefixOf } from '../../services/media-ingest'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { assertMediaPermission } from '../../lib/permissions'
import { resolveStorage } from '../../services/storage'
import { mediaDirFor } from '../../lib/media-dir'
import { queueAssetKnowledgeRemove } from '../../services/knowledge-sync'
import { findMediaUsage } from '../../services/media-usage'

/** Best-effort transform-cache cleanup — cache dirs are keyed by sha256(storagePath). */
async function cleanTransformCache(asset: { workspaceId?: string; storagePath?: string | null }): Promise<void> {
  if (!asset.storagePath) return
  const pathId = createHash('sha256').update(asset.storagePath).digest('hex').slice(0, 16)
  await rm(join(mediaDirFor(asset.workspaceId), '_transforms', pathId), { recursive: true, force: true }).catch(() => {})
}

/** Remove an asset's stored objects (+ variants) and its local transform cache.
 *  Exported so background jobs (the AI-image reaper) reuse the exact teardown. */
export async function removeAssetFiles(storage: any, asset: any): Promise<void> {
  await storage.deletePrefix(mediaAssetKeyPrefixOf(asset))
  await cleanTransformCache(asset)
}

export const mediaDeleteRoute = (app: Elysia) =>
  app
    // Where-used: content entries referencing this asset (for the delete flow).
    .get('/api/v1/media/asset/:id/usage', async (ctx: any) => {
      const { db, params, workspaceId, schema } = ctx
      assertMediaPermission(ctx.permissions, 'read')
      const usage = schema
        ? await findMediaUsage(db, contentTables as Record<string, any>, schema, { mediaId: params.id, workspaceId })
        : []
      return { data: { usage, count: usage.length } }
    })
    .delete('/api/v1/media/asset/:id', async (ctx: any) => {
    const { db, params, workspaceId, schema, set, query } = ctx
    assertMediaPermission(ctx.permissions, 'delete')

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, params.id), eq(mediaAssets.workspaceId, workspaceId)))
      .limit(1)
    if (!asset) {
      throw new RequestError('NOT_FOUND', `Media asset "${params.id}" not found`, 404)
    }

    // The asset's folder is only known now, so the scope check for it happens
    // after the row is read rather than beside the action check above.
    assertMediaPermission(ctx.permissions, 'delete', asset.folderId ?? null)

    // Refuse while the asset is still referenced by content — the user must
    // disconnect it from those entries first (no silent content mutation).
    if (schema) {
      const usage = await findMediaUsage(db, contentTables as Record<string, any>, schema, { mediaId: asset.id, workspaceId })
      if (usage.length > 0) {
        throw new RequestError(
          'CONFLICT',
          `Can't delete - this asset is used by ${usage.length} content ${usage.length === 1 ? 'entry' : 'entries'}. Remove it from them first.`,
          409,
          undefined,
          { blockers: usage },
        )
      }
    }

    const meta = (asset.metadata ?? {}) as Record<string, any>
    const localeAssets: Record<string, string> = meta.localeAssets ?? {}
    // Only OWNED locale variants (uploaded for this asset) cascade; linked
    // library assets are independent and merely referenced.
    const ownedVariantIds: string[] = []
    for (const variantId of Object.values(localeAssets)) {
      const [variant] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, variantId), eq(mediaAssets.workspaceId, workspaceId)))
        .limit(1)
      if (variant && (variant.metadata as any)?.variantOf === asset.id) {
        ownedVariantIds.push(variant.id)
      }
    }

    if (Object.keys(localeAssets).length > 0 && query.cascade !== 'true') {
      throw new RequestError(
        'CONFLICT',
        `Asset has ${Object.keys(localeAssets).length} locale variant(s) - pass ?cascade=true to delete them too`,
        409,
      )
    }

    const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === asset.workspaceId)
    const storage = resolveStorage(project)

    for (const variantId of ownedVariantIds) {
      const [variant] = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.id, variantId))
        .limit(1)
      if (variant) {
        await db.delete(mediaAssets).where(eq(mediaAssets.id, variantId))
        await removeAssetFiles(storage, variant)
      }
    }

    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id))
    await removeAssetFiles(storage, asset)

    set.status = 204
    // Knowledge-base tap — drop the asset's chunks if any were indexed
    queueAssetKnowledgeRemove(db, ctx.workspaceProjects, { workspaceId: asset.workspaceId, assetId: asset.id })

    return null
  })
