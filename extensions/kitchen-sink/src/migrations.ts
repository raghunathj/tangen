/**
 * File Name: migrations.ts
 * Purpose: The Kitchen Sink's ledgered SQL migrations - the reference for
 *          how an extension evolves schema (closure plan Phase 4, Unit 13).
 *          Applied in order at install and upgrade, each in its own
 *          transaction with a checksum in extension_migrations; never at
 *          import, register, enable or start.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Never edit or reorder a migration that ran; add a
 *          new one. Write idempotently (IF NOT EXISTS): a migration runs
 *          once per workspace while the physical table is shared by every
 *          workspace of the database. Prefix tables with `kitchen_sink_` and
 *          scope rows by workspace_id so `tangen purge extension` can find
 *          exactly this workspace's rows. 0001 was written when a row also
 *          carried an environment; 0003 drops that column, because a
 *          deployment has one database and no environments.
 */
import type { ExtensionMigration } from '@tangen/cms'

const migrations: ExtensionMigration[] = [
  {
    id: '0001_create_log',
    sql: `CREATE TABLE IF NOT EXISTS kitchen_sink_log (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      env_id text NOT NULL,
      kind text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    id: '0002_log_scope_index',
    sql: `CREATE INDEX IF NOT EXISTS kitchen_sink_log_scope ON kitchen_sink_log (workspace_id, created_at)`,
  },
  {
    id: '0003_drop_env_id',
    sql: `ALTER TABLE kitchen_sink_log DROP COLUMN IF EXISTS env_id`,
  },
]

export default migrations
