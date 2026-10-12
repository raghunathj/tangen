/**
 * File Name: knowledge-sync.ts
 * Purpose: The API-side knowledge tap — keeps the vector index in step with
 *          the content lifecycle. Taps enqueue the platform task
 *          'tangen-knowledge-embed' through the DURABLE queue backend
 *          (retries, crash-safety, rows in job_runs/admin Runs); the task
 *          re-reads current state so runs are idempotent. Everything heavy
 *          lives in the OPTIONAL @tangen/knowledge package, lazily imported
 *          only when a workspace enables it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: SQL runs through @tangen/db's $rawClient (postgres.js
 *          unsafe) — parameterized, no drizzle internals. Register the task
 *          at boot via registerKnowledgeTasks(db, getProjects).
 */
import { embeddingsSettingsFor } from '../config/service-settings'
import type { ContentHookCtx, ContentDeleteCtx, WorkspaceProject } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { enqueueTask, registerPlatformTask } from './task-queue'

type KnowledgeModule = typeof import('@tangen/knowledge')
let knowledgeModule: KnowledgeModule | null | undefined

async function loadKnowledge(): Promise<KnowledgeModule | null> {
  if (knowledgeModule !== undefined) return knowledgeModule
  try {
    knowledgeModule = await import('@tangen/knowledge')
  } catch {
    knowledgeModule = null
  }
  return knowledgeModule
}

const log = () => getLogger(['tangen', 'api', 'knowledge'])

export const KNOWLEDGE_EMBED_TASK = 'tangen-knowledge-embed'
export const KNOWLEDGE_REINDEX_TASK = 'tangen-knowledge-reindex'

export type KnowledgeEmbedPayload =
  | { op: 'object'; typeName: string; objectId: string }
  | { op: 'remove-object'; objectId: string }
  | { op: 'asset'; assetId: string }
  | { op: 'remove-asset'; assetId: string }
  | { op: 'qa'; qaId: string }
  | { op: 'remove-qa'; qaId: string }

export function knowledgeExec(db: any) {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) throw new Error('knowledge: raw postgres client unavailable on this db handle')
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}

/** Cheap enablement pre-check so disabled workspaces never touch the queue. */
async function knowledgeEnabledFor(
  projects: WorkspaceProject[] | undefined,
  workspaceId: string,
): Promise<{ knowledge: KnowledgeModule; project: WorkspaceProject } | null> {
  const knowledge = await loadKnowledge()
  if (!knowledge) return null
  const project = projects?.find((p) => p.workspaceId === workspaceId)
  if (!project) return null
  const config = knowledge.resolveKnowledgeConfig(project)
  return config.enabled ? { knowledge, project } : null
}

/**
 * First use of a workspace x environment pins its vector space. The tables
 * are @tangen/db's (migration 0041; pgvector is an operator prerequisite), so
 * nothing is created here: `pinKnowledgeVectorSpace` types the embedding
 * column to the model's dimensions and indexes it, then knowledge_meta records
 * the space. A later call with a different model is refused (same guard the
 * CLI enforces) rather than silently mixing vector spaces.
 */
async function ensureIndexReady(
  store: ReturnType<KnowledgeModule['createKnowledgeStore']>,
  exec: ReturnType<typeof knowledgeExec>,
  adapter: { name: string; dimensions: number },
  workspaceId: string,
): Promise<void> {
  const meta = await store.getMeta(workspaceId).catch(() => undefined)
  if (!meta) {
    const { pinKnowledgeVectorSpace } = await import('@tangen/db')
    await pinKnowledgeVectorSpace(exec, adapter.dimensions)
    const [provider, ...modelParts] = adapter.name.split('/')
    await store.setMeta(workspaceId, {
      provider, model: modelParts.join('/') || provider, dimensions: adapter.dimensions,
    })
    return
  }
  if (meta.dimensions !== adapter.dimensions || `${meta.provider}/${meta.model}` !== adapter.name) {
    throw new Error(
      `knowledge: index was built with ${meta.provider}/${meta.model} (${meta.dimensions} dims) ` +
      `but config now says ${adapter.name} (${adapter.dimensions} dims). ` +
      `Run: tangen knowledge index --rebuild`,
    )
  }
}

