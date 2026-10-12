-- Service and agent identities (tasks/plan-framework-kernel.md K8): a record
-- that holds authority (grants and capabilities) and owns API keys as its
-- credentials. A key without an identity keeps acting as itself. Additive.
CREATE TABLE IF NOT EXISTS "identities" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "permissions" jsonb DEFAULT '{}' NOT NULL,
  "capabilities" jsonb DEFAULT '[]' NOT NULL,
  "owner_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identities_workspace_idx" ON "identities" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "identity_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_identity_idx" ON "api_keys" USING btree ("identity_id");
