/**
 * File Name: workspaces.ts
 * Purpose: Defines the `workspaces` table, the top-level multi-tenant boundary; every
 *   other resource in the platform is scoped to a workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; soft-delete via deletedAt — rows with a
 *   non-null deletedAt are treated as decommissioned workspaces.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Top-level tenant record representing a single organization or project space;
 * all environments, members, API keys, and content types belong to a workspace.
 */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})