/** Builds indexer deps for a ws/env (adapter + store + chunking). Pins the
 *  vector space on first use so any trigger path — CLI, admin Reindex, or the
 *  publish-time tap — works without a mandatory CLI first-run. */
async function depsFor(db: any, project: WorkspaceProject) {
  const knowledge = (await loadKnowledge())!
  const config = knowledge.resolveKnowledgeConfig(project)
  const embeddings = knowledge.requireEmbeddingsConfig(config)
  const adapter = knowledge.getEmbeddingAdapter(embeddingsSettingsFor(project, embeddings))
  const exec = knowledgeExec(db)
  const store = knowledge.createKnowledgeStore(exec)
  await ensureIndexReady(store, exec, adapter, project.workspaceId)
  return { knowledge, config, adapter, store }
}

// ─── Query-insights logging (best-effort, never fails a retrieval) ──────────

/**
 * Records one retrieval into knowledge_queries. Fire-and-forget: callers
 * don't await, every failure is swallowed, and ~1% of writes piggyback the
 * 90-day prune so retention needs no scheduler entry.
 */
export function logKnowledgeQuery(
  db: any,
  config: { insights: boolean },
  entry: {
    workspaceId: string; query: string; source: string
    audience: string; locale: string; topScore: number | null; hitCount: number; answered: boolean
  },
): void {
  if (!config.insights) return
  void (async () => {
    const knowledge = await loadKnowledge()
    if (!knowledge) return
    const store = knowledge.createInsightsStore(knowledgeExec(db))
    await store.log(entry)
    if (Math.random() < 0.01) await store.prune(90)
  })().catch(() => { /* best effort */ })
}

// ─── Taps (enqueue through the durable queue) ────────────────────────────────

function enqueueEmbed(workspaceId: string, payload: KnowledgeEmbedPayload): void {
  void enqueueTask({ taskId: KNOWLEDGE_EMBED_TASK, workspaceId, payload })
    .catch((err) => log().error('knowledge enqueue failed', err instanceof Error ? err : new Error(String(err))))
}

/** Content-change tap (from runAfterChange). */
export function queueKnowledgeSyncOnChange(
  db: any,
  projects: WorkspaceProject[] | undefined,
  ctx: ContentHookCtx & { savedData: Record<string, unknown> },
): void {
  void (async () => {
    const enabled = await knowledgeEnabledFor(projects, ctx.workspaceId)
    if (!enabled) return
    const type = (enabled.project as any)?.schemas?.find?.((t: any) => t.name === ctx.typeName)
    if (!type?.knowledge?.enabled) return
    const status = String(ctx.savedData.status ?? '')
    if (status === 'published' || ctx.statusChange?.from === 'published') {
      // The task re-reads the row — published indexes, anything else removes
      enqueueEmbed(ctx.workspaceId, { op: 'object', typeName: ctx.typeName, objectId: ctx.objectId })
    }
  })().catch((err) => log().error('knowledge tap failed', err instanceof Error ? err : new Error(String(err))))
}

/** Delete tap (from runAfterDelete). */
export function queueKnowledgeSyncOnDelete(
  db: any,
  projects: WorkspaceProject[] | undefined,
  ctx: ContentDeleteCtx,
): void {
  void (async () => {
    const enabled = await knowledgeEnabledFor(projects, ctx.workspaceId)
    if (!enabled) return
    enqueueEmbed(ctx.workspaceId, { op: 'remove-object', objectId: ctx.objectId })
  })().catch((err) => log().error('knowledge delete-tap failed', err instanceof Error ? err : new Error(String(err))))
}

