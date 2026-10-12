/**
 * File Name: search-query-log.ts
 * Purpose: Search analytics — one row per search query (Admin or Site Search),
 *   for the Settings → Search dashboards (top searches, zero-result, volume).
 *   NO PII: the term + result count + audience + timestamp only. Rows are purged
 *   past the workspace's retention window (hard-capped at 90 days).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core'

export const searchQueryLog = pgTable('search_query_log', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** 'internal' (Admin Search) or 'public' (Site Search). */
  audience: text('audience').notNull(),
  /** The query term. No PII beyond what the user typed. */
  term: text('term').notNull(),
  resultCount: integer('result_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWorkspace: index('search_query_log_ws_idx').on(t.workspaceId, t.createdAt),
}))
