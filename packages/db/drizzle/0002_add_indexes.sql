CREATE TABLE IF NOT EXISTS "app_data" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"object_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"published_data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "globals" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_data_app_object_unique" ON "app_data" ("app_id","object_id","workspace_id","env_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "globals_workspace_env_name_unique" ON "globals" ("workspace_id","env_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_member_idx" ON "refresh_tokens" ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_workspace_env_idx" ON "media_assets" ("workspace_id","env_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_folder_idx" ON "media_assets" ("folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_workspace_env_idx" ON "webhooks" ("workspace_id","env_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_workspace_env_idx" ON "webhook_deliveries" ("workspace_id","env_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_idx" ON "webhook_deliveries" ("webhook_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_workspace_env_idx" ON "saved_views" ("workspace_id","env_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "release_items_release_idx" ON "release_items" ("release_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "release_items_object_idx" ON "release_items" ("object_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_workspace_idx" ON "releases" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_workspace_env_idx" ON "form_submissions" ("workspace_id","env_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_form_idx" ON "form_submissions" ("form_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_workspace_env_idx" ON "forms" ("workspace_id","env_id");