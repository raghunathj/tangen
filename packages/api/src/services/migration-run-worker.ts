/**
 * File Name: migration-run-worker.ts
 * Purpose: Background executor for Porter runs (M-T2). Claims the run,
 *   processes its scope in chunks through the content-migrator engine,
 *   appends every outcome to the results ledger, bumps row progress after
 *   each chunk, and polls the durable cancel flag between chunks. Ships as
 *   the 'tangen-porter-run' platform task on the jobs system - Postgres
 *   queue fallback included, Redis optional by construction.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: kind 'promote' executes today; export/import/remote
 *   register their executors in their own arcs (an unregistered kind fails
 *   the run honestly). Progress deltas are recorded AFTER the chunk's
 *   ledger entries flush, so a crash never claims more than the ledger
 *   holds - re-running resumes cheaply because the engine reports
 *   already-identical objects as 'unchanged'.
 */
import { getLogger } from '@tangen/logging'
import { tarGzBundle } from '@tangen/porter'
import { createHash } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { objectTypes } from '@tangen/db'
import type { StorageAdapter } from '@tangen/types'
import {
  claimRun, recordProgress, finishRun, isCancelRequested,
  createRunResultsWriter, type MigrationRun,
} from './migration-runs'
import { resolveStorage } from './storage'
import type { WorkspaceProject } from '@tangen/types'
import { enqueueTask, registerPlatformTask, type TaskJobData } from './task-queue'
import { exportContentToBundle, type ExportScope } from './porter-export'
import { TRANSFER_CHUNK_BYTES, buildMediaUrlMap, makeRemoteMediaFetch, type TransferMediaUrl } from './porter-remote'
import {
  planBundleImport, commitBundleImport, loadAvailableBlockTypes, type ImportOptions,
} from './porter-import'
import { getWorkspaceProvider } from './porter-providers'
import { porterActivePredicate } from './extension-server'
import { loadTypeSchemas } from './schema-diff'

const logger = getLogger('tangen.porter.worker')

export const PORTER_RUN_TASK = 'tangen-porter-run'
const DEFAULT_CHUNK_SIZE = 25

export interface WorkerDeps {
  db: any
  /** Ledger storage (results parts). */
  storage: StorageAdapter
  /** Content-table registry (production passes contentTables). */
  tables: Record<string, any>
  eventBus: { emit: (event: Record<string, unknown>) => unknown }
  redis: unknown
  /** typeName -> typeId for event payloads (best effort). */
  typeIds?: Record<string, string>
  /** Media storage; defaults to the run's workspace project. */
  storageFor?: () => StorageAdapter
  chunkSize?: number
  /** Test seam - awaited after every chunk. */
  onChunkDone?: () => Promise<void> | void
  /** Test seam - forwarded to emitMigrationInvalidation. */
  clearCache?: (redis: unknown, workspaceId: string, typeName: string) => Promise<void>
  /** Workspace project lookup - lets table:* providers resolve from the
   *  project's customTables config. */
  projectFor?: (workspaceId: string) => WorkspaceProject | undefined
}

/**
 * Executes one run to a terminal status. Safe to call repeatedly: only the
 * claimer proceeds (claim is the pending->running lock), finished runs
 * no-op.
 */
export async function executeMigrationRun(deps: WorkerDeps, runId: string): Promise<void> {
  const run = await claimRun(deps.db, runId)
  if (!run) return   // already running/finished - nothing to do

  try {
    if (run.kind === 'export') {
      await executeExport(deps, run)
    } else if (run.kind === 'import') {
      await executeImport(deps, run)
    } else if (run.kind === 'remote_receive') {
      // The transfer already unpacked a normal bundle - import it (R-T4:
      // same S4 identity cascade, statuses, providers, revisions).
      await executeImport(deps, run)
    } else if (run.kind === 'remote_send') {
      await executeRemoteSend(deps, run)
    } else {
      await finishRun(deps.db, runId, {
        status: 'failed',
        error: `no executor registered for kind "${run.kind}" yet`,
      })
    }
  } catch (err: any) {
    logger.error(`porter run ${runId} failed`, err instanceof Error ? err : new Error(String(err)))
    await finishRun(deps.db, runId, { status: 'failed', error: String(err?.message ?? err) })
  }
}


