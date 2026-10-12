/**
 * File Name: migrations.ts
 * Purpose: The Site users tables, created where the extension is installed
 *          and never by core (tasks/plan-core-slimming.md S4). Idempotent DDL:
 *          a database that carried the auth tables from before the move
 *          adopts them, gaining the phone column and the challenges table.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionMigration } from '@tangen/cms'

const migrations: ExtensionMigration[] = [
  {
    id: '0001_auth_tables',
    sql: `
CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  email text,
  phone text,
  name text,
  password_hash text,
  role text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  is_anonymous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS phone text;
CREATE INDEX IF NOT EXISTS auth_users_workspace_idx ON auth_users (workspace_id);
CREATE INDEX IF NOT EXISTS auth_users_anon_idx ON auth_users (workspace_id, is_anonymous);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_workspace_email_idx ON auth_users (workspace_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_workspace_phone_idx ON auth_users (workspace_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  refresh_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_workspace_idx ON auth_sessions (workspace_id);

CREATE TABLE IF NOT EXISTS auth_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_user_provider_idx ON auth_identities (user_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_provider_uid_idx ON auth_identities (workspace_id, provider, provider_user_id);
CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_sso_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sso_accounts_provider_user_idx ON auth_sso_accounts (workspace_id, provider, provider_user_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  kind text NOT NULL,
  subject text NOT NULL,
  secret_hash text NOT NULL,
  payload jsonb,
  attempts text NOT NULL DEFAULT '0',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_challenges_subject_idx ON auth_challenges (workspace_id, kind, subject);
CREATE INDEX IF NOT EXISTS auth_challenges_expires_idx ON auth_challenges (expires_at);
`,
  },
]

export default migrations
