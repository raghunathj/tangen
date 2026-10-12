/**
 * File Name: pg-queue-worker.ts
 * Purpose: The Postgres queue worker — polls job_queue with FOR UPDATE SKIP
 *          LOCKED (multi-process safe), executes tasks via the shared
 *          executeTask path, retries with exponential backoff up to
 *          max_attempts, and does housekeeping (pruning finished jobs).
 *          Started only when the pg backend is active (no REDIS_URL).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Claiming is a single UPDATE…(SELECT…SKIP LOCKED)
 *          statement so concurrent workers never double-claim. Idle polls
 *          back off 2s → 10s; activity resets to 2s.
 */
import { randomUUID } from 'node:crypto'
import { getLogger } from '@tangen/logging'
import { JOB_QUEUE_CHANNEL, jobFromQueueRow } from '../services/task-queue'
import { executeTask, resolveTaskDefinition, type TaskJobData } from '../services/task-queue'

const logger = getLogger(['tangen', 'api', 'tasks'])

export interface PgQueueWorkerOptions {
  /** Jobs claimed per poll (default 5). */
  batchSize?: number
  /** Idle poll interval when the queue is empty (default 2000ms); backs off up to 5×. */
  pollMs?: number
  /**
   * Yield between BACK-TO-BACK full batches (default 25ms). Not a poll: it
   * exists so a long drain cannot monopolise the connection pool or the event
   * loop, which foreground requests share.
   */
  drainPauseMs?: number
  /** Base retry delay; attempt n waits base × 2^(n-1) (default 5000ms). */
  retryBaseMs?: number
  /** Prune finished/failed rows older than this many days (default 7). */
  pruneAfterDays?: number
  /** Start the poll loop immediately (default true; tests drive tick()). */
  autoStart?: boolean
}

export interface PgQueueWorker {
  stop: () => void
  /** One poll pass — exported for tests; returns jobs processed. */
  tick: () => Promise<number>
}

function rawClient(db: any) {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) throw new Error('pg-queue-worker: raw postgres client unavailable')
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}

