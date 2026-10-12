-- Adds published_data column to extension_data (idempotent: previously in 0002_app_data_published.sql but not journalled)
ALTER TABLE "extension_data" ADD COLUMN IF NOT EXISTS "published_data" jsonb;--> statement-breakpoint
-- Creates globals table (idempotent: previously in 0003_globals.sql but not journalled)
CREATE TABLE IF NOT EXISTS "globals" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "globals_workspace_env_name_unique" ON "globals" ("workspace_id","env_id","name");