/**
 * Sender-side remote transfer (R-T3): packages the bundle as tar.gz and
 * streams it to the receiver in sha256-confirmed chunks. Resume is free:
 * the receiver's ledger says which chunks are confirmed and only the rest
 * go over the wire - re-running a failed send run continues, never
 * restarts.
 */
async function executeRemoteSend(deps: WorkerDeps, run: MigrationRun): Promise<void> {
  const scope = run.scope as { bundleId?: string; receiverUrl?: string; token?: string; senderLabel?: string; options?: Record<string, unknown> }
  if (!scope.bundleId || !scope.receiverUrl || !scope.token) {
    await finishRun(deps.db, run.id, { status: 'failed', error: 'remote_send runs need bundleId, receiverUrl and token in scope' })
    return
  }
  const base = scope.receiverUrl.replace(/\/+$/, '')
  const authHeaders = { 'X-Tangen-Transfer': scope.token }

  const manifestBytes = await deps.storage.read(`porter/bundles/${scope.bundleId}/manifest.json`)
  if (!manifestBytes) {
    await finishRun(deps.db, run.id, { status: 'failed', error: `bundle ${scope.bundleId} not found in porter storage` })
    return
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes))

  // R-T5: when porter storage can mint fetchable URLs (S3 presigned or
  // public), media bytes skip the stream - the receiver pulls them straight
  // from object storage. Local storage returns null and the bytes ride the
  // chunked archive as always.
  const mediaUrls = await buildMediaUrlMap(deps.storage, scope.bundleId).catch(() => null)
  const archive = await tarGzBundle(deps.storage, scope.bundleId,
    mediaUrls ? { excludePrefix: 'media/files/' } : {})
  const archiveSha256 = createHash('sha256').update(archive).digest('hex')
  const chunkSize = TRANSFER_CHUNK_BYTES
  const totalChunks = Math.max(1, Math.ceil(archive.byteLength / chunkSize))
  if (mediaUrls && mediaUrls.length > 0) {
    await recordProgress(deps.db, run.id, { processedDelta: 0, counts: { mediaByUrl: mediaUrls.length } })
  }

  const startRes = await fetch(`${base}/api/v1/porter/receive/transfers`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      bundleId: scope.bundleId,
      manifest,
      totalBytes: archive.byteLength,
      totalChunks,
      archiveSha256,
      options: scope.options,
      senderLabel: scope.senderLabel,
      ...(mediaUrls && mediaUrls.length > 0 ? { mediaUrls } : {}),
    }),
  })
  if (!startRes.ok) {
    throw new Error(`receiver refused the transfer (HTTP ${startRes.status}): ${(await startRes.text()).slice(0, 500)}`)
  }
  const startData = (await startRes.json()) as { data: { runId: string; confirmed: number[] } }
  const confirmed = new Set<number>(startData.data.confirmed ?? [])
  if (confirmed.size > 0) {
    await recordProgress(deps.db, run.id, { processedDelta: 0, counts: { resumedChunks: confirmed.size } })
  }

  let cancelled = false
  for (let i = 0; i < totalChunks; i++) {
    if (confirmed.has(i)) continue
    if (await isCancelRequested(deps.db, run.id)) { cancelled = true; break }
    const chunk = archive.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, archive.byteLength))
    const res = await fetch(`${base}/api/v1/porter/receive/transfers/chunk?index=${i}`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'content-type': 'application/octet-stream',
        'x-chunk-sha256': createHash('sha256').update(chunk).digest('hex'),
      },
      body: chunk as unknown as BodyInit,
    })
    if (!res.ok) {
      throw new Error(`receiver refused chunk ${i} (HTTP ${res.status}): ${(await res.text()).slice(0, 500)}`)
    }
    await recordProgress(deps.db, run.id, { processedDelta: 1, counts: { chunks: 1 } })
    await deps.onChunkDone?.()
  }
  if (cancelled) {
    await finishRun(deps.db, run.id, { status: 'cancelled' })
    return
  }

  const fin = await fetch(`${base}/api/v1/porter/receive/transfers/finish`, { method: 'POST', headers: authHeaders })
  if (!fin.ok) {
    throw new Error(`receiver failed to finish the transfer (HTTP ${fin.status}): ${(await fin.text()).slice(0, 500)}`)
  }
  await finishRun(deps.db, run.id, { status: 'completed' })
}

