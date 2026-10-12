/**
 * File Name: ai-settings.ts
 * Purpose: Drizzle schema for the `ai_settings` table — one row per workspace
 *          holding the admin-editable Content AI configuration (chosen provider
 *          and model, title-generation toggle, and content guidelines).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Workspace-scoped by design (guidelines are brand-level and
 *                     shared across environments). Provider API keys never live
 *                     here — they are environment/process configuration.
 */
import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Admin-editable Content AI settings, one row per workspace.
 */
export const aiSettings = pgTable('ai_settings', {
  workspaceId: text('workspace_id').primaryKey(),
  data: jsonb('data').notNull().default(sql`'{}'`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
