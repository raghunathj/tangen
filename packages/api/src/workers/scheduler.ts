/**
 * File Name: scheduler.ts
 * Purpose: Runs a 60-second polling loop that (1) auto-publishes content
 *          objects whose scheduled_at has passed and (2) runs site-developer
 *          scheduled jobs (defineScheduledJob) per workspace,
 *          with a redis lock for multi-process safety.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm (raw SQL for cross-type updates), @tangen/types, @tangen/logging, EventBus
 */

import { randomUUID } from 'node:crypto'
import { getSchema } from '../services/schema-cache'
import { getRedis } from '../plugins/redis'
import { getContentSearchSync } from '../services/search-hooks'
import { sql, eq } from 'drizzle-orm'
import { fields } from '@tangen/db'
import type { TangenEvent, SchemaDefinition, ActorContext, ExecutionContext } from '@tangen/types'
import { createExecution } from '../kernel/execution'
import { buildEvent, emitRecorded } from '../kernel/events'
import { publishObject } from '../services/publish-object'
import { RequestError } from '../lib/errors'
import { legacyIdentityOf, systemActor } from '../kernel/actor'
import { resolveRecordedActor } from '../kernel/resolve-actor'
import { getLogger } from '@tangen/logging'

const logger = getLogger(['tangen', 'api', 'workers'])
import type { DbClient } from '@tangen/db'
import type { WorkspaceProject } from '@tangen/types'
import { eventBus as processEventBus, type EventBus } from '../services/event-bus'
import { isDue } from '../lib/schedule-parser'

/** Consecutive failures that auto-pause a scheduled job. */
export const JOB_FAILURE_THRESHOLD = 5
import { recordJobRun } from '../services/job-runs'
import { isSafeIdent } from '@tangen/types'

const INTERVAL_MS = 60_000

interface ScheduledRow {
  id: string
  workspaceId: string
  typeId: string
  typeName: string
  /** Row slug — rides the object.published payload for by-slug cache invalidation. */
  slug?: string | null
  title?: string | null
}

/**
 * Constructs object.published TangenEvent objects for a batch of rows that were just auto-published.
 * @param rows - The database rows of objects that were updated to published status
 * @returns Array of TangenEvent instances ready to emit on the event bus
 */
export function buildAutoPublishEvents(rows: ScheduledRow[]): TangenEvent[] {
  const now = new Date().toISOString()
  return rows.map(row => ({
    id: randomUUID(),
    type: 'object.published' as const,
    workspaceId: row.workspaceId,
    timestamp: now,
    payload: {
      objectId: row.id,
      typeId: row.typeId,
      typeSlug: row.typeName,
      slug: row.slug ?? null,
      title: String(row.title ?? ''),
      publishedBy: null,
    },
  }))
}

