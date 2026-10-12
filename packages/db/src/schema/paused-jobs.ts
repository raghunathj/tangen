/**
 * File Name: paused-jobs.ts
 * Purpose: Admin pause/resume for CODE-defined scheduled jobs — a row here means
 *   the job (workspace-level, all envs) is paused; the scheduler skips it. Presence
 *   = paused, absence = running. Lets operators stop a job from the admin without a
 *   code deploy.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'

export const pausedJobs = pgTable('paused_jobs', {
  workspaceId: text('workspace_id').notNull(),
  /** The defineScheduledJob id (from app/jobs). */
  jobId: text('job_id').notNull(),
  /** Env slug the pause applies to; '*' = all envs (legacy rows migrate here). */
  pausedAt: timestamp('paused_at', { withTimezone: true }).notNull().defaultNow(),
  /** Member who paused it (audit; nullable - null for the circuit breaker). */
  pausedBy: text('paused_by'),
  /** Why (circuit breaker writes this; manual pauses leave it null). */
  reason: text('reason'),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.jobId] }),
}))
