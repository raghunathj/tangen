/**
 * File Name: saved-views.ts
 * Purpose: Defines the `saved_views` table, which persists named filter presets
 *   for content-type list views in the admin UI.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; visibility controls whether a view is
 *   private to its creator or shared across the workspace.
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Stores a named, reusable filter configuration for a specific content type's list
 * view, optionally shared with other workspace members.
 */
export const savedViews = pgTable('saved_views', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  typeName: text('type_name').notNull(),
  name: text('name').notNull(),
  /** Serialised FilterState — status, search, dateFilters, fieldFilters */
  filters: jsonb('filters').notNull().default(sql`'{}'`),
  /** 'private' = only creator sees it; 'shared' = all workspace members see it */
  visibility: text('visibility').notNull().default('private'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('saved_views_workspace_idx').on(t.workspaceId),
}))
