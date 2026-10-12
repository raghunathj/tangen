-- Extension Kernel K6.1: an operator's credentials for a connector, per
-- workspace, sealed at rest (AES-256-GCM under the deployment's connections
-- key). `secret` is the envelope, never plaintext; `connector_id` is
-- `ext:<extension>/<connector>`.
CREATE TABLE IF NOT EXISTS "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"secret" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"health" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_workspace_connector_idx" ON "connections" ("workspace_id", "connector_id");
