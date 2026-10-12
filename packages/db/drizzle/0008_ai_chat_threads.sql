ALTER TABLE "ai_chats" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
DROP INDEX IF EXISTS "ai_chats_scope_unique";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_chats_scope_idx" ON "ai_chats" ("workspace_id","env_id","object_type","object_id","member_id");
