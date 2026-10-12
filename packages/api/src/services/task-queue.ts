/**
 * File Name: task-queue.ts
 * Purpose: The generic background-task pipeline — enqueueTask() feeds the
 *          BullMQ 'tangen-tasks' queue when redis is available and otherwise
 *          executes the handler inline, so enqueued work is never silently
 *          dropped (unlike the form queue's fire-and-forget).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Handlers never serialize — jobs carry lookup keys and
 *          the runtime (configured at boot from the loaded workspace configs)
 *          resolves the TaskDefinition + builds the JobContext.
 */
import { queueOptions, redisState } from '../plugins/redis'
import { Queue } from 'bullmq'
import { getLogger } from '@tangen/logging'
import { randomUUID } from 'node:crypto'
import type { JobContext, JobRunRef, TaskDefinition } from '@tangen/types'
import { eventBus } from './event-bus'
import { resolveRunActor, runIdentityFrom } from '../kernel/run-identity'

const logger = getLogger(['tangen', 'api', 'tasks'])

export const TASK_QUEUE_NAME = 'tangen-tasks'

/** Payload carried by each task job — handler resolved in-process. */
export interface TaskJobData {
  workspaceId: string
  taskId: string
  payload?: unknown
  /** Hold the job this long before it becomes runnable (queue-side delay). */
  delaySeconds?: number
  /**
   * Collapse redundant PENDING work: while a job with this key is still
   * queued, enqueueing the same key again is a no-op. Only safe for jobs that
   * reconcile current state rather than replaying a captured one - a claimed
   * (running) job leaves the key free, so a mutation arriving mid-job still
   * gets its follow-up. Omit for everything else; NULL is never deduplicated.
   */
  dedupeKey?: string
  /** The delivery attempt the runner is on (the pg queue's `attempts`, BullMQ's attemptsMade + 1). */
  attempt?: number
  // ── Who enqueued and whose authority the run uses (kernel K6, additive) ──
  initiator?: import('@tangen/types').ActorIdentity | null
  runAs?: 'initiator' | 'system'
  correlationId?: string | null
  causationId?: string | null
  locale?: string | null
}

/** Boot-time wiring: how jobs find their handler and build their context. */
export interface TaskRuntime {
  resolveTask: (workspaceId: string, taskId: string) => TaskDefinition | undefined
  makeJobCtx: (workspaceId: string, run?: JobRunRef) => Promise<JobContext> | JobContext
}

let _runtime: TaskRuntime | null = null

// Platform-internal tasks (reserved 'tangen-' prefix) — resolved AFTER app
// tasks so a site can never be shadowed, and app ids can't collide with ours.
const _platformTasks = new Map<string, TaskDefinition>()

/** Registers a platform task (knowledge embedding, future internals). */
export function registerPlatformTask(def: TaskDefinition): void {
  if (!def.id.startsWith('tangen-')) {
    throw new Error(`platform task ids must start with 'tangen-' (got "${def.id}")`)
  }
  _platformTasks.set(def.id, def)
}

// Extension tasks ('ext:<extensionId>:<name>') — resolved after app tasks
// (a site can override) and before platform internals.
const _extensionTasks = new Map<string, TaskDefinition>()

/** Registers an extension task (id must be 'ext:<extensionId>:<name>'). */
export function registerExtensionTask(def: TaskDefinition): void {
  if (!def.id.startsWith('ext:')) {
    throw new Error(`extension task ids must start with 'ext:' (got "${def.id}")`)
  }
  _extensionTasks.set(def.id, def)
}

/** Called once at server boot with closures over the loaded projects. */
export function configureTaskRuntime(runtime: TaskRuntime): void {
  _runtime = runtime
}

/** Test/reset hook. */
export function resetTaskRuntime(): void {
  _extensionTasks.clear()
  _runtime = null
  _queue = null
  _db = null
  _platformTasks.clear()
  _slotsInUse.clear()
  _slotWaiters.clear()
}