/** Media-upload tap (from ingest) — document assets in knowledge folders. */
export function queueAssetKnowledgeSync(
  db: any,
  projects: WorkspaceProject[] | undefined,
  asset: { id: string; workspaceId: string; folderId: string | null },
  _bytes?: Uint8Array,
): void {
  void (async () => {
    const enabled = await knowledgeEnabledFor(projects, asset.workspaceId)
    if (!enabled || !asset.folderId) return
    const config = enabled.knowledge.resolveKnowledgeConfig(enabled.project)
    if (config.sources.mediaFolders.length === 0) return
    enqueueEmbed(asset.workspaceId, { op: 'asset', assetId: asset.id })
  })().catch((err) => log().error('knowledge asset-tap failed', err instanceof Error ? err : new Error(String(err))))
}

/** Asset-delete tap. */
export function queueAssetKnowledgeRemove(
  db: any,
  projects: WorkspaceProject[] | undefined,
  scope: { workspaceId: string; assetId: string },
): void {
  void (async () => {
    const enabled = await knowledgeEnabledFor(projects, scope.workspaceId)
    if (!enabled) return
    enqueueEmbed(scope.workspaceId, { op: 'remove-asset', assetId: scope.assetId })
  })().catch((err) => log().error('knowledge asset-remove-tap failed', err instanceof Error ? err : new Error(String(err))))
}

// ─── The platform task (executes on the queue worker) ───────────────────────

/**
 * Registers 'tangen-knowledge-embed' at boot. The handler re-reads current
 * state (row status, asset bytes) so retries and out-of-order deliveries
 * stay correct; a throwing handler gets the queue backend's retries.
 */