/**
 * Resolves the content-migrator `revision` input from the target env's type
 * row (typeId + admin versioning config). Returns undefined - no snapshots -
 * when the type is unknown, versioning is disabled, or the schema tables are
 * unavailable (harness databases): the run itself must never fail over this.
 */
async function resolveRevisionInput(
  db: any,
  typeName: string,
): Promise<{ typeId: string; maxVersions?: number } | undefined> {
  try {
    const [type] = await db.select({ id: objectTypes.id, adminConfig: objectTypes.adminConfig }).from(objectTypes)
      .where(and(eq(objectTypes.name, typeName)))
      .limit(1)
    if (!type) return undefined
    const versioning = (type.adminConfig as any)?.versioning
    if (versioning?.enabled === false) return undefined
    return { typeId: type.id as string, maxVersions: versioning?.maxVersions ?? 10 }
  } catch {
    return undefined
  }
}

/**
 * The one storage adapter Porter uses for run ledgers (and later bundles):
 * the workspace's configured backend under a reserved pseudo-env slug, so
 * routes and workers always resolve the SAME adapter.
 */
export function resolvePorterStorage(project?: WorkspaceProject): StorageAdapter {
  return resolveStorage(project)
}


async function executeExport(deps: WorkerDeps, run: MigrationRun): Promise<void> {
  const scope = run.scope as ExportScope & { bundleId?: string }
  if (!scope.bundleId) {
    await finishRun(deps.db, run.id, { status: 'failed', error: 'export runs need a bundleId in scope' })
    return
  }

  // The manifest's schema contract IS the A-T5 fingerprint of the source env.
  const fingerprint = await loadTypeSchemas(deps.db)
  const types = fingerprint.map((t) => ({ name: t.name, localized: t.localized }))
  const storageFor = deps.storageFor ?? (() => resolveStorage(undefined))

  // Providers of extensions not active in the source environment are not exported (Phase 4, Unit 11).
  const exportActive = await porterActivePredicate(run.workspaceId)
  const out = await exportContentToBundle({
    db: deps.db,
    workspaceId: run.workspaceId,
    bundleId: scope.bundleId,
    bundleStorage: deps.storage,
    mediaStorage: storageFor(),
    tables: deps.tables,
    types,
    scope,
    schemaFingerprint: fingerprint,
    createdAt: new Date().toISOString(),
    createdBy: run.createdBy ?? 'system',
    providerFor: (key) => getWorkspaceProvider(deps.projectFor?.(run.workspaceId) as never, key, exportActive),
  })

  const total = Object.values(out.counts).reduce((n, c) => n + c, 0)
  await recordProgress(deps.db, run.id, { processedDelta: total, counts: out.counts })
  await finishRun(deps.db, run.id, { status: 'completed' })
}

