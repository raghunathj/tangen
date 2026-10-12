/**
 * File Name: custom-table-owners.ts
 * Purpose: Who declared each custom table, so ownership survives the extension
 *   that asked for it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Keyed by table name alone, because a physical table is
 *   instance-global: a second workspace enabling the same extension finds the
 *   table that is already there rather than creating another. Row data stays
 *   workspace-scoped; `workspaceId` here records only
 *   which push first claimed the table, for diagnostics.
 *
 *   No row means UNCLAIMED, not unowned. Every custom table older than this
 *   registry has no row, and an extension declaring such a name is refused
 *   rather than handed a table full of somebody else's data.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const customTableOwners = pgTable('custom_table_owners', {
  tableName: text('table_name').primaryKey(),
  /** 'site' | 'extension' */
  ownerKind: text('owner_kind').notNull(),
  /** The extension id, when ownerKind is 'extension'. */
  ownerId: text('owner_id'),
  /** The manifest version the table was last claimed at. */
  ownerVersion: text('owner_version'),
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
