/**
 * File Name: content-ddl.ts
 * Purpose: The DDL of a content type's table and its `_i18n` side table, and
 *          the in-place upgrades an existing database gets: the primary key is
 *          `id` (and `(object_id, locale)` on the side table). One registry per
 *          database, one table per type, rows scoped by workspace_id.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `pkeyColumnsQuery` lets a caller detect an older
 *          composite key by name before running the upgrade DDL.
 */

/** CREATE TABLE for a per-type content table. `fieldColsSql` is the caller's
 *  pre-rendered field column list (possibly empty). */
export function contentTableDdl(tableName: string, fieldColsSql: string): string {
  return `
        CREATE TABLE IF NOT EXISTS "${tableName}" (
          id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          title TEXT,
          slug TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          published_at TIMESTAMPTZ,
          published_by TEXT,
          published_values JSONB,
          scheduled_at TIMESTAMPTZ,
          scheduled_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by TEXT,
          updated_by TEXT,
          created_by_kind TEXT,
          updated_by_kind TEXT,
          published_by_kind TEXT${fieldColsSql ? ',\n    ' + fieldColsSql : ''},
          PRIMARY KEY (id)
        )
      `
}

/** CREATE TABLE for a per-type i18n side table (localized columns are added
 *  by the caller with ALTER ... ADD COLUMN IF NOT EXISTS, as before). */
export function i18nTableDdl(tableName: string): string {
  return `
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        object_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        "__title" TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (object_id, locale)
      )
    `
}

/**
 * Detection query: the table's PRIMARY KEY column list, as text like
 * "id" or "object_id, locale". Callers compare against the target shape to
 * decide whether the upgrade statements need to run (idempotence).
 */
export function pkeyColumnsQuery(tableName: string): string {
  return `
    SELECT c.conname AS pkey_name,
           string_agg(a.attname, ', ' ORDER BY array_position(c.conkey, a.attnum)) AS cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'p' AND c.conrelid = '"${tableName}"'::regclass
    GROUP BY c.conname
  `
}
