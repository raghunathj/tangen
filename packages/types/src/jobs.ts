/**
 * File Name: jobs.ts
 * Purpose: Types for site-developer background work — queued tasks
 *          (defineTask + ctx.tangen.enqueue) and scheduled jobs
 *          (defineScheduledJob, cron/interval), registered via
 *          WorkspaceConfig.jobs from app/jobs/.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Handlers live in code and never serialize into queue
 *          jobs — jobs carry only { workspaceId, taskId, payload } and
 *          the worker resolves the handler from the loaded workspace config.
 */
import type { TangenLocalClient } from './custom-routes'

/** Execution context handed to task and scheduled-job handlers. */
export interface JobContext {
  /** Full local client — objects/table/globals/sendMail/enqueue/cache. */
  tangen: TangenLocalClient
  workspaceId: string
  /** The resolved configuration of this workspace on this deployment; non-secret values, `site` by declared name. */
  config: import('./custom-routes').RouteConfig
  /** The privileged boundary for the site's secrets, by declared name. */
  secrets: import('./custom-routes').SecretAccessorLike
  /** A declared integration (`app/config/integrations.ts`), resolved for this workspace on this deployment. */
  integration(name: string): import('./integrations').ResolvedIntegration | undefined
  log: (message: string) => void
  /**
   * The execution this run is (kernel): a `job` execution whose actor is
   * Tangen itself with the reason `job:<id>`, until run-as identities land.
   * Present for task and scheduled runs built by the platform runners.
   */
  exec?: import('./kernel').ExecutionContext
}

/**
 * A queued background task — enqueued with `ctx.tangen.enqueue(id, payload)`
 * from routes, hooks, or other jobs; executed by the task worker (BullMQ)
 * with retry/backoff, or inline when no queue is available.
 */
export interface TaskDefinition<P = unknown> {
  /** Stable id — referenced by enqueue calls. Kebab-case. */
  id: string
  description?: string
  /**
   * Max simultaneous executions of THIS task id per process/queue. Enforced
   * in-process around the handler (BullMQ worker and inline paths) and by the
   * Postgres worker, which skips claiming jobs of a task already running at
   * its limit. Omit for unlimited (the default behavior).
   */
  concurrency?: number
  /**
   * Whose authority a run of this task uses (kernel K6). `'initiator'` (the
   * default): the member or key who enqueued it, re-resolved at execution
   * and refused when that authority is gone. `'system'`: Tangen's own, for
   * site code deployed with the site (a reindex, a digest) that does its
   * work for nobody in particular.
   */
  runAs?: 'initiator' | 'system'
  handler: (ctx: JobContext, payload: P) => Promise<void> | void
}

/**
 * A scheduled job - runs once per workspace on the
 * platform scheduler tick.
 *
 * Schedule syntax:
 *   'every 5m' | 'every 2h' | 'every 1d'      — simple intervals
 *   '0 3 * * *'                                — 5-field cron subset
 *                                                (min hour dom month dow;
 *                                                 numbers, *, star-slash steps, lists)
 */
export interface ScheduledJobDefinition {
  /** Stable id — used for the last-run/lock keys. Kebab-case. */
  id: string
  description?: string
  schedule: string
  /**
   * IANA timezone (e.g. 'Asia/Kolkata') the cron fields are evaluated in.
   * Omit for the API server's local time (the default). Intervals
   * ('every Nm') are elapsed-time based and ignore this.
   */
  timezone?: string
  handler: (ctx: JobContext) => Promise<void> | void
}

/** The app/jobs/index.ts barrel shape, registered as WorkspaceConfig.jobs. */
export interface JobsConfig {
  scheduled?: ScheduledJobDefinition[]
  tasks?: TaskDefinition<unknown>[]
  /**
   * Allow admin-created cron URL triggers to call private/loopback hosts
   * (SSRF guard opt-out — needed for localhost targets in development).
   */
  allowPrivateNetworks?: boolean
}