/**
 * Resolves a task definition exactly like executeTask does — app tasks first,
 * then extension tasks, then platform internals. Used by the pg worker to read
 * per-task concurrency limits before claiming.
 */
export function resolveTaskDefinition(workspaceId: string, taskId: string): TaskDefinition | undefined {
  if (!_runtime) return _extensionTasks.get(taskId) ?? _platformTasks.get(taskId)
  return _runtime.resolveTask(workspaceId, taskId) ?? _extensionTasks.get(taskId) ?? _platformTasks.get(taskId)
}

// ── Per-task concurrency (TaskDefinition.concurrency) ───────────────────────
// In-process FIFO semaphore keyed by task id. Caps simultaneous executions of
// one task per process — the seam both backends share (the BullMQ worker and
// inline execution call executeTask; the pg worker adds claim-skip on top for
// cross-process enforcement). Tasks without `concurrency` never touch this.
const _slotsInUse = new Map<string, number>()
const _slotWaiters = new Map<string, Array<() => void>>()

async function acquireTaskSlot(taskId: string, limit: number): Promise<void> {
  const inUse = _slotsInUse.get(taskId) ?? 0
  if (inUse < limit) {
    _slotsInUse.set(taskId, inUse + 1)
    return
  }
  // Park; release() hands the slot over directly (count is NOT decremented on
  // handoff), so a racing fresh acquire can never sneak past the limit.
  await new Promise<void>((resolve) => {
    const waiters = _slotWaiters.get(taskId) ?? []
    waiters.push(resolve)
    _slotWaiters.set(taskId, waiters)
  })
}

function releaseTaskSlot(taskId: string): void {
  const waiters = _slotWaiters.get(taskId)
  if (waiters?.length) {
    const next = waiters.shift()!
    if (waiters.length === 0) _slotWaiters.delete(taskId)
    next()                                // slot transfers to the waiter
    return
  }
  const inUse = (_slotsInUse.get(taskId) ?? 1) - 1
  if (inUse <= 0) _slotsInUse.delete(taskId)
  else _slotsInUse.set(taskId, inUse)
}

let _queue: Queue<TaskJobData> | null = null

// ── Postgres backend (the durable redis-less default) ───────────────────────
let _db: any = null

/** Boot-time wiring for the Postgres queue backend (drizzle db handle). */
export function configureTaskDb(db: any): void {
  _db = db
}

/** Which backend enqueueTask will use — for status displays and tests. */
export function activeQueueBackend(): 'inline' | 'redis' | 'postgres' {
  if (process.env.TANGEN_JOBS_INLINE === '1') return 'inline'
  if (redisState() === 'enabled') return 'redis'
  if (_db) return 'postgres'
  return 'inline'
}

function getTaskQueue(): Queue<TaskJobData> {
  if (!_queue) {
    _queue = new Queue<TaskJobData>(TASK_QUEUE_NAME, {
      ...queueOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    })
  }
  return _queue
}

/**
 * Executes a task job in-process — shared by the worker and the inline
 * fallback. Unknown task ids log and no-op (the task may have been removed
 * from code since the job was enqueued).
 */
