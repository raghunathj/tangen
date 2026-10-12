/**
 * File Name: ai-image-reaper.ts
 * Purpose: Sweeps ABANDONED AI-generated images. Every `POST /admin/ai/image`
 *   persists immediately as an UNKEPT draft (metadata.kept === false). The user
 *   confirms one with "Add to Media" (metadata.kept = true) in the Gen AI chat;
 *   anything left unkept is deleted here once it has aged out AND is not
 *   referenced by any content. Runs on the scheduler tick, self-throttled to
 *   ~once an hour — never on a request. Modeled on search-retention.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reuses removeAssetFiles (media/delete) for storage teardown
 *   and findMediaUsage (media-usage) for the reference check — a kept OR referenced
 *   asset is NEVER reaped. If the per-env schema can't load, that env is skipped
 *   (fail safe: never delete without a reference check).
 */
import { and, eq, lt, sql } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { getLogger } from '@tangen/logging'
import { removeAssetFiles } from '../routes/media/delete'
import { resolveStorage } from '../services/storage'
import { findMediaUsage } from '../services/media-usage'
import { getSchema } from '../services/schema-cache'
import { queueAssetKnowledgeRemove } from '../services/knowledge-sync'

const logger = getLogger(['tangen', 'api', 'workers'])

/** Draft images younger than this are left alone — a window to decide/keep them. */
export const REAP_AGE_MS = 24 * 60 * 60 * 1000

/** Injected service surface — real ones in production, fakes in tests (no module mocks). */
export interface ReaperDeps {
  getSchema: typeof getSchema
  findMediaUsage: typeof findMediaUsage
  removeAssetFiles: typeof removeAssetFiles
  resolveStorage: typeof resolveStorage
  queueAssetKnowledgeRemove: typeof queueAssetKnowledgeRemove
}
const defaultDeps: ReaperDeps = { getSchema, findMediaUsage, removeAssetFiles, resolveStorage, queueAssetKnowledgeRemove }

/**
 * Delete unkept + unreferenced AI drafts older than REAP_AGE across every
 * workspace. Returns the number of assets removed.
 */
export async function reapAbandonedAiImages(
  db: any,
  projects: any[] | undefined,
  redis: any,
  now: Date = new Date(),
  deps: ReaperDeps = defaultDeps,
): Promise<number> {
  const cutoff = new Date(now.getTime() - REAP_AGE_MS)
  let deleted = 0

  for (const project of projects ?? []) {
    {
      // Candidates: AI-generated (metadata.ai present) drafts explicitly unkept,
      // created before the cutoff. Uploads (no `ai`) and kept assets never match.
      const candidates: any[] = await db
        .select()
        .from(mediaAssets)
        .where(and(
          eq(mediaAssets.workspaceId, project.workspaceId),
          lt(mediaAssets.createdAt, cutoff),
          sql`${mediaAssets.metadata} -> 'ai' IS NOT NULL`,
          sql`${mediaAssets.metadata} ->> 'kept' = 'false'`,
        ))
      if (candidates.length === 0) continue

      // Fail safe: without the schema we can't run the reference check, so skip.
      let schema
      try {
        schema = await deps.getSchema(db, redis)
      } catch {
        logger.warn('AI-image reaper: schema load failed, skipping workspace', { workspaceId: project.workspaceId })
        continue
      }
      const storage = deps.resolveStorage(project)

      for (const asset of candidates) {
        try {
          const usage = await deps.findMediaUsage(db, contentTables as Record<string, any>, schema, {
            mediaId: asset.id, workspaceId: project.workspaceId, limit: 1,
          })
          if (usage.length > 0) continue   // referenced by content - keep it

          await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id))
          await deps.removeAssetFiles(storage, asset)
          deps.queueAssetKnowledgeRemove(db, projects, { workspaceId: project.workspaceId, assetId: asset.id })
          deleted++
        } catch (err) {
          logger.warn('AI-image reaper: failed to remove one asset', { assetId: asset.id, err: String(err) })
        }
      }
    }
  }

  if (deleted > 0) logger.info('AI-image reaper swept abandoned drafts', { deleted })
  return deleted
}

let lastRunAt = 0
const RUN_EVERY_MS = 60 * 60 * 1000   // once an hour per process

/** Scheduler entry point — self-throttled to one sweep per hour per process. */
export async function reapAbandonedAiImagesThrottled(
  db: any,
  projects: any[] | undefined,
  redis: any,
  now: Date = new Date(),
  deps: ReaperDeps = defaultDeps,
): Promise<number> {
  if (now.getTime() - lastRunAt < RUN_EVERY_MS) return 0
  lastRunAt = now.getTime()
  return reapAbandonedAiImages(db, projects, redis, now, deps)
}
