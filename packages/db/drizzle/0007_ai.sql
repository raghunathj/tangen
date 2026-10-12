CREATE TABLE IF NOT EXISTS "ai_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"env_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"member_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_chats_scope_unique" ON "ai_chats" ("workspace_id","env_id","object_type","object_id","member_id");
