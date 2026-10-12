/**
 * File Name: cron.ts
 * Purpose: Admin routes for the Cron Manager — CRUD over cron_jobs, run-now,
 *          the job_runs history feed, and the read-only code-job listing.
 *          Writes need the `manage:cron` capability (owners/admins pass);
 *          reads need an admin session.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Validation is strict at the edge: schedules must
 *          parse (isValidSchedule), URL actions must be http(s), and the
 *          SSRF guard runs at execution time as well (defense in depth).
 */
import { randomUUID, randomBytes } from 'node:crypto'
import { and, eq, inArray, notInArray, desc, ilike, gte, lte, count } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { cronJobs, jobRuns } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { wakeScheduler } from '../../runtime/process'
import { requireCapability } from '../../lib/member-access'
import { getPausedJobs, isJobPaused, pauseJob, resumeJob } from '../../services/paused-jobs'
import { consecutiveFailures } from '../../services/job-runs'
import { enqueueTask } from '../../services/task-queue'
import { isValidSchedule, isValidTimezone } from '../../lib/schedule-parser'
import { executeCronAction, type CronAction, type CronEntry } from '../../services/cron-jobs'
import { recordJobRun, lastHousekeepingRuns, queryValues } from '../../services/job-runs'

// Custom headers ride the outbound request as-is, so the shape is allow-listed
// hard at the edge: bounded count/lengths, clean names, no CR/LF smuggling.
// Reserved names can never be set - most importantly the HMAC signature header
// (executeCronAction also applies the real signature AFTER custom headers, so
// a stored forgery could never win anyway; this is defense in depth).
const RESERVED_HEADERS = new Set(['x-tangen-signature', 'host', 'content-length', 'transfer-encoding', 'connection'])
const HEADER_NAME_RE = /^[A-Za-z][A-Za-z0-9-]*$/
const MAX_HEADERS = 20
const MAX_BODY_BYTES = 32 * 1024

function validateUrlHeaders(headers: unknown): Record<string, string> | undefined {
  if (headers === undefined || headers === null) return undefined
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new RequestError('VALIDATION_ERROR', 'headers must be a name-value map', 422)
  }
  const entries = Object.entries(headers as Record<string, unknown>)
  if (entries.length === 0) return undefined
  if (entries.length > MAX_HEADERS) {
    throw new RequestError('VALIDATION_ERROR', `At most ${MAX_HEADERS} custom headers`, 422)
  }
  const clean: Record<string, string> = {}
  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name) || name.length > 64) {
      throw new RequestError('VALIDATION_ERROR', `Invalid header name "${name}"`, 422)
    }
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new RequestError('VALIDATION_ERROR', `Header "${name}" is reserved and cannot be set`, 422)
    }
    if (typeof value !== 'string' || value.length > 1024 || /[\r\n]/.test(value)) {
      throw new RequestError('VALIDATION_ERROR', `Invalid header value for "${name}"`, 422)
    }
    clean[name] = value
  }
  return clean
}

function validateUrlBody(body: unknown, method: string): string | undefined {
  if (body === undefined || body === null || body === '') return undefined
  if (typeof body !== 'string') throw new RequestError('VALIDATION_ERROR', 'body must be a string of JSON', 422)
  if (method === 'GET' || method === 'HEAD') {
    throw new RequestError('VALIDATION_ERROR', `A body cannot be sent with ${method}`, 422)
  }
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    throw new RequestError('VALIDATION_ERROR', `body exceeds ${MAX_BODY_BYTES / 1024}KB`, 422)
  }
  try {
    JSON.parse(body)
  } catch {
    throw new RequestError('VALIDATION_ERROR', 'body must be valid JSON', 422)
  }
  return body
}

