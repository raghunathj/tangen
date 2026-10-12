/**
 * File Name: identities.ts
 * Purpose: The `identities` table (framework kernel K8): service and agent
 *          identities that hold authority and own API keys as credentials.
 *          Migration 0055.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const identities = pgTable('identities', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  kind: text('kind').notNull(),                       // 'service' | 'agent'
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'), // 'active' | 'suspended'
  permissions: jsonb('permissions').notNull().default(sql`'{}'`),
  capabilities: jsonb('capabilities').notNull().default(sql`'[]'`),
  ownerId: text('owner_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('identities_workspace_idx').on(t.workspaceId),
}))
