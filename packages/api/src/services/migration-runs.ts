/**
 * File Name: migration-runs.ts
 * Purpose: Durable Porter run lifecycle (M-T1). The migration_runs row is
 *   the single source of truth a background worker drives: claim flips
 *   pending->running exactly once, heartbeat proves liveness, progress
 *   accumulates per-outcome counters, cancel is a durable flag polled
 *   between chunks, finish seals status. The per-item report is a
 *   parts-based JSONL ledger in the storage adapter - storage backends
 *   have no append, so each flush writes ONE immutable part file and bumps
 *   results_parts on the row; reading streams the parts in order.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle + @tangen/db migrationRuns; storage adapter
 *   for the ledger. Everything survives restart by construction: state on
 *   the row, results in immutable parts, a resumed writer continues from
 *   the recorded parts count.
 */
import { eq, and, desc, sql } from 'drizzle-orm'
import { randomBytes, randomUUID } from 'node:crypto'
import { migrationRuns } from '@tangen/db'
import type { StorageAdapter } from '@tangen/types'
import { eventBus } from './event-bus'

export type MigrationRunKind = 'export' | 'import' | 'remote_send' | 'remote_receive'
export type MigrationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface MigrationRun {
  id: string
  workspaceId: string
  kind: MigrationRunKind
  status: MigrationRunStatus
  scope: Record<string, unknown>
  counts: Record<string, number>
  totalItems: number
  processedItems: number
  resultsParts: number
  error: string | null
  cancelRequested: boolean
  createdBy: string | null
  createdAt: unknown
  startedAt: unknown
  finishedAt: unknown
  heartbeatAt: unknown
}

/**
 * Every state change of a run is announced on the bus as porter.run.changed
 * (counters and status only), which is how the admin runs list stops
 * polling (realtime/bridge.ts). Fire-and-forget: a listener can never fail
 * a run.
 */
function emitRunChanged(run: MigrationRun | null | undefined): void {
  if (!run) return
  eventBus.emit({
    id: randomUUID(), type: 'porter.run.changed', workspaceId: run.workspaceId,
    timestamp: new Date().toISOString(),
    payload: {
      runId: run.id, kind: run.kind, status: run.status,
      totalItems: run.totalItems ?? 0, processedItems: run.processedItems ?? 0, error: run.error ?? null,
    },
  })
}

// ── migration.progress (realtime R2) ─────────────────────────────────────────

/** Progress frames per run are held to one per this many milliseconds. */
export const PROGRESS_EVENT_MIN_INTERVAL_MS = 1000

const lastProgressEmit = new Map<string, number>()

/**
 * Should a progress event fire for this run now? At most one per second per
 * run, except the final count, which always fires so a bar reaches 100%.
 * Pure apart from the per-run clock it keeps; exported for the test.
 */
export function shouldEmitProgress(
  runId: string,
  now: number,
  processedItems: number,
  totalItems: number,
  minIntervalMs = PROGRESS_EVENT_MIN_INTERVAL_MS,
): boolean {
  const final = totalItems > 0 && processedItems >= totalItems
  const last = lastProgressEmit.get(runId)
  if (!final && last !== undefined && now - last < minIntervalMs) return false
  lastProgressEmit.set(runId, now)
  return true
}

/** Forgets a run's throttle clock (on finish, so the map never grows). */
export function forgetProgressThrottle(runId: string): void {
  lastProgressEmit.delete(runId)
}

function emitProgress(run: MigrationRun | null | undefined, now = Date.now()): void {
  if (!run) return
  if (!shouldEmitProgress(run.id, now, run.processedItems ?? 0, run.totalItems ?? 0)) return
  eventBus.emit({
    id: randomUUID(), type: 'migration.progress', workspaceId: run.workspaceId,
    timestamp: new Date().toISOString(),
    payload: {
      runId: run.id, kind: run.kind, status: run.status,
      totalItems: run.totalItems ?? 0, processedItems: run.processedItems ?? 0,
    },
  })
}

