CREATE TABLE IF NOT EXISTS "migration_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "kind" text NOT NULL,
  "source_env_id" text,
  "target_env_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "scope" jsonb NOT NULL DEFAULT '{}',
  "counts" jsonb NOT NULL DEFAULT '{}',
  "total_items" integer NOT NULL DEFAULT 0,
  "processed_items" integer NOT NULL DEFAULT 0,
  "results_parts" integer NOT NULL DEFAULT 0,
  "error" text,
  "cancel_requested" boolean NOT NULL DEFAULT false,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "heartbeat_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_runs_workspace_idx" ON "migration_runs" ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_runs_status_idx" ON "migration_runs" ("status");
