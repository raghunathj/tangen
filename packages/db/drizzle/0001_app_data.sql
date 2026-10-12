CREATE TABLE IF NOT EXISTS "app_data" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"object_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_data_app_object_unique" ON "app_data" ("app_id","object_id","workspace_id","env_id");
