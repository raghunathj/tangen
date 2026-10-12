CREATE TABLE IF NOT EXISTS "delivery_artifacts" (
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "path" text NOT NULL,
  "body" text NOT NULL,
  "content_type" text NOT NULL DEFAULT 'application/octet-stream',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_artifacts_pk" PRIMARY KEY("workspace_id","env_id","path")
);
