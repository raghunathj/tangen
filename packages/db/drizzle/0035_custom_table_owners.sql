-- Extension-declared custom tables (2026-08-28): a registry row remembers WHO
-- declared each custom table.
--
-- Keyed by table name alone, and that key is the honest description of the
-- architecture: a physical table is instance-global. Installing an extension in
-- a second workspace does not create a second table, it finds the one already
-- there. The rows inside stay workspace- and environment-scoped, as they were.
--
-- `owner_kind` is 'site' when the site's own config declares the table, or
-- 'extension' with the extension id and the manifest version it was claimed at.
-- A table with NO row here is unclaimed rather than unowned: every custom table
-- that predates this registry is unclaimed, and an extension declaring one of
-- those names is refused rather than handed somebody else's data. Ownership is
-- never transferred by declaring a name.
CREATE TABLE IF NOT EXISTS "custom_table_owners" (
  "table_name" text PRIMARY KEY,
  "owner_kind" text NOT NULL,
  "owner_id" text,
  "owner_version" text,
  "workspace_id" text,
  "env_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
