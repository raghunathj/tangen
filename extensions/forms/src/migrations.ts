/**
 * File Name: migrations.ts
 * Purpose: The Forms tables, created where the extension is installed and
 *          never by core (tasks/plan-core-slimming.md S3). Idempotent DDL: a
 *          database that carried these tables from before the move adopts
 *          them unchanged.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionMigration } from '@tangen/cms'

const migrations: ExtensionMigration[] = [
  {
    id: '0001_forms_tables',
    sql: `
CREATE TABLE IF NOT EXISTS forms (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  source text NOT NULL DEFAULT 'admin',
  is_live boolean NOT NULL DEFAULT false,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forms_workspace_idx ON forms (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS forms_workspace_slug_unique ON forms (workspace_id, slug);
CREATE TABLE IF NOT EXISTS form_submissions (
  id text PRIMARY KEY,
  form_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  ip_address text,
  metadata jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS form_submissions_workspace_idx ON form_submissions (workspace_id);
CREATE INDEX IF NOT EXISTS form_submissions_form_idx ON form_submissions (form_id);
CREATE TABLE IF NOT EXISTS form_app_settings (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
  },
  {
    // E.8 (2026-09-17): sender and captcha are manifest settings now. Carry
    // every value a form_app_settings row held into the settings seed
    // (SETTINGS_LEGACY_KEY of the extension's own store; the kernel folds it
    // into the settings entry on the first read, sealing the secret), then
    // drop the table. The ledger runs a migration once per workspace on a
    // shared table, so the block is a no-op once the table is gone.
    id: '0002_app_settings_to_store',
    sql: `
DO $$
BEGIN
  IF to_regclass('form_app_settings') IS NOT NULL THEN
    INSERT INTO extension_data (id, extension_id, object_id, workspace_id, data, updated_at)
    SELECT 'extd_' || md5('forms:' || s.workspace_id || ':__settings_legacy'), 'forms', '__settings_legacy', s.workspace_id, s.data, now()
    FROM (
      SELECT workspace_id, jsonb_strip_nulls(jsonb_build_object(
        'fromEmail', settings->'fromEmail',
        'fromName', settings->'fromName',
        'captchaProvider', settings->'captcha'->'provider',
        'captchaSiteKey', settings->'captcha'->'siteKey',
        'captchaSecretKey', settings->'captcha'->'secretKey',
        'captchaMinScore', settings->'captcha'->'minScore')) AS data
      FROM form_app_settings
    ) s
    WHERE s.data <> '{}'::jsonb
    ON CONFLICT (extension_id, object_id, workspace_id) DO NOTHING;
    DROP TABLE form_app_settings;
  END IF;
END $$;`,
  },
]

export default migrations
