/**
 * File Name: webhooks.ts
 * Purpose: Defines the `webhooks` table, which stores registered outbound webhook
 *   endpoints including their subscribed events, signing secret, and auto-pause state.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; consecutiveFailures drives auto-pause logic
 *   in the webhook dispatcher.
 */
import { pgTable, text, timestamp, jsonb, boolean, integer, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Stores a webhook registration for a workspace environment, including the target URL,
 * optional HMAC signing secret, subscribed event types, custom headers, and auto-pause
 * state based on consecutive delivery failures.
 */
export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  label: text('label').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: text('events').array().notNull().default(sql`'{}'`),
  typeNames: text('type_names').array().notNull().default(sql`'{}'`),
  enabled: boolean('enabled').notNull().default(true),
  headers: jsonb('headers').notNull().default(sql`'{}'`),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  pausedReason: text('paused_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('webhooks_workspace_idx').on(t.workspaceId),
}))
