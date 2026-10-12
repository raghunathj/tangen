/**
 * File Name: job-def.ts
 * Purpose: defineTask() / defineScheduledJob() — code-first background work
 *          for site developers (app/jobs/). Validated at definition time so
 *          mistakes fail on boot, not at first execution.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { TaskDefinition, ScheduledJobDefinition } from '@tangen/types'

const ID_RE = /^[a-z][a-z0-9-]*$/

/** Defines a queued background task (enqueued via ctx.tangen.enqueue). */
export function defineTask<P = unknown>(def: TaskDefinition<P>): TaskDefinition<P> {
  if (!def.id || !ID_RE.test(def.id)) {
    throw new Error(`defineTask: id must be kebab-case (got "${def.id}")`)
  }
  if (typeof def.handler !== 'function') {
    throw new Error(`defineTask("${def.id}"): handler is required`)
  }
  if (def.concurrency !== undefined && (!Number.isInteger(def.concurrency) || def.concurrency < 1)) {
    throw new Error(`defineTask("${def.id}"): concurrency must be a positive integer (got ${JSON.stringify(def.concurrency)})`)
  }
  return def
}

/** Defines a scheduled job ('every 5m' interval or 5-field cron subset). */
export function defineScheduledJob(def: ScheduledJobDefinition): ScheduledJobDefinition {
  if (!def.id || !ID_RE.test(def.id)) {
    throw new Error(`defineScheduledJob: id must be kebab-case (got "${def.id}")`)
  }
  if (typeof def.handler !== 'function') {
    throw new Error(`defineScheduledJob("${def.id}"): handler is required`)
  }
  if (!def.schedule || typeof def.schedule !== 'string') {
    throw new Error(`defineScheduledJob("${def.id}"): schedule is required (e.g. 'every 5m' or '0 3 * * *')`)
  }
  if (def.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: def.timezone })
    } catch {
      throw new Error(`defineScheduledJob("${def.id}"): timezone must be a valid IANA name like 'Asia/Kolkata' (got "${def.timezone}")`)
    }
  }
  return def
}