export async function executeTask(job: TaskJobData): Promise<void> {
  if (!_runtime) {
    logger.warn(`task "${job.taskId}" dropped - task runtime not configured`)
    return
  }
  const task = _runtime.resolveTask(job.workspaceId, job.taskId) ?? _extensionTasks.get(job.taskId) ?? _platformTasks.get(job.taskId)
  if (!task) {
    logger.warn(`task "${job.taskId}" not registered for workspace ${job.workspaceId} - skipping`)
    return
  }
  const limit = Number.isInteger(task.concurrency) && (task.concurrency as number) > 0
    ? (task.concurrency as number)
    : null
  if (limit) await acquireTaskSlot(job.taskId, limit)

  const startedAt = new Date()
  const runId = randomUUID()
  const emitRun = (type: 'job.run.started' | 'job.run.finished' | 'job.run.failed', extra: Record<string, unknown> = {}) =>
    eventBus.emit({
      id: randomUUID(), type, workspaceId: job.workspaceId, timestamp: new Date().toISOString(),
      payload: { kind: 'task', name: job.taskId, executionId: runId, correlationId: job.correlationId ?? null, ...extra },
    } as Parameters<typeof eventBus.emit>[0])
  // K6: whose authority this run uses - the initiator's, re-resolved now, or
  // Tangen's own. A run whose initiator lost their authority is refused ONCE,
  // recorded as AUTHORITY_LOST, and never retried (it does not throw).
  const identityFields = { initiator: job.initiator ?? null, runAs: job.runAs, correlationId: job.correlationId ?? null, causationId: job.causationId ?? null, locale: job.locale ?? null }
  const resolution = await resolveRunActor(_db, getRedisSafe(), { workspaceId: job.workspaceId, taskId: job.taskId, identity: identityFields, task })
  const runRecord = (status: 'ok' | 'error', extra: Record<string, unknown> = {}) => _db
    ? import('./job-runs').then(({ recordJobRun }) => recordJobRun(_db, {
        kind: 'task', name: job.taskId, workspaceId: job.workspaceId, status, startedAt,
        actor: resolution.ok ? { kind: resolution.actor.identity.kind, id: resolution.actor.identity.kind === 'system' ? null : resolution.actor.identity.id } : null,
        initiator: job.initiator ?? null, executionId: runId, correlationId: job.correlationId ?? null, attempt: job.attempt ?? null,
        ...extra,
      })).catch(() => {})
    : Promise.resolve()
  if (!resolution.ok) {
    logger.warn(`task "${job.taskId}" refused - the initiator lost the authority it runs with (${resolution.reason})`)
    emitRun('job.run.failed', { durationMs: 0, error: `AUTHORITY_LOST: ${resolution.reason}`, code: 'AUTHORITY_LOST' })
    await runRecord('error', { error: `AUTHORITY_LOST: ${resolution.reason}` })
    if (limit) releaseTaskSlot(job.taskId)
    return
  }
  if (resolution.reason) logger.info(`task "${job.taskId}": ${resolution.reason}`)
  emitRun('job.run.started')
  try {
    const ctx = await _runtime.makeJobCtx(job.workspaceId, {
      kind: 'task', id: job.taskId, runId, actor: resolution.actor, initiator: job.initiator ?? null,
      correlationId: job.correlationId ?? null, causationId: job.causationId ?? null, attempt: job.attempt ?? undefined,
    })
    await task.handler(ctx, job.payload)
    emitRun('job.run.finished', { durationMs: Date.now() - startedAt.getTime() })
    void runRecord('ok')
  } catch (err) {
    emitRun('job.run.failed', { durationMs: Date.now() - startedAt.getTime(), error: (err as Error).message })
    void runRecord('error', { error: (err as Error).message, meta: { payload: job.payload ?? null } })
    throw err
  } finally {
    if (limit) releaseTaskSlot(job.taskId)
  }
}

function getRedisSafe(): unknown {
  try { return (require('../plugins/redis') as { getRedis: () => unknown }).getRedis() } catch { return null }
}

export async function enqueueTask(job: TaskJobData): Promise<void> {
  const backend = activeQueueBackend()

  if (backend === 'redis') {
    try {
      await getTaskQueue().add(TASK_QUEUE_NAME, job, job.delaySeconds ? { delay: job.delaySeconds * 1000 } : undefined)
      return
    } catch (err) {
      logger.warn(`task "${job.taskId}" redis enqueue failed (${(err as Error).message}) - trying postgres`)
      if (_db) {
        await pgEnqueue(job)
        return
      }
      await executeTask(job)
      return
    }
  }

  if (backend === 'postgres') {
    await pgEnqueue(job)
    return
  }

  logger.warn(`task "${job.taskId}" running inline - no queue backend (set REDIS_URL or configureTaskDb)`)
  await executeTask(job)
}

/** The channel the worker LISTENs on; payload-free, it means "look again". */
export const JOB_QUEUE_CHANNEL = 'tangen_job_queue'