export interface CreateRunInput {
  workspaceId: string
  kind: MigrationRunKind
  scope: Record<string, unknown>
  totalItems: number
  createdBy: string
}

export async function createRun(db: any, input: CreateRunInput): Promise<MigrationRun> {
  const id = `mrun_${randomBytes(8).toString('hex')}`
  const [row] = await db.insert(migrationRuns).values({
    id,
    workspaceId: input.workspaceId,
    kind: input.kind,
    scope: input.scope,
    totalItems: input.totalItems,
    createdBy: input.createdBy,
  }).returning()
  emitRunChanged(row as MigrationRun)
  return row as MigrationRun
}

export async function getRun(db: any, workspaceId: string, runId: string): Promise<MigrationRun | null> {
  const [row] = await db.select().from(migrationRuns)
    .where(and(eq(migrationRuns.id, runId), eq(migrationRuns.workspaceId, workspaceId)))
    .limit(1)
  return (row as MigrationRun | undefined) ?? null
}

export async function listRuns(db: any, workspaceId: string, limit = 50): Promise<MigrationRun[]> {
  return await db.select().from(migrationRuns)
    .where(eq(migrationRuns.workspaceId, workspaceId))
    .orderBy(desc(migrationRuns.createdAt))
    .limit(limit) as MigrationRun[]
}

/**
 * Atomically flips pending -> running. Returns the claimed run, or null when
 * someone else already claimed it (the WHERE on status is the lock).
 */
export async function claimRun(db: any, runId: string): Promise<MigrationRun | null> {
  const now = new Date()
  const rows = await db.update(migrationRuns)
    .set({ status: 'running', startedAt: now, heartbeatAt: now })
    .where(and(eq(migrationRuns.id, runId), eq(migrationRuns.status, 'pending')))
    .returning()
  emitRunChanged(rows[0] as MigrationRun | undefined)
  return (rows[0] as MigrationRun | undefined) ?? null
}

export async function heartbeatRun(db: any, runId: string): Promise<void> {
  await db.update(migrationRuns)
    .set({ heartbeatAt: new Date() })
    .where(eq(migrationRuns.id, runId))
}

/**
 * Accumulates progress: processed_items += delta, counts merged additively.
 * Safe to call per chunk - the row totals stay correct across restarts
 * because deltas are only recorded AFTER their items' ledger entries flush.
 */
/**
 * Records an ALREADY-EXECUTED migration as a completed run in one call -
 * the direct (synchronous) migrate path uses this so every movement, however
 * small, lands in run history with a downloadable per-item report.
 */
export async function recordCompletedRun(
  db: any,
  storage: StorageAdapter,
  input: Omit<CreateRunInput, 'totalItems'> & { results: Record<string, unknown>[] },
): Promise<MigrationRun> {
  const run = await createRun(db, { ...input, totalItems: input.results.length })
  const writer = createRunResultsWriter(db, storage, run.id)
  for (const r of input.results) writer.append(r)
  await writer.close()
  const counts: Record<string, number> = {}
  for (const r of input.results) {
    const outcome = String((r as { outcome?: unknown }).outcome ?? 'unknown')
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }
  await recordProgress(db, run.id, { processedDelta: input.results.length, counts })
  await finishRun(db, run.id, { status: 'completed' })
  return run
}

export async function recordProgress(
  db: any,
  runId: string,
  progress: { processedDelta: number; counts?: Record<string, number> },
): Promise<void> {
  const [row] = await db.select({ counts: migrationRuns.counts }).from(migrationRuns)
    .where(eq(migrationRuns.id, runId)).limit(1)
  const merged: Record<string, number> = { ...((row?.counts as Record<string, number>) ?? {}) }
  for (const [k, v] of Object.entries(progress.counts ?? {})) {
    merged[k] = (merged[k] ?? 0) + v
  }
  const updated = await db.update(migrationRuns)
    .set({
      processedItems: sql`${migrationRuns.processedItems} + ${progress.processedDelta}`,
      counts: merged,
      heartbeatAt: new Date(),
    })
    .where(eq(migrationRuns.id, runId))
    .returning()
  emitRunChanged(updated[0] as MigrationRun | undefined)
  emitProgress(updated[0] as MigrationRun | undefined)
}