/** Exported for tests — the write routes funnel every action through this. */
export function validateAction(action: unknown): CronAction {
  const a = action as CronAction
  if (a?.type === 'url') {
    if (!a.url || !/^https?:\/\//i.test(a.url)) throw new RequestError('VALIDATION_ERROR', 'URL actions need an http(s) url', 422)
    if (a.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(a.method.toUpperCase())) {
      throw new RequestError('VALIDATION_ERROR', `Unsupported method: ${a.method}`, 422)
    }
    const method = (a.method ?? 'POST').toUpperCase()
    const headers = validateUrlHeaders(a.headers)
    const body = validateUrlBody(a.body, method)
    return {
      type: 'url', url: a.url,
      ...(a.method ? { method: a.method } : {}),
      ...(headers ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(a.secret ? { secret: a.secret } : {}),
    }
  }
  if (a?.type === 'task') {
    if (!a.taskId) throw new RequestError('VALIDATION_ERROR', 'Task actions need a taskId', 422)
    // K6: a task id lives in one of two namespaces - the site's own kebab-case
    // ids, or an extension's `ext:<extension>:<name>`. Anything else is not a
    // task this deployment can have, and a cron entry naming it would run
    // nothing on every tick.
    if (!/^(ext:[a-z0-9][a-z0-9-]*:)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(a.taskId))) {
      throw new RequestError('VALIDATION_ERROR', `Invalid taskId "${a.taskId}" - a site task id or ext:<extension>:<name>`, 422)
    }
    return a
  }
  throw new RequestError('VALIDATION_ERROR', "action.type must be 'url' or 'task'", 422)
}

function validateEntry(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim()
  if (!name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
  const schedule = String(body.schedule ?? '').trim()
  if (!isValidSchedule(schedule)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid schedule "${schedule}" - use 'every Nm/Nh' or 5-field cron`, 422)
  }
  // Optional IANA timezone; blank/null = server-local time (the default).
  const rawTz = body.timezone == null ? '' : String(body.timezone).trim()
  if (rawTz && !isValidTimezone(rawTz)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid timezone "${rawTz}" - use an IANA name like 'Asia/Kolkata'`, 422)
  }
  return { name, schedule, timezone: rawTz || null, action: validateAction(body.action) }
}

export const cronAdminRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/cron', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const rows = await ctx.db.select().from(cronJobs)
        .where(and(eq(cronJobs.workspaceId, ctx.workspaceId)))
        .orderBy(desc(cronJobs.createdAt))
      // Secrets never leave the server — masked in list/detail responses
      return {
        data: rows.map((r: any) => ({
          ...r,
          action: r.action?.secret ? { ...r.action, secret: '••••••' } : r.action,
        })),
      }
    })

    .post('/api/v1/admin/cron', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const { name, schedule, timezone, action } = validateEntry(ctx.body ?? {})
      const row = {
        id: `cron_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        workspaceId: ctx.workspaceId,
        name, schedule, timezone, action,
        enabled: (ctx.body?.enabled as boolean | undefined) ?? true,
        createdBy: ctx.memberId ?? null,
      }
      await ctx.db.insert(cronJobs).values(row)
      void wakeScheduler().catch(() => {})   // persisted demand: an idle scheduler wakes
      return { data: row }
    })

    // Convenience: server-generated signing secret for URL actions
    .post('/api/v1/admin/cron/secret', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      return { data: { secret: randomBytes(24).toString('hex') } }
    })

    .patch('/api/v1/admin/cron/:id', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const existing = await ctx.db.select().from(cronJobs)
        .where(and(eq(cronJobs.id, ctx.params.id), eq(cronJobs.workspaceId, ctx.workspaceId)))
        .limit(1)
      if (!existing.length) throw new RequestError('NOT_FOUND', 'Cron entry not found', 404)

      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if (ctx.body?.enabled !== undefined) patch.enabled = Boolean(ctx.body.enabled)
      if (ctx.body?.name !== undefined || ctx.body?.schedule !== undefined || ctx.body?.action !== undefined || ctx.body?.timezone !== undefined) {
        const merged = validateEntry({
          name: ctx.body?.name ?? existing[0].name,
          schedule: ctx.body?.schedule ?? existing[0].schedule,
          timezone: ctx.body?.timezone !== undefined ? ctx.body.timezone : existing[0].timezone,
          action: ctx.body?.action ?? existing[0].action,
        })
        Object.assign(patch, merged)
      }
      await ctx.db.update(cronJobs).set(patch)
        .where(and(eq(cronJobs.id, ctx.params.id), eq(cronJobs.workspaceId, ctx.workspaceId)))
      void wakeScheduler().catch(() => {})
      return { data: { id: ctx.params.id, ...patch } }
    })

    .delete('/api/v1/admin/cron/:id', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      await ctx.db.delete(cronJobs)
        .where(and(eq(cronJobs.id, ctx.params.id), eq(cronJobs.workspaceId, ctx.workspaceId)))
      return { data: { deleted: true } }
    })

    .post('/api/v1/admin/cron/:id/run', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const rows = await ctx.db.select().from(cronJobs)
        .where(and(eq(cronJobs.id, ctx.params.id), eq(cronJobs.workspaceId, ctx.workspaceId)))
        .limit(1)
      if (!rows.length) throw new RequestError('NOT_FOUND', 'Cron entry not found', 404)
      const r = rows[0]
      const entry: CronEntry = {
        id: r.id, workspaceId: r.workspaceId, name: r.name, schedule: r.schedule, action: r.action as CronAction, enabled: r.enabled,
      }
      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === ctx.workspaceId)
      const startedAt = new Date()
      try {
        const meta = await executeCronAction(entry, { allowPrivateNetworks: project?.jobs?.allowPrivateNetworks })
        void recordJobRun(ctx.db, { kind: 'cron', name: entry.name, workspaceId: entry.workspaceId, status: 'ok', startedAt, meta: { ...meta, manual: true } })
        return { data: { ok: true, ...meta } }
      } catch (err) {
        void recordJobRun(ctx.db, { kind: 'cron', name: entry.name, workspaceId: entry.workspaceId, status: 'error', startedAt, error: (err as Error).message, meta: { manual: true } })
        throw new RequestError('CRON_RUN_FAILED', (err as Error).message, 502)
      }
    })

    .get('/api/v1/admin/jobs/runs', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const limit = Math.min(Number(ctx.query.limit) || 25, 100)
      const offset = Number(ctx.query.offset) || 0
      const conditions = [eq(jobRuns.workspaceId, ctx.workspaceId)]
      // Kind and status are multi-select facets: one value or several, kept
      // ("is any of") or dropped ("is none of", `<facet>Op=not-in`).
      for (const [column, raw, op] of [
        [jobRuns.kind, ctx.query.kind, ctx.query.kindOp],
        [jobRuns.status, ctx.query.status, ctx.query.statusOp],
      ] as const) {
        const values = queryValues(raw)
        if (values.length === 0) continue
        conditions.push(String(op) === 'not-in' ? notInArray(column, values) : inArray(column, values))
      }
      if (ctx.query.q) conditions.push(ilike(jobRuns.name, `%${String(ctx.query.q)}%`))
      if (ctx.query.from) {
        const from = new Date(String(ctx.query.from))
        if (!Number.isNaN(from.getTime())) conditions.push(gte(jobRuns.startedAt, from))
      }
      if (ctx.query.to) {
        // Date-only "to" means through the end of that day; time-bearing = end of minute
        const raw = String(ctx.query.to)
        const to = new Date(new Date(raw).getTime() + (raw.includes('T') ? 59_999 : 86_399_999))
        if (!Number.isNaN(to.getTime())) conditions.push(lte(jobRuns.startedAt, to))
      }
      const rows = await ctx.db.select().from(jobRuns)
        .where(and(...conditions))
        .orderBy(desc(jobRuns.startedAt))
        .limit(limit).offset(offset)
      const [{ n: total }] = await ctx.db.select({ n: count() }).from(jobRuns).where(and(...conditions))
      return { data: rows, meta: { total: Number(total), limit, offset } }
    })

    .get('/api/v1/admin/jobs/definitions', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const project = ((ctx.workspaceProjects ?? []) as any[]).find((p) => p.workspaceId === ctx.workspaceId)
      const pausedRows = await getPausedJobs(ctx.db, ctx.workspaceId)
      const scheduled = await Promise.all((project?.jobs?.scheduled ?? []).map(async (j: any) => {
        const paused = isJobPaused(pausedRows, j.id)
        const row = pausedRows.find((r) => r.jobId === j.id)
        // Failure streak (this env) - lets the UI flag a crash-looping job
        const failStreak = paused ? 0 : await consecutiveFailures(ctx.db, ctx.workspaceId, j.id, 5)
        return {
          id: j.id, schedule: j.schedule, timezone: j.timezone ?? null,
          paused, pausedReason: row?.reason ?? null, failStreak,
        }
      }))
      /**
       * What the PLATFORM runs for itself, on its own timers: retention, the
       * AI-image reaper and the hourly connection health sweep. It was
       * invisible - an operator could not tell whether the hourly check was
       * happening at all (the user, 2026-09-20) - so it is listed here, with
       * its last run, and it is READ-ONLY: housekeeping has no queue, no
       * retry and no pause, because a platform that stops checking its own
       * connections when someone clicks pause is worse than one that cannot
       * be paused.
       */
      const { HOUSEKEEPING_SCHEDULE } = await import('../../runtime/housekeeping')
      const lastRuns = await lastHousekeepingRuns(ctx.db, ctx.workspaceId)
      const housekeeping = HOUSEKEEPING_SCHEDULE.map((h) => ({
        task: h.task,
        label: h.label,
        everyMs: h.everyMs,
        ...(h.runName ? { lastRun: lastRuns[h.runName] ?? null } : { lastRun: null }),
      }))

      return {
        data: {
          scheduled,
          tasks: (project?.jobs?.tasks ?? []).map((t: any) => ({ id: t.id })),
          housekeeping,
        },
      }
    })

    // Pause / resume a code-defined scheduled job IN THE CURRENT ENV. Code
    // stays code-owned - this only toggles whether the scheduler runs it here.
    // Resume also clears a legacy all-envs ('*') row and any breaker pause.
    .post('/api/v1/admin/jobs/:jobId/pause', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      await pauseJob(ctx.db, ctx.workspaceId, ctx.params.jobId, ctx.memberId ?? null)
      return { data: { id: ctx.params.jobId, paused: true } }
    })
    .post('/api/v1/admin/jobs/:jobId/resume', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      await resumeJob(ctx.db, ctx.workspaceId, ctx.params.jobId)
      return { data: { id: ctx.params.jobId, paused: false } }
    })

    // Retry a FAILED task run: re-enqueue the task with the recorded payload.
    .post('/api/v1/admin/jobs/runs/:id/retry', async (ctx: any) => {
      requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:cron')
      const [run] = await ctx.db.select().from(jobRuns).where(and(
        eq(jobRuns.id, Number(ctx.params.id)),
        eq(jobRuns.workspaceId, ctx.workspaceId),
        )).limit(1)
      if (!run) throw new RequestError('NOT_FOUND', 'Run not found', 404)
      if (run.kind !== 'task') throw new RequestError('VALIDATION_ERROR', 'Only task runs can be retried (scheduled/cron re-fire on their own)', 422)
      if (run.status !== 'error') throw new RequestError('VALIDATION_ERROR', 'Only failed runs can be retried', 422)
      const payload = (run.meta as { payload?: unknown } | null)?.payload
      await enqueueTask({ taskId: run.name, workspaceId: ctx.workspaceId, payload: payload ?? undefined })
      return { data: { retried: true, taskId: run.name } }
    })
