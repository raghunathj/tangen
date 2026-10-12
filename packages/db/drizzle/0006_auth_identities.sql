CREATE TABLE IF NOT EXISTS "auth_identities" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "provider" text NOT NULL,
  "provider_user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_user_provider_idx" ON "auth_identities"("user_id","provider");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_provider_uid_idx" ON "auth_identities"("workspace_id","env_id","provider","provider_user_id");
CREATE INDEX IF NOT EXISTS "auth_identities_user_idx" ON "auth_identities"("user_id");
