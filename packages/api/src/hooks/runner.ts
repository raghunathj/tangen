/**
 * File Name: runner.ts
 * Purpose: Executes content lifecycle hooks (beforeChange, afterChange, beforeDelete, afterDelete)
 *          for all installed extensions and site-level hooks; also owns the ExtensionDataStore
 *          factory, published-data snapshotting, and panel-data extraction utilities.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Drizzle ORM, @tangen/db, @tangen/types, @tangen/logging.
 *                     Extension hooks run before site hooks (ordering guarantee documented on collectHooks).
 */
import { randomUUID } from 'node:crypto'
import { eq, and, sql } from 'drizzle-orm'
import { getLogger } from '@tangen/logging'
import { queueKnowledgeSyncOnChange, queueKnowledgeSyncOnDelete } from '../services/knowledge-sync'
import { extensionData, workspaceInstalledApps } from '@tangen/db'
import type { ContentHooks, ContentHookCtx, ContentDeleteCtx, WorkspaceProject, ExtensionDataStore } from '@tangen/types'
import { getExtensionManifest, getExtensionHooks, anyExtensionHasHooks, anyExtensionHasVersionedData } from './app-hooks-registry'
import { hooksAllowed } from '../services/extension-server'
import { createGlobalsStore } from '../services/globals-store'
import { signerFor } from '../lib/extension-sign'

// ── ExtensionDataStore factory ─────────────────────────────────────────────────

/** TTL in seconds for extension data Redis cache entries. */
export const EXTENSION_DATA_CACHE_TTL = 3600

export const extensionDataCacheKey = (workspaceId: string, objectId: string) =>
  `tangen:appdata:${workspaceId}:${objectId}`

export const publishedExtensionDataCacheKey = (workspaceId: string, objectId: string) =>
  `tangen:appdata:pub:${workspaceId}:${objectId}`

export function createExtensionDataStore(
  db: any,
  workspaceId: string,
  redis?: any,
): ExtensionDataStore {
  return {
    async get(extensionId, objectId) {
      const rows = await db
        .select({ data: extensionData.data })
        .from(extensionData)
        .where(
          and(
            eq(extensionData.extensionId, extensionId),
            eq(extensionData.objectId, objectId),
            eq(extensionData.workspaceId, workspaceId),
            ),
        )
        .limit(1)
      return (rows[0]?.data ?? {}) as Record<string, unknown>
    },

    async getPublished(extensionId, objectId) {
      const rows = await db
        .select({ publishedData: extensionData.publishedData })
        .from(extensionData)
        .where(
          and(
            eq(extensionData.extensionId, extensionId),
            eq(extensionData.objectId, objectId),
            eq(extensionData.workspaceId, workspaceId),
            ),
        )
        .limit(1)
      // Null, not {}: an object with no published version is a different
      // answer from a published object whose extension state is empty.
      return (rows[0]?.publishedData ?? null) as Record<string, unknown> | null
    },

    async set(extensionId, objectId, data) {
      const existing = await db
        .select({ id: extensionData.id })
        .from(extensionData)
        .where(
          and(
            eq(extensionData.extensionId, extensionId),
            eq(extensionData.objectId, objectId),
            eq(extensionData.workspaceId, workspaceId),
            ),
        )
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(extensionData)
          .set({ data, updatedAt: new Date() })
          .where(eq(extensionData.id, existing[0].id))
      } else {
        await db.insert(extensionData).values({
          id: randomUUID(),
          extensionId,
          objectId,
          workspaceId,
          data,
        })
      }

      if (redis) {
        redis.del(extensionDataCacheKey(workspaceId, objectId)).catch(() => {})
      }
    },

    async delete(extensionId, objectId) {
      await db
        .delete(extensionData)
        .where(
          and(
            eq(extensionData.extensionId, extensionId),
            eq(extensionData.objectId, objectId),
            eq(extensionData.workspaceId, workspaceId),
            ),
        )

      if (redis) {
        redis.del(extensionDataCacheKey(workspaceId, objectId)).catch(() => {})
      }
    },
  }
}

// ── Published extension data snapshot ─────────────────────────────────────────

/**
 * Moves an object's extension state to match its publication (closure plan
 * Phase 9D, C5, decided OPTION A).
 *
 * `extension_data.published_data` IS the published extension state: the
 * public Delivery read serves it and never `data`, the admin editor shows
 * both, and the "changed since publish" filter compares them. So it has to
 * move whenever publication moves, in the same direction as
 * `published_values` on the content row:
 *
 *   published  -> the draft data becomes the published snapshot
 *   anything    -> there is no published version, so there is no published
 *   else           snapshot; it is CLEARED (Unit 30A)
 *
 * Clearing rather than keeping the last snapshot is the choice that keeps
 * Delivery honest: an unpublished object serves nothing, and a snapshot left
 * behind would have served its extension state to an API key after the
 * content had gone offline.
 *
 * One statement either way. The first version read the rows and issued an
 * UPDATE for each, so an object with twelve panels cost thirteen statements
 * on the publish path.
 */
