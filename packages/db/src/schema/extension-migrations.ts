/**
 * File Name: extension-migrations.ts
 * Purpose: The extension migration ledger (closure plan Phase 4, Unit 5):
 *          one row per migration an extension applied in one workspace x
 *          environment, with the checksum of the SQL that ran and the
 *          extension version that carried it. INSTALL and UPGRADE read it
 *          to compute what is pending; the gate reads it to refuse an
 *          extension whose schema is not there; doctor reads it to explain.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Migration 0046 creates it. A `failed` row is the
 *          diagnosable trace of a migration whose transaction rolled back;
 *          the next run retries it. A row whose checksum no longer matches
 *          the declared SQL, or whose migration the extension no longer
 *          declares, refuses every further migration of that extension in
 *          that scope: history is not rewritten.
 */
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const extensionMigrations = pgTable(
  'extension_migrations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    extensionId: text('extension_id').notNull(),
    /** The migration's declared id, e.g. `0001_create_reviews`. */
    migrationId: text('migration_id').notNull(),
    /** The extension version that carried the migration when it ran. */
    extensionVersion: text('extension_version'),
    /** sha256 over the migration id and its SQL. */
    checksum: text('checksum').notNull(),
    /** `applied` | `failed` */
    status: text('status').notNull().default('applied'),
    error: text('error'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeUnique: uniqueIndex('extension_migrations_scope_unique').on(t.workspaceId, t.extensionId, t.migrationId),
  }),
)
