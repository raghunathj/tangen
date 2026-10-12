/**
 * File Name: search-synonyms.ts
 * Purpose: Marketing-managed synonym groups (Settings → Search). A group is a set
 *   of interchangeable terms ("laptop", "notebook"); a query matching any term is
 *   expanded to match the others. Applied at query time in the search pipeline.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const searchSynonyms = pgTable('search_synonyms', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** Human title for the group (e.g. "Footwear"), so marketing knows its purpose. */
  label: text('label'),
  /** Interchangeable terms in this group (string[]). */
  terms: jsonb('terms').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWorkspace: index('search_synonyms_ws_idx').on(t.workspaceId),
}))
