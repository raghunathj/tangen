/**
 * File Name: webhook-deliveries.ts
 * Purpose: Defines the `webhook_deliveries` table, which records individual outbound
 *   HTTP delivery attempts for webhook events including response details and success status.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; rows are append-only delivery receipts — one row
 *   per attempt, including retries.
 */
import { pgTable, text, timestamp, jsonb, boolean, integer, index } from 'drizzle-orm/pg-core'

/**
 * Records a single outbound webhook delivery attempt, capturing the event payload sent,
 * the HTTP response code and body received, latency, and whether the delivery succeeded.
 */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  event: text('event').notNull(),
  typeName: text('type_name').notNull(),
  objectId: text('object_id').notNull(),
  payload: jsonb('payload').notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  success: boolean('success').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('webhook_deliveries_workspace_idx').on(t.workspaceId),
  webhookIdx: index('webhook_deliveries_webhook_idx').on(t.webhookId),
  /** Retention: the purge scans by workspace and age (migration 0044). */
  retentionIdx: index('webhook_deliveries_retention_idx').on(t.workspaceId, t.createdAt),
}))
