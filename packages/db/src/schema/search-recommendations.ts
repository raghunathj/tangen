/**
 * File Name: search-recommendations.ts
 * Purpose: Marketing-managed query curation ("query rules", Settings → Search).
 *   For a query (exact or pattern), pin results to the top, and/or hide results.
 *   Applied at query time after the providers run.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const searchRecommendations = pgTable('search_recommendations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** The query this rule applies to (matched case-insensitively). */
  query: text('query').notNull(),
  /** Result ids (or urls) to pin to the top, in order (string[]). */
  pins: jsonb('pins').notNull().default([]),
  /** Result ids (or urls) to remove from results (string[]). */
  hides: jsonb('hides').notNull().default([]),
  /** Optional audience scope: 'internal' | 'public' | null (both). */
  audience: text('audience'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWorkspace: index('search_recommendations_ws_idx').on(t.workspaceId),
}))