export async function finishRun(
  db: any,
  runId: string,
  outcome: { status: 'completed' | 'failed' | 'cancelled'; error?: string },
): Promise<void> {
  const rows = await db.update(migrationRuns)
    .set({ status: outcome.status, error: outcome.error ?? null, finishedAt: new Date() })
    .where(eq(migrationRuns.id, runId))
    .returning()
  emitRunChanged(rows[0] as MigrationRun | undefined)
  forgetProgressThrottle(runId)
}

/** Workspace-scoped: only the owning workspace can cancel its runs. */
export async function requestCancel(db: any, workspaceId: string, runId: string): Promise<void> {
  await db.update(migrationRuns)
    .set({ cancelRequested: true })
    .where(and(eq(migrationRuns.id, runId), eq(migrationRuns.workspaceId, workspaceId)))
}

/**
 * Flips a crashed worker's run (running, heartbeat older than staleAfterMs)
 * back to pending so a fresh worker can claim it - resume IS re-claiming;
 * the ledger's parts count and the engine's unchanged-detection make the
 * repeat cheap. Fresh heartbeats are refused: the worker is alive.
 */
export async function reclaimStaleRun(db: any, runId: string, staleAfterMs: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - staleAfterMs)
  const rows = await db.update(migrationRuns)
    .set({ status: 'pending' })
    .where(and(
      eq(migrationRuns.id, runId),
      eq(migrationRuns.status, 'running'),
      sql`${migrationRuns.heartbeatAt} < ${cutoff}`,
    ))
    .returning({ id: migrationRuns.id })
  return rows.length > 0
}

export async function isCancelRequested(db: any, runId: string): Promise<boolean> {
  const [row] = await db.select({ cancelRequested: migrationRuns.cancelRequested })
    .from(migrationRuns).where(eq(migrationRuns.id, runId)).limit(1)
  return row?.cancelRequested === true
}

// ── results ledger ───────────────────────────────────────────────────────────

function partKey(runId: string, part: number): string {
  return `porter/runs/${runId}/results-${part}.jsonl`
}

export interface RunResultsWriter {
  append(entry: Record<string, unknown>): void
  /** Writes buffered entries as ONE immutable part and bumps results_parts. */
  flush(): Promise<void>
  /** Final flush. */
  close(): Promise<void>
}

/**
 * Parts-based JSONL writer. `startPart` lets a resumed worker continue after
 * a restart: pass the row's current resultsParts and new parts follow on.
 */
export function createRunResultsWriter(
  db: any,
  storage: StorageAdapter,
  runId: string,
  opts: { startPart?: number } = {},
): RunResultsWriter {
  let buffer: Record<string, unknown>[] = []
  let part = opts.startPart ?? 0

  async function flush(): Promise<void> {
    if (buffer.length === 0) return
    const lines = buffer.map((e) => JSON.stringify(e)).join('\n') + '\n'
    buffer = []
    await storage.write(partKey(runId, part), new TextEncoder().encode(lines), {
      contentType: 'application/x-ndjson',
    })
    part += 1
    await db.update(migrationRuns)
      .set({ resultsParts: part })
      .where(eq(migrationRuns.id, runId))
  }

  return {
    append(entry) { buffer.push(entry) },
    flush,
    close: flush,
  }
}

/** Streams every ledger entry across all parts, in write order. */
export async function* readRunResults(
  storage: StorageAdapter,
  runId: string,
  parts: number,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder()
  for (let part = 0; part < parts; part++) {
    const bytes = await storage.read(partKey(runId, part))
    if (!bytes) continue   // a missing part is a hole, not a crash
    for (const line of decoder.decode(bytes).split('\n')) {
      if (line.trim()) yield JSON.parse(line)
    }
  }
}
