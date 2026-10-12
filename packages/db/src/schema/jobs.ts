/**
 * File Name: jobs.ts
 * Purpose: Drizzle schema for the jobs-v2 tables — the durable Postgres
 *          queue (job_queue), execution history (job_runs), redis-less
 *          scheduler state, admin-managed cron entries, and the Postgres
 *          cache fallback store.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Queue polling uses raw SKIP LOCKED SQL (task-queue
 *          service); these definitions serve typed reads/writes and admin
 *          routes. Migration: drizzle/0011_jobs_v2.sql.
 */
import { pgTable, text, timestamp, jsonb, integer, boolean, bigserial, index } from 'drizzle-orm/pg-core'

export const jobQueue = pgTable('job_queue', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskId: text('task_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  payload: jsonb('payload'),
  /**
   * Collapses redundant PENDING work: at most one queued row per key, enforced
   * by a partial unique index (drizzle/0037). NULL means "never deduplicate",
   * which is every task except search indexing. See task-queue.pgEnqueue.
   */
  dedupeKey: text('dedupe_key'),
  /** Who enqueued and whose authority the run uses (kernel K6): { initiator, runAs, correlationId, causationId, locale }. */
  execution: jsonb('execution'),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const jobRuns = pgTable('job_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  workspaceId: text('workspace_id').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  error: text('error'),
  meta: jsonb('meta'),
  // ── The run's identity (kernel K6) ──
  actorKind: text('actor_kind'),
  actorId: text('actor_id'),
  initiatorKind: text('initiator_kind'),
  initiatorId: text('initiator_id'),
  executionId: text('execution_id'),
  correlationId: text('correlation_id'),
  attempt: integer('attempt'),
}, (t) => ({
  /** Retention: the purge scans by workspace and age (migration 0044). */
  retentionIdx: index('job_runs_retention_idx').on(t.workspaceId, t.startedAt),
  correlationIdx: index('job_runs_correlation').on(t.correlationId),
}))

export const schedulerState = pgTable('scheduler_state', {
  workspaceId: text('workspace_id').notNull(),
  jobId: text('job_id').notNull(),
  lastRun: timestamp('last_run', { withTimezone: true }).notNull(),
})

export const cronJobs = pgTable('cron_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  schedule: text('schedule').notNull(),
  /** IANA zone the cron fields evaluate in; NULL = server-local time. */
  timezone: text('timezone'),
  action: jsonb('action').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const cacheEntries = pgTable('cache_entries', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  tags: text('tags').array().notNull().default([]),
  storedAt: timestamp('stored_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/**
 * Fixed-window rate-limit counters for deployments without Redis (Gateway
 * M5, plan section 28). One row per counter key; a hit past `reset_at`
 * starts a new window. Pruned by the queue worker like cache_entries.
 */
export const rateLimitCounters = pgTable('rate_limit_counters', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
})

