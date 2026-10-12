/**
 * File Name: paused-jobs.ts
 * Purpose: Pause/resume for CODE-defined scheduled jobs - per environment
 *   ('*' = all envs, where legacy rows live). Manual pauses come from the
 *   admin; the scheduler's circuit breaker writes rows with a reason after
 *   consecutive failures. Presence = paused, absence = running.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq } from 'drizzle-orm'
import { pausedJobs } from '@tangen/db'

export interface PausedJobRow {
  jobId: string
  reason: string | null
  pausedBy: string | null
}

/** Every pause row for a workspace, one per job. */
export async function getPausedJobs(db: any, workspaceId: string): Promise<PausedJobRow[]> {
  const rows = await db.select({ jobId: pausedJobs.jobId, reason: pausedJobs.reason, pausedBy: pausedJobs.pausedBy })
    .from(pausedJobs).where(eq(pausedJobs.workspaceId, workspaceId))
  return rows as PausedJobRow[]
}

/** True when a job is paused in this workspace. */
export function isJobPaused(rows: PausedJobRow[], jobId: string): boolean {
  return rows.some((r) => r.jobId === jobId)
}

/** The paused job ids of a workspace, as a set. */
export async function getPausedJobIds(db: any, workspaceId: string): Promise<Set<string>> {
  return new Set((await getPausedJobs(db, workspaceId)).map((r) => r.jobId))
}

export async function pauseJob(
  db: any, workspaceId: string, jobId: string,
  pausedBy: string | null, reason: string | null = null,
): Promise<void> {
  await db.insert(pausedJobs).values({ workspaceId, jobId, pausedBy, reason }).onConflictDoNothing()
}

/** Resume a job: its pause row goes. */
export async function resumeJob(db: any, workspaceId: string, jobId: string): Promise<void> {
  await db.delete(pausedJobs).where(and(
    eq(pausedJobs.workspaceId, workspaceId),
    eq(pausedJobs.jobId, jobId),
  ))
}