export async function syncPublishedExtensionData(
  db: any,
  redis: any,
  workspaceId: string,
  objectId: string,
  status: string | null | undefined,
): Promise<void> {
  await db
    .update(extensionData)
    .set({ publishedData: status === 'published' ? sql`${extensionData.data}` : null })
    .where(
      and(
        eq(extensionData.objectId, objectId),
        eq(extensionData.workspaceId, workspaceId),
        ),
    )

  if (redis) {
    redis.del(publishedExtensionDataCacheKey(workspaceId, objectId))?.catch?.(() => {})
  }
}

/** Publishing an object. Kept as the name every caller already reads. */
export async function snapshotPublishedExtensionData(
  db: any,
  redis: any,
  workspaceId: string,
  objectId: string,
): Promise<void> {
  await syncPublishedExtensionData(db, redis, workspaceId, objectId, 'published')
}

// ── Extension data snapshot (for versioning) ──────────────────────────────────

export async function buildExtensionDataSnapshot(
  db: any,
  workspaceId: string,
  objectId: string,
): Promise<Record<string, Record<string, unknown>> | undefined> {
  // No registered extension versions its data: nothing below can produce a
  // snapshot, so the installed-apps lookup would be a round trip to learn
  // nothing. Same result, one statement fewer on every update and publish.
  if (!anyExtensionHasVersionedData()) return undefined

  // Installed here, enabled or not: a disabled extension's data is still its
  // data, and a revision that forgot it would lose it on restore.
  const installedRows = await db
    .select({ appId: workspaceInstalledApps.appId })
    .from(workspaceInstalledApps)
    .where(and(
      eq(workspaceInstalledApps.workspaceId, workspaceId),
      eq(workspaceInstalledApps.state, 'installed'),
    ))

  const store = createExtensionDataStore(db, workspaceId)
  const snapshot: Record<string, Record<string, unknown>> = {}

  for (const { appId } of installedRows) {
    const manifest = getExtensionManifest(appId)
    if (!manifest?.versionedData) continue
    const data = await store.get(appId, objectId)
    if (Object.keys(data).length > 0) snapshot[appId] = data
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined
}

// ── Panel data extraction ─────────────────────────────────────────────────────

export function extractPanelData(body: Record<string, unknown>): {
  cleanNextData: Record<string, unknown>
  panelData: Record<string, Record<string, unknown>> | undefined
} {
  const cleanNextData: Record<string, unknown> = {}
  const panelData: Record<string, Record<string, unknown>> = {}

  for (const [key, value] of Object.entries(body)) {
    const match = key.match(/^__panelData_(.+)$/)
    if (match) {
      panelData[match[1]] = (value ?? {}) as Record<string, unknown>
    } else {
      cleanNextData[key] = value
    }
  }

  return {
    cleanNextData,
    panelData: Object.keys(panelData).length > 0 ? panelData : undefined,
  }
}

// ── Hook collection ───────────────────────────────────────────────────────────

/**
 * Returns the ordered list of ContentHooks to call for a given workspace:
 * extension hooks (installed extensions only, in install order) → site hooks.
 *
 * ORDERING GUARANTEE: Extension hooks always run before site hooks, sequentially.
 */
/**
 * The installed-apps lookup, at most once per request.
 *
 * beforeChange and afterChange both collect hooks, and each used to run the
 * same SELECT: two round trips per update, three per publish, for a result
 * that cannot change between them. The promise is memoised on the hook
 * context, which is the object those calls already share, so a request pays
 * once and nothing outlives it.
 */
const INSTALLED = Symbol('installedApps')
type Memo = { [INSTALLED]?: Promise<string[]> }

function activeAppIds(db: any, workspaceId: string, memo?: Memo): Promise<string[]> {
  if (memo?.[INSTALLED]) return memo[INSTALLED]
  // ACTIVE = installed and enabled in this environment (Phase 4).
  const p: Promise<string[]> = db
    .select({ appId: workspaceInstalledApps.appId })
    .from(workspaceInstalledApps)
    .where(and(
      eq(workspaceInstalledApps.workspaceId, workspaceId),
      eq(workspaceInstalledApps.state, 'installed'),
      eq(workspaceInstalledApps.enabled, true),
    ))
    .then((rows: Array<{ appId: string }>) => rows.map((r) => r.appId))
  if (memo) memo[INSTALLED] = p
  return p
}

/** What a hook's `ctx.settings` answers: the extension's typed manifest settings for the workspace (E.7). */
export type HookSettingsFactory = (extensionId: string, workspaceId: string) => { get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> }
let _hookSettings: HookSettingsFactory | null = null

/** Boot installs the settings factory; null (tests, a host without settings wiring) leaves `ctx.settings` absent. */
export function setHookSettingsFactory(factory: HookSettingsFactory | null): void {
  _hookSettings = factory
}

/**
 * E.7: an extension's hooks see the shared ctx plus their own `settings`
 * accessor when the manifest declares settings. The wrap is per call, so
 * one request's ctx never carries another extension's settings.
 */
function withHookSettings(appId: string, workspaceId: string, hookSet: ContentHooks): ContentHooks {
  // `sign` is per-extension and always available; settings only when the
  // manifest declares them. Both are injected here because the hook ctx
  // itself is SHARED across every extension's hooks - anything extension-
  // specific has to be bound in this wrapper, not on the shared object.
  const factory = _hookSettings && getExtensionManifest(appId)?.settings ? _hookSettings : null
  const settings = factory ? { get: () => factory(appId, workspaceId).get() } : undefined
  const sign = signerFor(appId)
  const wrap = <F extends (...a: any[]) => any>(fn: F | undefined): F | undefined =>
    fn ? ((ctx: any, ...rest: unknown[]) => fn({ ...ctx, sign, ...(settings ? { settings } : {}) }, ...rest)) as unknown as F : undefined
  return {
    ...(hookSet.beforeChange ? { beforeChange: wrap(hookSet.beforeChange) } : {}),
    ...(hookSet.afterChange ? { afterChange: wrap(hookSet.afterChange) } : {}),
    ...(hookSet.beforeDelete ? { beforeDelete: wrap(hookSet.beforeDelete) } : {}),
    ...(hookSet.afterDelete ? { afterDelete: wrap(hookSet.afterDelete) } : {}),
  }
}

async function collectHooks(
  db: any,
  workspaceId: string,
  projects: WorkspaceProject[],
  memo?: Memo,
): Promise<ContentHooks[]> {
  const hooks: ContentHooks[] = []

  // 1. Extension-level hooks — only for installed extensions. Skipped outright
  //    when no extension registered any: the query could not change the answer.
  if (anyExtensionHasHooks()) {
    for (const appId of await activeAppIds(db, workspaceId, memo)) {
      const extHooks = getExtensionHooks(appId)
      // E.2: a declaring extension runs content hooks only under hooks:content.
      if (extHooks && hooksAllowed(appId, workspaceId)) hooks.push(withHookSettings(appId, workspaceId, extHooks))
    }
  }

  // 2. Site-level hooks from the workspace project config
  const project = projects.find((p) => p.workspaceId === workspaceId)
  if (project?.contentHooks) hooks.push(project.contentHooks)

  return hooks
}

// ── Public runner functions ───────────────────────────────────────────────────

export async function runBeforeChange(
  db: any,
  projects: WorkspaceProject[],
  ctx: ContentHookCtx,
): Promise<Partial<Record<string, unknown>> | null> {
  const hookSets = await collectHooks(db, ctx.workspaceId, projects, ctx as unknown as Memo)
  const mutations: Record<string, unknown> = {}

  for (const hookSet of hookSets) {
    if (!hookSet.beforeChange) continue
    try {
      const result = await hookSet.beforeChange(ctx)
      if (result && typeof result === 'object') Object.assign(mutations, result)
    } catch (err) {
      throw err
    }
  }

  return Object.keys(mutations).length > 0 ? mutations : null
}

export async function runAfterChange(
  db: any,
  projects: WorkspaceProject[],
  ctx: ContentHookCtx & { savedData: Record<string, unknown> },
): Promise<void> {
  const hookSets = await collectHooks(db, ctx.workspaceId, projects, ctx as unknown as Memo)
  for (const hookSet of hookSets) {
    if (!hookSet.afterChange) continue
    try {
      await hookSet.afterChange(ctx)
    } catch (err) {
      getLogger(['tangen', 'api', 'hooks']).error('afterChange hook error', err instanceof Error ? err : new Error(String(err)))
    }
  }
  // Knowledge (RAG) index tap — fire-and-forget; no-op unless the optional
  // package is installed AND the workspace/type opted in
  queueKnowledgeSyncOnChange(db, projects, ctx)
}

export async function runBeforeDelete(
  db: any,
  projects: WorkspaceProject[],
  ctx: ContentDeleteCtx,
): Promise<void> {
  const hookSets = await collectHooks(db, ctx.workspaceId, projects, ctx as unknown as Memo)
  for (const hookSet of hookSets) {
    if (!hookSet.beforeDelete) continue
    try {
      await hookSet.beforeDelete(ctx)
    } catch (err) {
      throw err
    }
  }
}

export async function runAfterDelete(
  db: any,
  projects: WorkspaceProject[],
  ctx: ContentDeleteCtx,
): Promise<void> {
  const hookSets = await collectHooks(db, ctx.workspaceId, projects, ctx as unknown as Memo)
  for (const hookSet of hookSets) {
    if (!hookSet.afterDelete) continue
    try {
      await hookSet.afterDelete(ctx)
    } catch (err) {
      getLogger(['tangen', 'api', 'hooks']).error('afterDelete hook error', err instanceof Error ? err : new Error(String(err)))
    }
  }
  queueKnowledgeSyncOnDelete(db, projects, ctx)
}