export function registerKnowledgeTasks(db: any, getProjects: () => WorkspaceProject[]): void {
  // Full content reindex (admin Reindex button) — pages every opted-in type's
  // published rows with translations; hash-skips unchanged chunks so re-runs
  // are cheap. Repo files / assets stay CLI-driven.
  registerPlatformTask({
    id: KNOWLEDGE_REINDEX_TASK,
    description: 'Reindexes all opted-in published content into the knowledge base',
    handler: async (jobCtx: any) => {
      const workspaceId: string = jobCtx.workspaceId
      const enabled = await knowledgeEnabledFor(getProjects(), workspaceId)
      if (!enabled) return
      const { knowledge } = enabled
      const { config, adapter, store } = await depsFor(db, enabled.project)
      const base = { store, adapter, chunking: config.chunking, workspaceId }
      const types = ((enabled.project as any)?.schemas ?? []).filter((t: any) => t.knowledge?.enabled)
      let indexed = 0, skipped = 0
      for (const type of types) {
        let offset = 0
        for (;;) {
          const res = await jobCtx.tangen.objects(type.name).status('published').limit(200).offset(offset).get()
          for (const row of res.data as Array<Record<string, unknown>>) {
            let i18n: Record<string, Record<string, unknown>> | undefined
            try {
              const { fetchI18nRows, buildI18nMap } = await import('./i18n')
              const i18nRows = await fetchI18nRows(db, type.name, [String(row.id)], 'all')
              if (i18nRows.length > 0) i18n = buildI18nMap(i18nRows, type)
            } catch { /* no i18n side table */ }
            const r = await knowledge.syncObject(base, type, row, { i18n })
            if (r.action === 'skipped') skipped++
            else indexed++
          }
          if ((res.data as unknown[]).length < 200) break
          offset += 200
        }
      }
      // Curated Q&A pairs ride the same reindex (disabled rows get removed)
      let qaCount = 0
      try {
        const qaStore = knowledge.createQaStore(knowledgeExec(db))
        let offset = 0
        for (;;) {
          const page = await qaStore.list(workspaceId, { limit: 200, offset })
          for (const row of page.rows) {
            const r = await knowledge.syncQa(base, row)
            if (r.action === 'indexed') qaCount++
          }
          if (page.rows.length < 200) break
          offset += 200
        }
      } catch { /* knowledge_qa table absent - no pairs yet */ }
      jobCtx.log?.(`knowledge reindex: ${indexed} indexed, ${skipped} unchanged, ${qaCount} qa`)
    },
  } as never)

  registerPlatformTask({
    id: KNOWLEDGE_EMBED_TASK,
    description: 'Embeds/removes knowledge chunks for changed content',
    handler: async (jobCtx: any, payload: unknown) => {
      const p = (typeof payload === 'string' ? JSON.parse(payload) : payload) as KnowledgeEmbedPayload
      const workspaceId: string = jobCtx.workspaceId
      const projects = getProjects()
      const enabled = await knowledgeEnabledFor(projects, workspaceId)
      if (!enabled) return
      const { knowledge } = enabled
      const { config, adapter, store } = await depsFor(db, enabled.project)
      const base = { store, adapter, chunking: config.chunking, workspaceId }

      switch (p.op) {
        case 'object': {
          const type = (enabled.project as any)?.schemas?.find?.((t: any) => t.name === p.typeName)
          if (!type?.knowledge?.enabled) return
          const res = await jobCtx.tangen.objects(p.typeName).where({ id: { eq: p.objectId } }).limit(1).get()
          const row = res.data[0] as Record<string, unknown> | undefined
          if (row && String(row.status) === 'published') {
            // Side-table translations → per-locale chunks (locale-accurate retrieval)
            let i18n: Record<string, Record<string, unknown>> | undefined
            try {
              const { fetchI18nRows, buildI18nMap } = await import('./i18n')
              const i18nRows = await fetchI18nRows(db, p.typeName, [p.objectId], 'all')
              if (i18nRows.length > 0) i18n = buildI18nMap(i18nRows, type)
            } catch { /* no i18n side table for this type */ }
            const r = await knowledge.syncObject(base, type, row, { i18n })
            jobCtx.log?.(`knowledge: ${p.typeName}/${p.objectId} ${r.action} (${r.chunks} chunks)`)
          } else {
            await knowledge.removeSource(base, 'object', p.objectId)
            jobCtx.log?.(`knowledge: ${p.typeName}/${p.objectId} removed (not published)`)
          }
          return
        }
        case 'remove-object':
          await knowledge.removeSource(base, 'object', p.objectId)
          return
        case 'asset': {
          const exec = knowledgeExec(db)
          const assets = await exec(
            `SELECT id, filename, mime_type, storage_path, folder_id FROM media_assets WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
            [p.assetId, workspaceId],
          )
          const asset = assets[0]
          if (!asset) return
          const folders = asset.folder_id
            ? await exec(`SELECT name FROM media_folders WHERE id = $1 LIMIT 1`, [asset.folder_id])
            : []
          const folderName = folders[0]?.name as string | undefined
          const folderEntry = config.sources.mediaFolders.find((f) => f.name === folderName)
          if (!folderName || !folderEntry) return

          const { resolveStorage } = await import('./storage')
          const storage = resolveStorage(enabled.project)
          const bytes = await storage.read(String(asset.storage_path))
          const extracted = await knowledge.extractText(String(asset.filename), String(asset.mime_type), bytes, config.extractors)
          if (!extracted.ok) {
            jobCtx.log?.(`knowledge: asset ${asset.filename} skipped - ${extracted.skipped}`)
            return
          }
          const r = await knowledge.syncDocument(base, {
            sourceKind: 'asset', sourceId: String(asset.id), group: folderName,
            text: extracted.text!, audience: folderEntry.audience,
            metadata: { title: asset.filename, folder: folderName },
          })
          jobCtx.log?.(`knowledge: asset ${asset.filename} ${r.action} (${r.chunks} chunks)`)
          return
        }
        case 'remove-asset':
          await store.deleteSource(workspaceId, 'asset', p.assetId)
          return
        case 'qa': {
          // Re-read the pair — syncQa embeds enabled rows, removes disabled
          const qaStore = knowledge.createQaStore(knowledgeExec(db))
          const row = await qaStore.get(workspaceId, p.qaId)
          if (!row) {
            await knowledge.removeSource(base, 'qa', p.qaId)
            return
          }
          const r = await knowledge.syncQa(base, row)
          jobCtx.log?.(`knowledge: qa ${p.qaId} ${r.action}`)
          return
        }
        case 'remove-qa':
          await knowledge.removeSource(base, 'qa', p.qaId)
          return
      }
    },
  } as never)
}
