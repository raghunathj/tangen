/**
 * File Name: objects.ts
 * Purpose: Defines the `_revisions` table, which stores immutable point-in-time
 *   snapshots of content objects used for version history and auditing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; authoritative live content lives in
 *   per-type tables provisioned by `tangen push` — this table only holds snapshots.
 */
import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

// Immutable point-in-time snapshots used for version history.
// Authoritative live content lives in per-type tables created by `tangen push`.
/**
 * Stores a versioned, immutable JSONB snapshot of a content object at a specific
 * point in time, enabling full version history and rollback for any object type.
 */
export const revisions = pgTable('_revisions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  typeId: text('type_id').notNull(),
  typeName: text('type_name').notNull(),
  objectId: text('object_id').notNull(),
  version: integer('version').notNull().default(1),
  versionType: text('version_type'),
  snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  /** The locale this revision captured (K5); null for the base row. */
  locale: text('locale'),
}, (t) => ({
  idxObject: index('revisions_object').on(t.workspaceId, t.objectId, t.createdAt),
  // The invariant the allocator relies on: one version number per object, ever.
  // Scope matches the allocation scope (workspace + object, not env).
  uniqObjectVersion: uniqueIndex('_revisions_object_version_uniq').on(t.workspaceId, t.objectId, t.version),
}))