export async function processScheduledObjects(
  db: DbClient,
  eventBus: EventBus,
  projects?: Array<{ workspaceId: string; [k: string]: unknown }>,
  /** Optional, so the published extension-data cache is dropped rather than left to expire. */
  redis?: any,
  /** The content schema; loaded through the schema cache when absent. */
  schemaOverride?: SchemaDefinition,
): Promise<number> {
  const typeResult = await db.execute(sql`
    SELECT DISTINCT id, name, disabled FROM object_types
  `) as unknown
  // postgres.js answers an array, PGlite { rows }: take either.
  const typeRows = (Array.isArray(typeResult) ? typeResult : ((typeResult as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: string; name: string; disabled: boolean }>

  if (!typeRows || typeRows.length === 0) return 0

  let schema: SchemaDefinition | null = schemaOverride ?? null
  let totalPublished = 0

  const UUID_RE = /^[0-9a-fA-F-]{36}$/
  for (const type of typeRows) {
    if (type.disabled) continue
    const tbl = type.name
    if (!isSafeIdent(tbl)) continue

    let dueRows: Array<Record<string, unknown>> = []
    try {
      const result = await db.execute(sql.raw(`
        SELECT * FROM "${tbl}" WHERE status = 'scheduled' AND scheduled_at <= NOW()
      `))
      dueRows = (Array.isArray(result) ? result : (result as any).rows ?? []) as Array<Record<string, unknown>>
    } catch {
      // Table may not have scheduled_at yet — skip silently
      continue
    }
    if (dueRows.length === 0) continue
    if (!schema) schema = await getSchema(db as never, redis ?? getRedis())

    for (const row of dueRows) {
      if (!UUID_RE.test(String(row.id))) continue
      const workspaceId = String(row.workspace_id)
      const id = String(row.id)
      const project = projects?.find((p) => p.workspaceId === workspaceId)
      // K4: the scheduler exercises the SCHEDULING actor's authority
      // asynchronously - re-resolved now, not snapshotted then. A row
      // scheduled before scheduled_by existed publishes once under Tangen's
      // own authority, said so in the log.
      const scheduledBy = typeof row.scheduled_by === 'string' && row.scheduled_by ? row.scheduled_by : null
      let actor: ActorContext
      if (scheduledBy) {
        const resolved = await resolveRecordedActor(db, redis ?? getRedis(), { workspaceId, actorId: scheduledBy, project: project as never })
        if (!resolved.ok) {
          await refuseScheduledPublish(db, eventBus, { tbl, type, row, workspaceId, id, reason: 'AUTHORITY_LOST', detail: resolved.reason, scheduledBy, exec: createExecution({ kind: 'scheduler', source: 'scheduler', workspaceId, actor: systemActor({ workspaceId, reason: 'scheduler' }), initiator: { kind: scheduledBy.startsWith('key_') ? 'api_key' : 'member', id: scheduledBy } }) })
          continue
        }
        actor = resolved.actor
      } else {
        logger.info('Scheduled publish with no recorded scheduler - publishing under the framework\'s own authority once', { type: type.name, id })
        actor = systemActor({ workspaceId, reason: 'scheduler:unattributed' })
      }

      // K5: the tick is an execution of its own; the publish and the refusal ride it.
      const exec = createExecution({ kind: 'scheduler', source: 'scheduler', workspaceId, actor, initiator: scheduledBy ? { kind: actor.identity.kind, id: scheduledBy } : null })
      try {
        const identity = legacyIdentityOf(actor)
        await publishObject({
          db, redis: redis ?? getRedis(), eventBus, schema, workspaceId,
          memberId: identity.memberId, apiKeyId: identity.apiKeyId, memberRole: identity.memberRole,
          permissions: identity.permissions, projects: (projects ?? []) as never, exec,
        }, type.name, id)
        totalPublished++
      } catch (err) {
        const reason: 'AUTHORITY_LOST' | 'VALIDATION' | 'HOOK' | 'ERROR' =
          err instanceof RequestError && err.statusCode === 403 ? 'AUTHORITY_LOST'
          : err instanceof RequestError && err.code === 'VALIDATION_ERROR' ? 'VALIDATION'
          : err instanceof RequestError ? 'ERROR'
          : 'HOOK'
        if (err instanceof RequestError && err.code === 'TYPE_NOT_FOUND') {
          logger.warn('Scheduled auto-publish skipped a type with no generated table', { type: type.name, id })
          continue
        }
        await refuseScheduledPublish(db, eventBus, { tbl, type, row, workspaceId, id, reason, detail: err instanceof Error ? err.message : String(err), scheduledBy, exec })
      }
    }
  }

  return totalPublished
}

/**
 * A due publish that cannot happen is refused ONCE: the object returns to
 * draft with its schedule cleared, the refusal is emitted with its reason,
 * and the tick never sees it again. Before K4 a failing row stayed scheduled
 * and failed silently on every tick.
 */
async function refuseScheduledPublish(
  db: DbClient, eventBus: EventBus,
  input: { tbl: string; type: { id: string; name: string }; row: Record<string, unknown>; workspaceId: string; id: string; reason: 'AUTHORITY_LOST' | 'VALIDATION' | 'HOOK' | 'ERROR'; detail: string; scheduledBy: string | null; exec: ExecutionContext },
): Promise<void> {
  logger.warn('Scheduled publish refused - the object is back in draft and will not be retried', { type: input.type.name, id: input.id, reason: input.reason, detail: input.detail })
  await db.execute(sql`
    UPDATE ${sql.raw(`"${input.tbl}"`)}
    SET status = 'draft', scheduled_at = NULL, scheduled_by = NULL, updated_at = NOW()
    WHERE id = ${input.id}
  `)
  await emitRecorded(eventBus, db, buildEvent({
    type: 'object.publish_refused', workspaceId: input.workspaceId, resource: { kind: 'object', type: input.type.name, id: input.id },
    payload: { objectId: input.id, typeId: input.type.id, typeSlug: input.type.name, title: String(input.row.title ?? ''), reason: input.reason, detail: input.detail, scheduledBy: input.scheduledBy },
  }, { exec: input.exec }))
}


export interface SchedulerJobDeps {
  /** Loaded workspace projects — jobs come from project.jobs.scheduled. */
  projects: WorkspaceProject[]
  /** Optional ioredis client — enables the multi-process lock + shared lastRun. */
  redis?: any
  /** Builds the JobContext (same runtime the task queue uses). */
  makeJobCtx: (workspaceId: string, run?: import('@tangen/types').JobRunRef) => Promise<any> | any
  /** Drizzle db — enables durable lastRun (scheduler_state), the pg advisory
   *  lock for redis-less multi-process safety, and job_runs recording. */
  db?: any
  /** Pause rows (admin- or breaker-created) for a workspace. Omit = nothing paused. */
  getPausedJobs?: (workspaceId: string) => Promise<Array<{ jobId: string }>> | Array<{ jobId: string }>
  /** Circuit breaker sink - pause a job with a reason. Omit = breaker off. */
  pauseJob?: (workspaceId: string, jobId: string, reason: string) => Promise<void>
  /** Consecutive-failure count for the breaker (from job_runs). Required for the breaker. */
  consecutiveFailures?: (workspaceId: string, name: string, max: number) => Promise<number>
}

const SCHEDULER_ADVISORY_LOCK = 761_204_001   // arbitrary app-unique key

function schedulerExec(db: any) {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) return null
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}



// In-memory lastRun fallback for redis-less deployments (single process only)
const localLastRun = new Map<string, number>()

function lastRunKey(ws: string, jobId: string): string {
  return `tangen:jobs:lastrun:${ws}:${jobId}`
}

/**
 * One scheduled-jobs pass: for each project × active env × job, check isDue
 * against the shared lastRun, take the per-minute lock (redis SET NX), run
 * the handler, and record the run. Errors are logged and never break the tick.
 */
export async function runScheduledJobs(deps: SchedulerJobDeps, now = new Date()): Promise<number> {
  const { projects, redis, makeJobCtx, db } = deps
  const redisReady = redis && redis.status === 'ready'
  const exec = db ? schedulerExec(db) : null
  let ran = 0

  // Multi-process guard: only one process runs the pass (covers cron
  // entries in redis mode too; code jobs additionally hold redis SETNX).
  // Advisory locks are SESSION-scoped — acquire and release MUST ride the
  // same connection, but exec() uses the pool (unlock on a different
  // connection ⇒ "you don't own a lock" WARNINGs + a stranded lock that
  // skips future passes). Reserve one dedicated connection for the guard.
  let advisoryHeld = false
  let guard: { unsafe: (q: string, p?: unknown[]) => Promise<any>; release: () => void } | null = null
  const rawClient = (db as any)?.$rawClient ?? (db as any)?.session?.client
  if (exec && typeof rawClient?.reserve === 'function') {
    guard = await rawClient.reserve().catch(() => null)
    if (guard) {
      const rows = await guard.unsafe(`SELECT pg_try_advisory_lock(${SCHEDULER_ADVISORY_LOCK}) AS locked`).catch(() => [{ locked: true }])
      advisoryHeld = Boolean(rows[0]?.locked)
      if (!advisoryHeld) {
        guard.release()
        return 0
      }
    }
  }

  try {

  for (const project of projects) {
    const jobs = project.jobs?.scheduled ?? []
    if (jobs.length === 0) continue

    // Paused code jobs (admin- or breaker-created; per env or '*') are skipped.
    const pausedRows = deps.getPausedJobs ? await deps.getPausedJobs(project.workspaceId) : null

    {
      for (const job of jobs) {
        // Paused (admin or circuit breaker).
        if (pausedRows?.some((r) => r.jobId === job.id)) continue
        // Env-scoped jobs run only in their listed environments — e.g. a backup
        try {
          const key = lastRunKey(project.workspaceId, job.id)

          let lastRun: Date | null = null
          if (redisReady) {
            const raw = await redis.get(key)
            lastRun = raw ? new Date(Number(raw)) : null
          } else if (exec) {
            const rows = await exec(
              `SELECT last_run FROM scheduler_state WHERE workspace_id = $1 AND job_id = $2`,
              [project.workspaceId, job.id],
            )
            lastRun = rows[0]?.last_run ? new Date(rows[0].last_run as string) : null
          } else {
            const raw = localLastRun.get(key)
            lastRun = raw ? new Date(raw) : null
          }

          if (!isDue(job.schedule, now, lastRun, job.timezone)) continue

          // Multi-process guard: one runner per (job, env, minute)
          if (redisReady) {
            const bucket = Math.floor(now.getTime() / 60_000)
            const lock = await redis.set(`tangen:jobs:lock:${key}:${bucket}`, '1', 'PX', 55_000, 'NX')
            if (lock !== 'OK') continue
          }

          // Record that this tick ran the job — on success OR failure. A failing
          // job MUST advance its last_run so it re-fires on its next schedule
          // interval, not on every tick (the retry-storm bug). Durability/retries
          // belong to the queue (the task the job enqueues), not the scheduler.
          const markRan = async () => {
            if (redisReady) { await redis.set(key, String(now.getTime())).catch(() => {}) }
            else if (exec) {
              await exec(
                `INSERT INTO scheduler_state (workspace_id, job_id, last_run) VALUES ($1, $2, $3)
                 ON CONFLICT (workspace_id, job_id) DO UPDATE SET last_run = $3`,
                [project.workspaceId, job.id, now.toISOString()],
              ).catch(() => {})
            } else localLastRun.set(key, now.getTime())
          }

          const startedAt = new Date()
          // Realtime R2: the Jobs runs tab follows these on the `jobs` topic.
          const emitRun = (type: 'job.run.started' | 'job.run.finished' | 'job.run.failed', extra: Record<string, unknown> = {}) =>
            processEventBus.emit({
              id: randomUUID(), type, workspaceId: project.workspaceId, timestamp: new Date().toISOString(),
              payload: { kind: 'scheduled', name: job.id, ...extra },
            } as Parameters<EventBus['emit']>[0])
          emitRun('job.run.started')
          try {
            const ctx = await makeJobCtx(project.workspaceId, { kind: 'scheduled', id: job.id })
            await job.handler(ctx)
            ran++
            emitRun('job.run.finished', { durationMs: Date.now() - startedAt.getTime() })
            if (db) void recordJobRun(db, { kind: 'scheduled', name: job.id, workspaceId: project.workspaceId, status: 'ok', startedAt })
            await markRan()
            logger.info(`Scheduled job "${job.id}" ran`, { workspaceId: project.workspaceId })
          } catch (err) {
            emitRun('job.run.failed', { durationMs: Date.now() - startedAt.getTime(), error: (err as Error).message })
            if (db) await recordJobRun(db, { kind: 'scheduled', name: job.id, workspaceId: project.workspaceId, status: 'error', startedAt, error: (err as Error).message }).catch(() => {})
            await markRan()
            logger.error(
              `Scheduled job "${job.id}" failed: ${(err as Error).message}`,
              err instanceof Error ? err : new Error(String(err)),
            )
            // Circuit breaker: N consecutive failures IN THIS ENV auto-pause the
            // job here (a dev-only job crashing in production stops flooding
            // job_runs; other envs keep running). Resume from the admin.
            if (deps.pauseJob && deps.consecutiveFailures) {
              try {
                const streak = await deps.consecutiveFailures(project.workspaceId, job.id, JOB_FAILURE_THRESHOLD)
                if (streak >= JOB_FAILURE_THRESHOLD) {
                  await deps.pauseJob(project.workspaceId, job.id,
                    `Auto-paused after ${streak} consecutive failures: ${(err as Error).message}`.slice(0, 500))
                  logger.error(`Scheduled job "${job.id}" auto-paused (circuit breaker)`)
                }
              } catch { /* breaker must never break the tick */ }
            }
          }
        } catch (err) {
          // The job handler's own failures are caught above (and advance last_run);
          // this only fires for scheduling-machinery errors (state read, lock).
          logger.error(
            `Scheduler error for job "${job.id}": ${(err as Error).message}`,
            err instanceof Error ? err : new Error(String(err)),
          )
        }
      }
    }
  }
  // Admin-managed cron entries ride the same pass (and the same guard)
  if (exec && db) {
    try {
      const { runCronEntries } = await import('../services/cron-jobs')
      ran += await runCronEntries({ exec, db, projects }, now)
    } catch (err) {
      logger.warn(`cron pass failed: ${(err as Error).message}`)
    }
  }

  } finally {
    if (guard) {
      if (advisoryHeld) await guard.unsafe(`SELECT pg_advisory_unlock(${SCHEDULER_ADVISORY_LOCK})`).catch(() => {})
      guard.release()
    }
  }
  return ran
}

export function startScheduler(
  db: DbClient,
  eventBus: EventBus,
  jobDeps?: SchedulerJobDeps,
): () => void {
  // The tick is the scheduler's own work: due content and due jobs. The
  // daily and hourly housekeeping that used to ride it (retention, form
  // retention, the AI-image reaper) has its own timers in
  // runtime/housekeeping.ts, so a project with nothing scheduled never ticks.
  const tick = async () => {
    try {
      const count = await processScheduledObjects(db, eventBus, jobDeps?.projects, jobDeps?.redis)
      if (count > 0) logger.info('Auto-published scheduled objects', { count })
      // Site-developer scheduled jobs and admin cron entries
      if (jobDeps) await runScheduledJobs(jobDeps)
      // Approved releases whose scheduled time has passed (Phase 5B, Unit 8); the claim is atomic across processes.
      const { processScheduledReleases } = await import('../services/release-scheduler')
      const applied = await processScheduledReleases({ db, eventBus: eventBus as never, redis: jobDeps?.redis ?? null, projects: (jobDeps?.projects ?? []) as never, schema: () => getSchema(db, getRedis()) })
      if (applied > 0) logger.info('Applied scheduled releases', { count: applied })
    } catch (err) {
      logger.error('Scheduler tick error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  const handle = setInterval(tick, INTERVAL_MS)
  // Unref so the interval doesn't keep the process alive during tests/graceful shutdown
  if (typeof handle === 'object' && 'unref' in handle) (handle as NodeJS.Timeout).unref()
  _running++

  return () => { clearInterval(handle); _running = Math.max(0, _running - 1) }
}

let _running = 0

/** How many scheduler loops this process runs (0 when idle). Diagnostics and tests. */
export function schedulerLoops(): number {
  return _running
}

/** The ways a deployment can want the scheduler, for the lifecycle's requirement check and diagnostics. */
export interface SchedulerDemand {
  /** A project declares code-defined scheduled jobs. */
  codeJobs: boolean
  /** An enabled admin cron entry exists. */
  cronEntries: boolean
  /** A content row is waiting to auto-publish. */
  scheduledContent: boolean
  /** An approved release is scheduled to apply (Phase 5B, Unit 8). */
  scheduledReleases: boolean
}

/**
 * Whether anything needs the scheduler loop: configuration (a project with
 * `jobs.scheduled`) or persisted demand (an enabled `cron_jobs` row, a
 * content row with status `scheduled`). Read-only; every probe is one
 * bounded query; a table that does not exist counts as no demand.
 */
export async function schedulerDemand(
  db: DbClient,
  projects?: Array<{ jobs?: { scheduled?: unknown[] }; [k: string]: unknown }>,
): Promise<SchedulerDemand> {
  const demand: SchedulerDemand = { codeJobs: false, cronEntries: false, scheduledContent: false, scheduledReleases: false }
  demand.codeJobs = (projects ?? []).some((p) => (p.jobs?.scheduled?.length ?? 0) > 0)
  const rows = async (q: ReturnType<typeof sql>) => {
    try {
      const r = await db.execute(q) as unknown
      return (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
    } catch { return [] }
  }
  demand.cronEntries = (await rows(sql`SELECT 1 AS one FROM cron_jobs WHERE enabled = true LIMIT 1`)).length > 0
  demand.scheduledReleases = (await rows(sql`SELECT 1 AS one FROM releases WHERE status = 'approved' AND scheduled_at IS NOT NULL LIMIT 1`)).length > 0
  if (!demand.scheduledContent) {
    const types = await rows(sql`SELECT DISTINCT name FROM object_types WHERE disabled = false`)
    for (const t of types) {
      const tbl = String(t.name)
      if (!isSafeIdent(tbl)) continue
      const hit = await rows(sql.raw(`SELECT 1 AS one FROM "${tbl}" WHERE status = 'scheduled' LIMIT 1`))
      if (hit.length > 0) { demand.scheduledContent = true; break }
    }
  }
  return demand
}

/** True when any demand exists. */
export function hasSchedulerDemand(d: SchedulerDemand): boolean {
  return d.codeJobs || d.cronEntries || d.scheduledContent || d.scheduledReleases
}