async function executeImport(deps: WorkerDeps, run: MigrationRun): Promise<void> {
  const scope = run.scope as { bundleId?: string; options?: ImportOptions; mediaUrls?: TransferMediaUrl[] }
  if (!scope.bundleId) {
    await finishRun(deps.db, run.id, { status: 'failed', error: 'import runs need a bundleId' })
    return
  }
  const options: ImportOptions = scope.options ?? { identityMode: 'match', statusMode: 'preserve' }
  const storageFor = deps.storageFor ?? (() => resolveStorage(undefined))

  // Resolve what the TARGET can render, so a page using a component that was
  // never deployed there is caught here rather than by a visitor.
  const availableBlockTypes = await loadAvailableBlockTypes(deps.db)
  const plan = await planBundleImport({
    availableBlockTypes,
    db: deps.db,
    workspaceId: run.workspaceId,
    bundleStorage: deps.storage,
    bundleId: scope.bundleId,
    tables: deps.tables,
    options,
  })
  // A page whose blocks this environment cannot render must NOT land. The
  // schema gate never saw these - they live inside component field values -
  // so before this the import succeeded and the page appeared blank to a
  // visitor, with nothing to point at.
  if (plan.blockTypeBlockers.length > 0) {
    await finishRun(deps.db, run.id, {
      status: 'failed',
      error: `This environment cannot render every block in the import:\n${
        plan.blockTypeBlockers.map((b) => `- ${b.reason}`).join('\n')}`,
    })
    return
  }

  // Version-history parity: resolve revision settings for every planned
  // type from the target env schema (best effort - absent types get none).
  const revisionByType: Record<string, { typeId: string; maxVersions?: number }> = {}
  for (const planTypeName of new Set(plan.items.map((i) => i.typeName))) {
    const rev = await resolveRevisionInput(deps.db, planTypeName)
    if (rev) revisionByType[planTypeName] = rev
  }

  // Providers of extensions not active in the target environment are not imported; their sections stay archival.
  const importActive = await porterActivePredicate(run.workspaceId)
  const out = await commitBundleImport({
    db: deps.db,
    workspaceId: run.workspaceId,
    bundleStorage: deps.storage,
    bundleId: scope.bundleId,
    mediaStorage: storageFor(),
    tables: deps.tables,
    plan,
    options,
    createdBy: run.createdBy ?? 'system',
    revision: revisionByType,
    providerFor: (key) => getWorkspaceProvider(deps.projectFor?.(run.workspaceId) as never, key, importActive),
    ...(scope.mediaUrls && scope.mediaUrls.length > 0
      ? { mediaFetch: makeRemoteMediaFetch(scope.mediaUrls) }
      : {}),
  })

  const writer = createRunResultsWriter(deps.db, deps.storage, run.id, { startPart: run.resultsParts })
  const counts: Record<string, number> = {}
  for (const r of out.results) {
    writer.append({ ...r })
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1
  }
  for (const [key, res] of Object.entries(out.providers ?? {})) {
    counts[`provider:${key}`] = res.created + res.updated
    writer.append({ typeName: `provider:${key}`, outcome: 'applied', created: res.created, updated: res.updated })
    // A provider that carries several kinds of row (Studio's five key
    // families) reports each one, so the summary says WHAT moved rather
    // than only how much.
    for (const [family, n] of Object.entries(res.counts ?? {})) {
      counts[`provider:${key}:${family}`] = n
    }
    // Refusals and warnings are LEDGER rows, not just a number: the operator
    // has to be able to read which key was refused and why. Refusals count
    // as failures of their own row - nothing was written for them - while a
    // warning rode along with a row that was.
    for (const r of res.refused ?? []) {
      counts[`provider:${key}:refused`] = (counts[`provider:${key}:refused`] ?? 0) + 1
      writer.append({ typeName: `provider:${key}`, objectId: r.key, outcome: 'refused', error: r.reason })
    }
    for (const w of res.warnings ?? []) {
      counts[`provider:${key}:warning`] = (counts[`provider:${key}:warning`] ?? 0) + 1
      writer.append({ typeName: `provider:${key}`, objectId: w.key, outcome: 'warning', error: w.reason })
    }
  }
  await writer.close()
  await recordProgress(deps.db, run.id, { processedDelta: out.results.length, counts })
  await finishRun(deps.db, run.id, { status: 'completed' })
}

// ── jobs-system wiring ───────────────────────────────────────────────────────

export interface PorterRunPayload { runId: string }

/** Enqueues a run for background execution (jobs system, pg fallback). */
export async function enqueuePorterRun(
  job: { workspaceId: string; runId: string },
  enqueue: (job: TaskJobData) => Promise<void> = enqueueTask,
): Promise<void> {
  await enqueue({
    workspaceId: job.workspaceId,
    taskId: PORTER_RUN_TASK,
    payload: { runId: job.runId } satisfies PorterRunPayload,
  })
}

/** Registers the platform task; deps are bound at server boot. */
export function registerPorterRunTask(deps: WorkerDeps): void {
  registerPlatformTask({
    id: PORTER_RUN_TASK,
    description: 'Executes a Porter run (export/import/transfer) in the background',
    handler: async (_jobCtx: any, payload: unknown) => {
      const runId = (payload as PorterRunPayload | undefined)?.runId
      if (!runId) throw new Error('porter run payload needs runId')
      await executeMigrationRun(deps, runId)
    },
  })
}
