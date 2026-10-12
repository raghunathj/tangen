/**
 * File Name: housekeeping.ts
 * Purpose: The daily and hourly housekeeping a process runs for its
 *          projects (closure plan Phase 3, Unit 3): operational-table
 *          retention (Phase 2) and the
 *          abandoned AI-image reaper. Each has its own timer at its own
 *          cadence, so none of them is a reason for a scheduler loop to tick
 *          every minute on a project with nothing scheduled.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One-shot timers rearmed after each run, unref'd so
 *          they never keep a process alive on their own; `stop()` clears
 *          them, which is what DISPOSE calls. The first retention pass waits
 *          ten minutes after boot (a boot is not the moment for
 *          housekeeping); the reaper runs on the hour after the first ten
 *          minutes too. Tasks are injectable for the test.
 */
import { getLogger } from '@tangen/logging'

const logger = getLogger(['tangen', 'api', 'housekeeping'])

export interface HousekeepingDeps {
  db: unknown
  redis: unknown
  projects: () => unknown[]
  /** Overridable for tests; the defaults are the real passes. */
  tasks?: Partial<HousekeepingTasks>
  timers?: HousekeepingTimers
  /** Delay before the first pass of each task. Default 10 minutes. */
  firstRunDelayMs?: number
}

export interface HousekeepingTasks {
  retention: (deps: HousekeepingDeps) => Promise<unknown>
  aiImageReaper: (deps: HousekeepingDeps) => Promise<unknown>
  /** Every active connection's health, recorded on its row (Extension Kernel K6.3). */
  connectionsHealth: (deps: HousekeepingDeps) => Promise<unknown>
}

export interface HousekeepingTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** One advisory-lock key per task: hashed from its name, stable across processes. */
export function housekeepingLockKey(task: string): number {
  return Number(BigInt.asIntN(32, BigInt(Bun.hash(`tangen:housekeeping:${task}`))))
}

/**
 * Takes the task's session advisory lock on a RESERVED connection (an
 * advisory lock belongs to the session that took it, so acquire and release
 * must ride one connection, never the pool). Returns null when another
 * replica holds it - this pass is theirs - and a release when it is ours. A
 * client that cannot reserve (a fake, pglite) runs unguarded, as before.
 */
export async function acquireTaskLock(db: unknown, task: string): Promise<{ release: () => Promise<void> } | null | 'unguarded'> {
  const raw = (db as { $rawClient?: { reserve?: () => Promise<{ unsafe: (q: string, p?: unknown[]) => Promise<any>; release: () => void }> } })?.$rawClient
  if (typeof raw?.reserve !== 'function') return 'unguarded'
  const conn = await raw.reserve().catch(() => null)
  if (!conn) return 'unguarded'
  const key = housekeepingLockKey(task)
  const rows = await conn.unsafe(`SELECT pg_try_advisory_lock(${key}) AS locked`).catch(() => [{ locked: true }])
  if (!rows?.[0]?.locked) { conn.release(); return null }
  return {
    release: async () => {
      await conn.unsafe(`SELECT pg_advisory_unlock(${key})`).catch(() => {})
      conn.release()
    },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000

const realTimers: HousekeepingTimers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms)
    ;(t as { unref?: () => void }).unref?.()
    return t
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

const defaultTasks: HousekeepingTasks = {
  retention: async (d) => {
    const { runRetention } = await import('../services/retention')
    return runRetention(d.db as never, d.projects() as never)
  },
  aiImageReaper: async (d) => {
    const { reapAbandonedAiImages } = await import('../workers/ai-image-reaper')
    return reapAbandonedAiImages(d.db, d.projects() as never, d.redis)
  },
  connectionsHealth: async (d) => {
    const { sweepConnectionsHealth } = await import('../services/connections-health')
    const { recordJobRun } = await import('../services/job-runs')
    return sweepConnectionsHealth({
      workspaceIds: (d.projects() as Array<{ workspaceId: string }>).map((p) => p.workspaceId),
      // The pass lands in the SAME run history as every scheduled job and
      // task, under `kind: 'housekeeping'` - the platform's own work, which
      // an operator may read and may not pause.
      recordRun: ({ workspaceId, startedAt, summary }) => recordJobRun(d.db, {
        kind: 'housekeeping', name: 'connections-health', workspaceId, startedAt,
        status: summary.failed > 0 ? 'error' : 'ok',
        ...(summary.failed > 0 ? { error: `${summary.failed} of ${summary.checked} connection(s) did not answer` } : {}),
        meta: summary as unknown as Record<string, unknown>,
        actor: { kind: 'system', id: null },
      }),
    })
  },
}

export interface Housekeeping {
  stop(): void
  /** The cadences, for diagnostics. */
  schedule: Array<{ task: keyof HousekeepingTasks; everyMs: number }>
  /** Runs one task now (tests). */
  run(task: keyof HousekeepingTasks): Promise<unknown>
}

/**
 * The cadences, as a CONSTANT (plan-connectors F3 follow-up): the Admin shows
 * what the platform runs for itself, and it must not keep a second copy of
 * these numbers to do it - a schedule that drifts from the timers would be
 * worse than no schedule on screen.
 */
export const HOUSEKEEPING_SCHEDULE: ReadonlyArray<{ task: keyof HousekeepingTasks; everyMs: number; label: string; runName?: string }> = [
  { task: 'retention', everyMs: DAY_MS, label: 'Operational-table retention' },
  { task: 'aiImageReaper', everyMs: HOUR_MS, label: 'Abandoned AI images' },
  { task: 'connectionsHealth', everyMs: HOUR_MS, label: 'Connection health', runName: 'connections-health' },
]

/** Arms the timers, one per task. Returns the handle DISPOSE calls. */
export function startHousekeeping(deps: HousekeepingDeps): Housekeeping {
  const timers = deps.timers ?? realTimers
  const tasks: HousekeepingTasks = { ...defaultTasks, ...(deps.tasks ?? {}) }
  const firstDelay = deps.firstRunDelayMs ?? FIRST_RUN_DELAY_MS
  const schedule: Housekeeping['schedule'] = HOUSEKEEPING_SCHEDULE.map(({ task, everyMs }) => ({ task, everyMs }))
  const handles = new Map<string, unknown>()
  let stopped = false

  const run = async (task: keyof HousekeepingTasks) => {
    // Once per database per pass, whatever the replica count: the task's
    // advisory lock decides which replica runs it; the others skip this pass.
    const lock = await acquireTaskLock(deps.db, task)
    if (lock === null) { logger.debug(`housekeeping ${task}: another replica holds the lock; skipped`); return undefined }
    try { return await tasks[task](deps) }
    catch (err) { logger.warn(`housekeeping ${task} failed: ${err instanceof Error ? err.message : String(err)}`); return undefined }
    finally { if (lock !== 'unguarded') await lock.release() }
  }
  const arm = (task: keyof HousekeepingTasks, everyMs: number, delay: number) => {
    if (stopped) return
    handles.set(task, timers.setTimeout(() => {
      handles.delete(task)
      void run(task).finally(() => arm(task, everyMs, everyMs))
    }, delay))
  }
  for (const s of schedule) arm(s.task, s.everyMs, firstDelay)

  return {
    schedule,
    run,
    stop() {
      stopped = true
      for (const h of handles.values()) timers.clearTimeout(h)
      handles.clear()
    },
  }
}
