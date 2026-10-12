CREATE TABLE IF NOT EXISTS "porter_transfer_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "redeemed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "porter_codes_hash_idx" ON "porter_transfer_codes" ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "porter_codes_workspace_idx" ON "porter_transfer_codes" ("workspace_id","env_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "porter_transfer_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "code_id" text NOT NULL,
  "run_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sender_info" jsonb NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "porter_tokens_hash_idx" ON "porter_transfer_tokens" ("token_hash");
