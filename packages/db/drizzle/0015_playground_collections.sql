-- PG-3: API Playground collections (saved requests, private/shared) and
-- per-member variable sets for {{name}} interpolation.
CREATE TABLE IF NOT EXISTS "playground_collections" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "name" text NOT NULL,
  "requests" jsonb NOT NULL DEFAULT '[]',
  "visibility" text NOT NULL DEFAULT 'private',
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "playground_collections_scope_idx"
  ON "playground_collections" ("workspace_id", "env_id");

CREATE TABLE IF NOT EXISTS "playground_variables" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "member_id" text NOT NULL,
  "vars" jsonb NOT NULL DEFAULT '{}',
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "playground_variables_owner" UNIQUE ("workspace_id", "env_id", "member_id")
);
