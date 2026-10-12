/**
 * File Name: release-scheduler.ts
 * Purpose: Scheduling a Release: an approved release with a `scheduled_at`
 *          publishes itself when the time comes. The scheduler's pass claims
 *          due releases one at a time (an UPDATE that clears the schedule is
 *          the claim, so two processes never run one release) and runs the
 *          same apply a member would.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { contentTables } from '@tangen/db/content-tables'
import { lifecycleExecFromDb, recordReleaseHistory, ReleaseStateError, type LifecycleExec } from './release-lifecycle'
import { preflightRelease, type PreflightReport } from './release-preflight'
import { runReleaseApply, type RunDeps, type RunOutcome } from './release-runner'
import type { SchemaDefinition } from '@tangen/types'

export interface ScheduleDeps { exec: LifecycleExec; preflight: (releaseId: string, workspaceId: string) => Promise<PreflightReport> }

export class ReleaseScheduleError extends Error {
  constructor(readonly status: number, message: string, readonly preflight?: Omit<PreflightReport, 'frozen'>) { super(message) }
}

export async function scheduleRelease(deps: ScheduleDeps, input: { releaseId: string; workspaceId: string; actor: string; at: Date }): Promise<{ scheduledAt: Date; historyId: string }> {
  if (!(input.at instanceof Date) || Number.isNaN(input.at.getTime())) throw new ReleaseScheduleError(422, 'scheduledAt must be a valid date-time')
  const report = await preflightRelease0(deps, input.releaseId, input.workspaceId)
  if (report.status !== 'approved') throw new ReleaseScheduleError(409, `release ${input.releaseId} cannot be scheduled while ${report.status ?? 'missing'}: only an approved release is scheduled`)
  if (!report.ok) { const { frozen: _f, ...visible } = report; throw new ReleaseScheduleError(422, `release ${input.releaseId} would not apply: ${report.checks.filter((c) => !c.ok).map((c) => c.code).join(', ')}`, visible) }
  const rows = await deps.exec(`UPDATE releases SET scheduled_at = $1, scheduled_by = $2 WHERE id = $3 AND workspace_id = $4 AND status = 'approved' RETURNING id`, [input.at, input.actor, input.releaseId, input.workspaceId])
  if (rows.length === 0) throw new ReleaseStateError(input.releaseId, 'apply', null, `release ${input.releaseId} is no longer approved`)
  const historyId = await recordReleaseHistory(deps.exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'schedule', from: 'approved', to: 'approved', actor: input.actor,
    checksum: report.frozen?.checksum ?? null, reason: `scheduled for ${input.at.toISOString()}`,
  })
  return { scheduledAt: input.at, historyId }
}

async function preflightRelease0(deps: ScheduleDeps, releaseId: string, workspaceId: string): Promise<PreflightReport> {
  const report = await deps.preflight(releaseId, workspaceId)
  if (report.status === null) throw new ReleaseScheduleError(404, `release ${releaseId} not found`)
  return report
}

export async function unscheduleRelease(deps: Pick<ScheduleDeps, 'exec'>, input: { releaseId: string; workspaceId: string; actor: string; reason?: string | null }): Promise<{ historyId: string }> {
  const rows = await deps.exec(`UPDATE releases SET scheduled_at = NULL, scheduled_by = NULL WHERE id = $1 AND workspace_id = $2 AND scheduled_at IS NOT NULL RETURNING status`, [input.releaseId, input.workspaceId])
  if (rows.length === 0) throw new ReleaseScheduleError(409, `release ${input.releaseId} is not scheduled`)
  const status = String(rows[0]!.status) as 'approved'
  const historyId = await recordReleaseHistory(deps.exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: 'unschedule', from: status, to: status, actor: input.actor,
    reason: input.reason ?? null,
  })
  return { historyId }
}

export interface ScheduledPassDeps {
  db: any
  eventBus: { emit: (event: Record<string, unknown>) => unknown }
  redis: unknown
  projects: Array<{ workspaceId: string; [k: string]: unknown }>
  /** The schema of this database, for the publish path. */
  schema: () => Promise<SchemaDefinition>
  runDepsFor?: (release: { workspaceId: string }, schema: SchemaDefinition) => RunDeps
  run?: typeof runReleaseApply
}

export function releaseRunDepsForScheduler(deps: ScheduledPassDeps, release: { workspaceId: string }, schema: SchemaDefinition): RunDeps {
  const { db } = deps
  void release
  return {
    db, exec: lifecycleExecFromDb(db), tables: contentTables as Record<string, any>,
    engine: { eventBus: deps.eventBus, redis: deps.redis, schema, projects: deps.projects as never[] },
  }
}

/** One pass: every approved release whose time has come, claimed and applied. Returns how many ran. */
export async function processScheduledReleases(deps: ScheduledPassDeps, now = new Date()): Promise<number> {
  const exec = lifecycleExecFromDb(deps.db)
  let due: Array<Record<string, unknown>>
  try { due = await exec(`SELECT id, workspace_id FROM releases WHERE status = 'approved' AND scheduled_at IS NOT NULL AND scheduled_at <= $1 ORDER BY scheduled_at, id`, [now]) }
  catch { return 0 }
  let ran = 0
  for (const row of due) {
    const claimed = await exec(`UPDATE releases SET scheduled_at = NULL WHERE id = $1 AND status = 'approved' AND scheduled_at IS NOT NULL AND scheduled_at <= $2 RETURNING workspace_id, scheduled_by`, [row.id, now])
    if (claimed.length === 0) continue   // another process took it
    const c = claimed[0]!
    const release = { workspaceId: String(c.workspace_id) }
    const actor = c.scheduled_by ? String(c.scheduled_by) : 'scheduler'
    const schema = await deps.schema()
    const runDeps = (deps.runDepsFor ?? ((r, sc) => releaseRunDepsForScheduler(deps, r, sc)))(release, schema)
    try {
      // K4: the scheduler applies as the member who scheduled, with the
      // authority they hold now (re-resolved by the runner); a release with
      // no recorded scheduler applies once with no grant check.
      const out: RunOutcome = await (deps.run ?? runReleaseApply)(runDeps, { releaseId: String(row.id), workspaceId: release.workspaceId, actor, action: 'apply', authority: c.scheduled_by ? undefined : null })
      void out
    } catch (e) {
      if (!(e instanceof ReleaseStateError)) throw e   // moved by someone else between claim and transition: its history says so
    }
    ran++
  }
  return ran
}