/**
 * Durable insert - the pg worker loop picks it up.
 *
 * With a dedupeKey the insert is conditional: the partial unique index
 * (drizzle/0037, `WHERE status = 'queued'`) makes a second pending job for the
 * same key a no-op, and ON CONFLICT DO NOTHING turns that into a silent skip
 * rather than an error. Claimed and failed rows are outside the index, so a
 * mutation during a running job, or after a poisoned one, still enqueues.
 *
 * The NOTIFY is a wakeup hint only. It carries no data and is never the record
 * of anything: job_queue is, and the worker's poll remains the fallback for a
 * notification that is missed, dropped or arrives while nothing is listening.
 */
async function pgEnqueue(job: TaskJobData): Promise<void> {
  const { jobQueue } = await import('@tangen/db')
  const { sql } = await import('drizzle-orm')
  const runAt = job.delaySeconds ? new Date(Date.now() + job.delaySeconds * 1000) : undefined

  // K6: the run's identity rides the queue row beside the payload.
  const execution = executionFieldsOf(job)
  if (job.dedupeKey) {
    // With a dedupeKey the insert is conditional: the partial unique index
    // (drizzle/0037) refuses a second QUEUED row with the same key.
    await _db.execute(sql`
      INSERT INTO job_queue (task_id, workspace_id, payload, dedupe_key, execution${runAt ? sql`, run_at` : sql``})
      VALUES (${job.taskId}, ${job.workspaceId}, ${JSON.stringify(job.payload ?? null)}::jsonb, ${job.dedupeKey}, ${JSON.stringify(execution)}::jsonb${runAt ? sql`, ${runAt}` : sql``})
      ON CONFLICT DO NOTHING`)
  } else {
    await _db.insert(jobQueue).values({
      taskId: job.taskId,
      workspaceId: job.workspaceId,
      payload: job.payload ?? null,
      execution,
      ...(runAt ? { runAt } : {}),
    })
  }
  if (!runAt && typeof _db.execute === 'function') {
    await Promise.resolve(_db.execute(sql`SELECT pg_notify(${JOB_QUEUE_CHANNEL}, '')`)).catch(() => {})
  }
}

/** The identity fields a queue row stores (K6). */
export function executionFieldsOf(job: TaskJobData): Record<string, unknown> {
  return { initiator: job.initiator ?? null, runAs: job.runAs ?? null, correlationId: job.correlationId ?? null, causationId: job.causationId ?? null, locale: job.locale ?? null }
}

/** Reads the identity fields back off a queue row. */
export function jobFromQueueRow(row: { task_id: unknown; workspace_id: unknown; payload?: unknown; execution?: unknown; attempts?: unknown }): TaskJobData {
  let payload = row.payload ?? undefined
  if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch { /* keep the string */ } }
  let execution = row.execution ?? null
  if (typeof execution === 'string') { try { execution = JSON.parse(execution) } catch { execution = null } }
  const e = (execution ?? {}) as Record<string, unknown>
  return {
    taskId: String(row.task_id), workspaceId: String(row.workspace_id), payload,
    initiator: (e.initiator as TaskJobData['initiator']) ?? null,
    runAs: (e.runAs as TaskJobData['runAs']) ?? undefined,
    correlationId: (e.correlationId as string | null) ?? null,
    causationId: (e.causationId as string | null) ?? null,
    locale: (e.locale as string | null) ?? null,
    attempt: row.attempts != null ? Number(row.attempts) : undefined,
  }
}

/**
 * An enqueue bound to the execution doing the enqueueing (K6): the run
 * carries who asked and, by default, runs with their authority; a task
 * declared `runAs: 'system'` runs with Tangen's own.
 */
export function makeEnqueue(workspaceId: string, writer?: { exec?: import('@tangen/types').ExecutionContext | null } | null) {
  return (taskId: string, payload?: unknown) => {
    const task = resolveTaskDefinition(workspaceId, taskId)
    return enqueueTask({ workspaceId, taskId, payload, ...runIdentityFrom(writer?.exec ?? null, task) })
  }
}
