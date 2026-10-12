/**
 * File Name: job-runs.ts
 * Purpose: One history table for every kind of background execution
 *          (task | scheduled | cron) — best-effort inserts that never block
 *          or fail the job itself. The admin Runs tab reads this.
 *
 * Author: Raghunath J
 * License: MIT
 */

function rawExec(db: any) {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) return null
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}

export interface JobRunRecord {
  kind: 'task' | 'scheduled' | 'cron'
  name: string
  workspaceId: string
  status: 'ok' | 'error'
  startedAt: Date
  error?: string
  meta?: Record<string, unknown>
  // ── The run's identity (kernel K6) ──
  actor?: { kind: string; id: string | null } | null
  initiator?: { kind: string; id: string | null } | null
  executionId?: string | null
  correlationId?: string | null
  attempt?: number | null
}

/** Records one run (best-effort — swallows failures). */
export async function recordJobRun(db: any, run: JobRunRecord): Promise<void> {
  const exec = rawExec(db)
  if (!exec) return
  const finished = new Date()
  await exec(
    `INSERT INTO job_runs (kind, name, workspace_id, status, started_at, finished_at, duration_ms, error, meta,
                           actor_kind, actor_id, initiator_kind, initiator_id, execution_id, correlation_id, attempt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [run.kind, run.name, run.workspaceId, run.status,
     run.startedAt.toISOString(), finished.toISOString(),
     finished.getTime() - run.startedAt.getTime(), run.error ?? null,
     run.meta ? JSON.stringify(run.meta) : null,
     run.actor?.kind ?? null, run.actor?.id ?? null, run.initiator?.kind ?? null, run.initiator?.id ?? null,
     run.executionId ?? null, run.correlationId ?? null, run.attempt ?? null],
  ).catch(() => {})
}

/**
 * How many of the most recent runs (this workspace x env x name) failed in a
 * row - the scheduled-job circuit breaker's input. Capped at `max` lookback.
 */
export async function consecutiveFailures(
  db: any, workspaceId: string, name: string, max = 5,
): Promise<number> {
  const exec = rawExec(db)
  if (!exec) return 0
  const rows = await exec(
    `SELECT status FROM job_runs
     WHERE workspace_id = $1 AND kind = 'scheduled' AND name = $2
     ORDER BY started_at DESC LIMIT $3`,
    [workspaceId, name, max],
  ).catch(() => [] as Array<{ status: string }>)
  let streak = 0
  for (const r of rows) {
    if (r.status !== 'error') break
    streak++
  }
  return streak
}

/** Prunes runs older than `days` (worker housekeeping). */
export async function pruneJobRuns(db: any, days = 30): Promise<void> {
  const exec = rawExec(db)
  if (!exec) return
  await exec(`DELETE FROM job_runs WHERE started_at < now() - ($1 || ' days')::interval`, [String(days)]).catch(() => {})
}

/**
 * The most recent housekeeping pass per task, for this workspace.
 *
 * Housekeeping runs on the platform's own timers rather than through the
 * queue, so nothing else records it and an operator had no way to tell
 * whether the hourly connection check was happening at all (the user,
 * 2026-09-20). Read from the same run history as every other job, under
 * `kind = 'housekeeping'`.
 */
export async function lastHousekeepingRuns(
  db: unknown,
  workspaceId: string,
): Promise<Record<string, { status: string; startedAt: string; finishedAt: string | null; durationMs: number | null; error: string | null; meta: unknown } | undefined>> {
  const exec = rawExec(db)
  if (!exec) return {}
  const rows = await exec(
    `SELECT DISTINCT ON (name) name, status, started_at, finished_at, duration_ms, error, meta
       FROM job_runs
      WHERE kind = 'housekeeping' AND workspace_id = $1
      ORDER BY name, started_at DESC`,
    [workspaceId],
  ).catch(() => [] as Array<Record<string, unknown>>)
  const out: Record<string, { status: string; startedAt: string; finishedAt: string | null; durationMs: number | null; error: string | null; meta: unknown }> = {}
  for (const r of rows as Array<Record<string, unknown>>) {
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v))
    out[String(r.name)] = {
      status: String(r.status),
      startedAt: iso(r.started_at) ?? '',
      finishedAt: iso(r.finished_at),
      durationMs: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
      error: r.error === null || r.error === undefined ? null : String(r.error),
      meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta ?? null,
    }
  }
  return out
}

/**
 * A run-history filter that may name SEVERAL values: `?kind=task,cron` or a
 * repeated `?kind=task&kind=cron`, which is what a multi-select facet sends
 * (the user, 2026-09-20: "the selection has to be single or multiple").
 *
 * Returns the distinct, non-empty values in the order given. An empty result
 * means "not filtering", never "match nothing" - a filter nobody set must not
 * hide every row.
 */
export function queryValues(raw: unknown): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : v == null ? [] : [String(v)]))
    .map((v) => v.trim())
    .filter((v) => v !== '')
  return [...new Set(parts)]
}
