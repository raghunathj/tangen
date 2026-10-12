/**
 * File Name: cron-jobs.ts
 * Purpose: Admin-managed cron entries (cron_jobs table) — executed by the
 *          same scheduler pass as code-defined jobs. Two action types:
 *          'url' (webhook-style trigger: 30s timeout, HMAC signature when a
 *          secret is set, SSRF guard) and 'task' (enqueue a defineTask
 *          through the queue backend). Every run lands in job_runs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: lastRun rides scheduler_state with job_id 'cron:<id>'
 *          — the same durability as code jobs. SSRF: private/loopback hosts
 *          are denied unless the workspace jobs config sets
 *          allowPrivateNetworks (dev repos target localhost).
 */
import { createHmac, randomUUID } from 'node:crypto'
import { getLogger } from '@tangen/logging'
import type { WorkspaceProject } from '@tangen/types'
import { isDue } from '../lib/schedule-parser'
import { eventBus } from './event-bus'
import { recordJobRun } from './job-runs'
import { enqueueTask } from './task-queue'

const logger = getLogger(['tangen', 'api', 'cron'])

export type CronAction =
  | { type: 'url'; url: string; method?: string; headers?: Record<string, string>; body?: string; secret?: string }
  | { type: 'task'; taskId: string; payload?: unknown }

export interface CronEntry {
  id: string
  workspaceId: string
  name: string
  schedule: string
  /** IANA zone the cron fields evaluate in; null/absent = server-local time. */
  timezone?: string | null
  action: CronAction
  enabled: boolean
}

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$)/i

function isPrivateTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname
    if (PRIVATE_HOST_RE.test(host)) return true
    const m = /^172\.(\d+)\./.exec(host)
    if (m) {
      const octet = Number(m[1])
      if (octet >= 16 && octet <= 31) return true
    }
    return false
  } catch {
    return true   // unparseable → treat as unsafe
  }
}

/** HMAC-SHA256 of the request body — receivers verify with the shared secret. */
export function signCronBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Executes one cron action. Returns run metadata (URL status code etc.);
 * throws on failure so the caller records an error run.
 */
export async function executeCronAction(
  entry: CronEntry,
  opts: { allowPrivateNetworks?: boolean } = {},
): Promise<Record<string, unknown>> {
  const action = entry.action
  if (action.type === 'task') {
    await enqueueTask({
      workspaceId: entry.workspaceId,
      taskId: action.taskId,
      payload: action.payload,
    })
    return { action: 'task', taskId: action.taskId }
  }

  if (action.type === 'url') {
    if (!/^https?:\/\//i.test(action.url)) throw new Error(`URL must be http(s): ${action.url}`)
    if (isPrivateTarget(action.url) && !opts.allowPrivateNetworks) {
      throw new Error(
        `URL targets a private/loopback host - blocked. Set jobs.allowPrivateNetworks in the workspace config to allow (development only).`,
      )
    }
    const method = (action.method ?? 'POST').toUpperCase()
    const body = method === 'GET' || method === 'HEAD' ? undefined : (action.body ?? '')
    const headers: Record<string, string> = { 'User-Agent': 'tangen-cron/1', ...(action.headers ?? {}) }
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
    if (action.secret) headers['X-Tangen-Signature'] = signCronBody(action.secret, body ?? '')

    const res = await fetch(action.url, {
      method, headers, body,
      signal: AbortSignal.timeout(30_000),
    })
    const meta = { action: 'url', url: action.url, method, status: res.status }
    if (!res.ok) throw Object.assign(new Error(`URL trigger returned ${res.status}`), { meta })
    return meta
  }

  throw new Error(`Unknown cron action type: ${(action as { type?: string }).type}`)
}

interface CronDeps {
  exec: (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>
  db: any
  projects: WorkspaceProject[]
}

/**
 * One cron pass — called from the scheduler's job pass (already under the
 * multi-process guard). Errors are recorded and never break the tick.
 */
export async function runCronEntries(deps: CronDeps, now = new Date()): Promise<number> {
  const rows = await deps.exec(`SELECT * FROM cron_jobs WHERE enabled = true`).catch(() => [])
  let ran = 0

  for (const row of rows) {
    const entry: CronEntry = {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      schedule: String(row.schedule),
      timezone: row.timezone ? String(row.timezone) : null,
      action: row.action as CronAction,
      enabled: true,
    }
    const stateJobId = `cron:${entry.id}`
    try {
      const stateRows = await deps.exec(
        `SELECT last_run FROM scheduler_state WHERE workspace_id = $1 AND job_id = $2`,
        [entry.workspaceId, stateJobId],
      )
      const lastRun = stateRows[0]?.last_run ? new Date(stateRows[0].last_run as string) : null
      if (!isDue(entry.schedule, now, lastRun, entry.timezone ?? undefined)) continue

      const project = deps.projects.find((p) => p.workspaceId === entry.workspaceId)
      const startedAt = new Date()
      // Realtime: the Jobs runs tab follows these three on the `jobs` topic,
      // the way task-queue.ts and scheduler.ts announce their runs.
      const emitRun = (type: 'job.run.started' | 'job.run.finished' | 'job.run.failed', extra: Record<string, unknown> = {}) =>
        eventBus.emit({
          id: randomUUID(), type, workspaceId: entry.workspaceId, timestamp: new Date().toISOString(),
          payload: { kind: 'cron', name: entry.name, ...extra },
        } as Parameters<typeof eventBus.emit>[0])
      emitRun('job.run.started')
      try {
        const meta = await executeCronAction(entry, { allowPrivateNetworks: project?.jobs?.allowPrivateNetworks })
        emitRun('job.run.finished', { durationMs: Date.now() - startedAt.getTime() })
        void recordJobRun(deps.db, { kind: 'cron', name: entry.name, workspaceId: entry.workspaceId, status: 'ok', startedAt, meta })
        ran++
        logger.info(`cron "${entry.name}" ran`, { workspaceId: entry.workspaceId })
      } catch (err) {
        emitRun('job.run.failed', { durationMs: Date.now() - startedAt.getTime(), error: (err as Error).message })
        void recordJobRun(deps.db, {
          kind: 'cron', name: entry.name, workspaceId: entry.workspaceId, status: 'error', startedAt, error: (err as Error).message,
          meta: (err as { meta?: Record<string, unknown> }).meta,
        })
        logger.warn(`cron "${entry.name}" failed: ${(err as Error).message}`)
      }

      await deps.exec(
        `INSERT INTO scheduler_state (workspace_id, job_id, last_run) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, job_id) DO UPDATE SET last_run = $3`,
        [entry.workspaceId, stateJobId, now.toISOString()],
      ).catch(() => {})
    } catch (err) {
      logger.warn(`cron "${entry.name}" pass error: ${(err as Error).message}`)
    }
  }
  return ran
}
