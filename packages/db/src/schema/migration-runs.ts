/**
 * File Name: migration-runs.ts
 * Purpose: Durable state for Porter data-movement runs (promote, export,
 *   import, remote transfer). The row IS the worker's state: claimable,
 *   heartbeat while alive, per-outcome counters, cancellable, and a pointer
 *   to the parts-based JSONL results ledger in storage - so a crash or
 *   redeploy loses nothing and "resume" is just reading the row back.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core. Results live OUTSIDE the row
 *   (storage adapter, one JSONL file per flush part) - a 100k-item report
 *   does not belong in a jsonb column.
 */
import { pgTable, text, timestamp, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const migrationRuns = pgTable('migration_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** promote | export | import | remote_send | remote_receive */
  kind: text('kind').notNull(),
  /** Envs are nullable per kind: export has no target, import no source. */
  /** pending | running | completed | failed | cancelled */
  status: text('status').notNull().default('pending'),
  /** What the run covers: type/objectIds/labels/bundle info - kind-specific. */
  scope: jsonb('scope').notNull().default(sql`'{}'`),
  /** Per-outcome counters: { created, overwritten, unchanged, replaced, failed, skipped }. */
  counts: jsonb('counts').notNull().default(sql`'{}'`),
  totalItems: integer('total_items').notNull().default(0),
  processedItems: integer('processed_items').notNull().default(0),
  /** Number of JSONL result parts written to storage (porter/runs/<id>/results-N.jsonl). */
  resultsParts: integer('results_parts').notNull().default(0),
  error: text('error'),
  /** Durable cancel flag - workers poll it between chunks. */
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
}, (t) => ({
  workspaceIdx: index('migration_runs_workspace_idx').on(t.workspaceId, t.createdAt),
  statusIdx: index('migration_runs_status_idx').on(t.status),
}))
