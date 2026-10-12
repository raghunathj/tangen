/**
 * File Name: retention.ts
 * Purpose: The operator's retention policy for Tangen's operational tables
 *          (closure plan Phase 2, Unit 3): how long audit, activity, webhook
 *          delivery, search query, job run and promotion rows are kept
 *          before the daily purge removes them. Customer content is never
 *          subject to it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Configuration, not a product promise: the default is
 *          generous (90 days) and every number here is the deployment's to
 *          change. `false` for a table keeps its rows forever; `enabled:
 *          false` switches the purge off entirely.
 */

/** The operational tables the policy covers. Content tables are never on this list. */
export type RetentionTable =
  | 'audit_log'
  | 'workspace_activity'
  | 'webhook_deliveries'
  | 'search_query_log'
  | 'job_runs'
  | 'promotion_log'

export interface RetentionConfig {
  /** Master switch for the daily purge. Default true. */
  enabled?: boolean
  /** Days a row is kept when its table has no entry in `days`. Default 90. */
  defaultDays?: number
  /** Per-table days; `false` keeps that table's rows forever. */
  days?: Partial<Record<RetentionTable, number | false>>
  /** Rows deleted per statement, so a purge never holds a long lock. Default 1000. */
  batchSize?: number
}
