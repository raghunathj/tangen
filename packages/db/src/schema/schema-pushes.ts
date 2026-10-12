/**
 * File Name: schema-pushes.ts
 * Purpose: The per-environment push ledger: one row per `tangen push` that
 *          reached the apply phase - started, finished, status (running /
 *          applied / failed), the git sha and CLI version that ran it, the
 *          plan and statements it applied, and the error when it failed.
 *          `/api/v1/types/health`, the Schema Builder banner and `tangen
 *          doctor` read the last row to say whether the last push finished.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core. Migration 0032 and the
 *          ensure-system-schema guard create it; 0042 adds `checksum`.
 *          `--plan` never writes here; a row left at `running` means the
 *          process died mid-push.
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const schemaPushes = pgTable('schema_pushes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** running | applied | failed */
  status: text('status').notNull().default('running'),
  gitSha: text('git_sha'),
  cliVersion: text('cli_version'),
  /** The content plan (planToJson shape) this push applied. */
  planJson: jsonb('plan_json').notNull().default(sql`'{}'`),
  /** The migration statements this push executed, in order. */
  statementsJson: jsonb('statements_json').notNull().default(sql`'[]'`),
  error: text('error'),
  /**
   * sha256 of the canonical plan summary and the ordered statement SQL
   * (migration 0042). The next push re-fingerprints every row and refuses
   * when one disagrees; NULL marks a row written before checksums existed.
   */
  checksum: text('checksum'),
}, (t) => ({
  startedIdx: index('schema_pushes_started_idx').on(t.startedAt),
}))
