CREATE TABLE IF NOT EXISTS "schema_pushes" (
  "id" text PRIMARY KEY NOT NULL,
  "env_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'running',
  "git_sha" text,
  "cli_version" text,
  "plan_json" jsonb NOT NULL DEFAULT '{}',
  "statements_json" jsonb NOT NULL DEFAULT '[]',
  "error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schema_pushes_env_idx" ON "schema_pushes" ("env_id","started_at");
