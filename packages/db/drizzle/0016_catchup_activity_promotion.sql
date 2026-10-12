-- Catch-up migration: the monorepo evolves system tables via `drizzle-kit push`,
-- so these two never got a generated migration — consumer installs (which
-- migrate via @tangen/db/migrate) were missing them. Hand-rolled from the live
-- schema (drizzle-kit generate is currently incompatible with orm 0.45).
CREATE TABLE IF NOT EXISTS "workspace_activity" (
    "id" text PRIMARY KEY NOT NULL,
    "workspace_id" text NOT NULL,
    "env_id" text,
    "category" text NOT NULL,
    "action" text NOT NULL,
    "actor_id" text,
    "actor_name" text,
    "actor_type" text,
    "source" text DEFAULT 'admin' NOT NULL,
    "type_name" text,
    "object_id" text,
    "object_title" text,
    "target_label" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promotion_log" (
    "id" text PRIMARY KEY NOT NULL,
    "object_id" text NOT NULL,
    "from_env_id" text NOT NULL,
    "to_env_id" text NOT NULL,
    "release_id" text,
    "promoted_by" text,
    "promoted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_activity_workspace_created" ON "workspace_activity" ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_activity_env_created" ON "workspace_activity" ("env_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promotion_log_object_env_idx" ON "promotion_log" ("object_id","to_env_id");