export function startPgQueueWorker(db: any, opts: PgQueueWorkerOptions = {}): PgQueueWorker {
  const batchSize = opts.batchSize ?? 5
  const basePoll = opts.pollMs ?? 2_000
  const drainPause = opts.drainPauseMs ?? 25
  const retryBase = opts.retryBaseMs ?? 5_000
  const pruneAfterDays = opts.pruneAfterDays ?? 7
  const workerId = `pgq_${randomUUID().slice(0, 8)}`
  const exec = rawClient(db)

  let stopped = false
  let idleFactor = 1
  let lastPrune = 0

  // ── Wakeup ─────────────────────────────────────────────────────────────────
  // A NOTIFY on enqueue turns the idle wait into "sleep until something
  // arrives, or the poll interval elapses". It is a hint and nothing more:
  // job_queue stays the record, and the poll below still runs on its own, so a
  // notification that is missed, dropped, or sent while nobody is listening
  // costs latency and never work. postgres.js gives `listen` its own one
  // connection outside the pool and re-subscribes if it drops, so this does not
  // spend a foreground slot.
  let wake: (() => void) | null = null
  const nudge = () => { const w = wake; wake = null; w?.() }
  let unlisten: (() => Promise<void>) | null = null
  const raw = (db as { $rawClient?: { listen?: (c: string, fn: () => void) => Promise<{ unlisten: () => Promise<void> }> } })?.$rawClient
  if (typeof raw?.listen === 'function') {
    raw.listen(JOB_QUEUE_CHANNEL, nudge)
      .then((sub) => { unlisten = () => sub.unlisten(); logger.debug(`pg queue worker listening on ${JOB_QUEUE_CHANNEL}`) })
      .catch((err) => logger.warn(`pg queue LISTEN unavailable, polling only: ${(err as Error).message}`))
  }

  /** Sleep, unless a job arrives first. */
  function idleWait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { wake = null; resolve() }, ms)
      wake = () => { clearTimeout(timer); resolve() }
    })
  }

  async function tick(): Promise<number> {
    // Per-task concurrency (TaskDefinition.concurrency): tasks whose running
    // rows already meet their limit are excluded from this claim. Best-effort
    // by design — two workers counting in the same instant can each admit a
    // job (the window is one poll cycle); the in-process semaphore inside
    // executeTask still caps each process. Tasks without a limit never land
    // in the exclusion list, so the default claim behavior is unchanged.
    const running: Array<Record<string, unknown>> = await exec(
      `SELECT task_id, workspace_id, count(*)::int AS n FROM job_queue WHERE status = 'running' GROUP BY task_id, workspace_id`,
    ).catch(() => [])
    const atLimit: string[] = []
    for (const r of running) {
      const def = resolveTaskDefinition(String(r.workspace_id), String(r.task_id))
      const limit = def?.concurrency
      if (Number.isInteger(limit) && (limit as number) > 0 && Number(r.n) >= (limit as number)) {
        atLimit.push(String(r.task_id))
      }
    }

    // Claim: flip a batch to running in one statement — SKIP LOCKED keeps
    // concurrent workers from double-claiming.
    //
    // ORDER BY run_at, id, and not `id` alone. Two reasons, and either would be
    // enough on its own.
    //
    // Scheduling: run_at IS the schedule. id only coincides with it because
    // run_at defaults to now() at insert, so for ordinary jobs the two orders
    // are identical. They diverge in exactly the two cases where id is wrong -
    // a job enqueued with delaySeconds, and a job whose retry pushed run_at
    // into the future. Both keep their original low id, so ordering by id let
    // them cut ahead of work that had been due for longer, and made
    // delaySeconds not really delay anything relative to later arrivals.
    //
    // Cost: `ORDER BY id` asks the planner for primary-key order, so it walks
    // job_queue_pkey and filters status afterwards. That is an abort-early bet
    // that pays off only if queued rows are actually found. Once the queue
    // drains and the statistics still say a few rows match, the bet loses every
    // time and the poll walks the ENTIRE retained history to return nothing:
    // measured at 14,984 rows and 13,691 buffers per poll on a 15k-row table,
    // which was 100% of an idle server's database read volume. Ordering by
    // run_at lets the existing job_queue_due_idx (status, run_at) satisfy the
    // filter and the ordering together, so the scan stops at the first row that
    // is not due. Cost then tracks the jobs that are actually claimable rather
    // than the history behind them - flat from 1k to 100k retained rows.
    const claimed: Array<Record<string, unknown>> = await exec(
      `UPDATE job_queue SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM job_queue
           WHERE status = 'queued' AND run_at <= now()
             AND NOT (task_id = ANY($3::text[]))
           ORDER BY run_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, task_id, workspace_id, payload, execution, attempts, max_attempts`,
      [workerId, batchSize, atLimit],
    )

    for (const row of claimed) {
      // Platform quirk: drizzle jsonb writes double-encode — normalize here
      // K6: the run's identity rides the row beside the payload.
      const job: TaskJobData = jobFromQueueRow(row as never)
      try {
        await executeTask(job)
        await exec(`UPDATE job_queue SET status = 'done', finished_at = now() WHERE id = $1`, [row.id])
      } catch (err) {
        const attempts = Number(row.attempts)
        const maxAttempts = Number(row.max_attempts)
        const message = (err as Error).message ?? String(err)
        if (attempts < maxAttempts) {
          const delayMs = retryBase * 2 ** (attempts - 1)
          await exec(
            `UPDATE job_queue SET status = 'queued', last_error = $2, run_at = now() + ($3 || ' milliseconds')::interval WHERE id = $1`,
            [row.id, message, String(delayMs)],
          )
          logger.warn(`task "${job.taskId}" failed (attempt ${attempts}/${maxAttempts}) - retrying in ${delayMs}ms: ${message}`)
        } else {
          await exec(
            `UPDATE job_queue SET status = 'failed', last_error = $2, finished_at = now() WHERE id = $1`,
            [row.id, message],
          )
          logger.error(`task "${job.taskId}" failed permanently after ${attempts} attempts: ${message}`)
        }
      }
    }

    // Housekeeping every ~5 minutes: prune old finished jobs, recover jobs
    // whose worker died mid-run (running > 10 min → back to queued)
    const now = Date.now()
    if (now - lastPrune > 5 * 60_000) {
      lastPrune = now
      await exec(`DELETE FROM job_queue WHERE status IN ('done','failed') AND finished_at < now() - ($1 || ' days')::interval`, [String(pruneAfterDays)]).catch(() => {})
      await exec(`UPDATE job_queue SET status = 'queued', locked_by = NULL WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`).catch(() => {})
      const { pruneJobRuns } = await import('../services/job-runs')
      await pruneJobRuns(db, 30)
      const { pruneExpiredCacheEntries } = await import('../services/cache-driver')
      await pruneExpiredCacheEntries(db)
      const { pruneRateLimitCounters } = await import('../gateway/rate-limit/store')
      await pruneRateLimitCounters(db)
      const { pruneRealtimeEvents } = await import('../realtime/retention-postgres')
      await pruneRealtimeEvents(db)
      const { pruneRealtimePresence } = await import('../realtime/presence-store')
      await pruneRealtimePresence(db)
    }

    return claimed.length
  }

  /**
   * Poll when there is nothing to do; drain when there is.
   *
   * This used to sleep `basePoll` after EVERY tick, including one that claimed
   * a full batch with thousands of rows still queued - so throughput was pinned
   * at batchSize per poll interval whatever the backlog. Measured against a
   * cloud database that was 1.8 jobs/sec, while a single sustained create
   * client enqueues 3.8, and a 9,200-job backlog needed 85 minutes.
   *
   * A full batch means the queue very likely still has work, so the next claim
   * goes out immediately after a short yield. Anything less means the queue is
   * drained (or the rest is deferred by retry backoff or a task concurrency
   * limit), and the idle poll interval is the right behaviour - an idle server
   * must not spin on the database.
   */
  async function loop(): Promise<void> {
    while (!stopped) {
      let processed = 0
      try {
        processed = await tick()
      } catch (err) {
        logger.warn(`pg queue poll failed: ${(err as Error).message}`)
      }
      if (processed >= batchSize) {
        // Still busy: keep draining, with a small yield so a long backlog does
        // not starve foreground requests of pool connections or the event loop.
        idleFactor = 1
        await new Promise((r) => setTimeout(r, drainPause))
        continue
      }
      idleFactor = processed > 0 ? 1 : Math.min(idleFactor + 1, 5)
      await idleWait(basePoll * idleFactor)
    }
  }

  if (opts.autoStart !== false) {
    void loop()
    logger.info(`postgres queue worker started (${workerId}) - durable redis-less tasks`)
  }
  return {
    stop: () => { stopped = true; nudge(); void unlisten?.().catch(() => {}) },
    tick,
  }
}
