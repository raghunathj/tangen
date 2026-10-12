/**
 * File Name: extension-data.ts
 * Purpose: Drizzle schema for the `extension_data` table, which stores arbitrary
 *          per-object data owned by installed extensions, separate from core content.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One row per (extensionId, objectId, workspaceId) tuple.
 *                     publishedData mirrors data at publish time, allowing extensions
 *                     to distinguish draft vs published state.
 */
import { pgTable, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Stores extension-owned key-value data attached to a content object, with separate
 * draft and published data blobs and a unique constraint per extension-object pair.
 */
export const extensionData = pgTable(
  'extension_data',
  {
    id: text('id').primaryKey(),
    extensionId: text('extension_id').notNull(),
    objectId: text('object_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'`),
    publishedData: jsonb('published_data'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueExtensionObject: uniqueIndex('extension_data_ext_object_unique').on(
      t.extensionId,
      t.objectId,
      t.workspaceId,
      ),
  }),
)
