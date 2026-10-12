/**
 * File Name: globals.ts
 * Purpose: Drizzle schema for the `globals` table, which stores workspace-level
 *          singleton data entries (Options / Globals) defined in tangen.config.ts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Keyed by (workspaceId, name) with a unique index,
 *                     making each named global a single JSON document per environment.
 */
import { pgTable, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Workspace-level key-value store (Globals / Options).
 * Developers define named global entries in tangen.config.ts; this table
 * stores the actual data. Keyed by (workspace_id, name).
 */
export const globals = pgTable(
  'globals',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    workspaceId: text('workspace_id').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueGlobal: uniqueIndex('globals_workspace_name_unique').on(
      t.workspaceId,
      t.name,
    ),
  }),
)
