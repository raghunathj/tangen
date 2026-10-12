-- Releases v1 (closure plan Phase 5B, Unit 2): the explicit state machine
-- DRAFT -> IN_REVIEW -> APPROVED -> APPLYING -> APPLIED | FAILED, the columns
-- approval, scheduling, application and failure record on, item identity
-- (one item per object per release) with a per-item outcome, and the
-- promotion history. A legacy `pending` release becomes a `draft`. Data is
-- never dropped: duplicate item selections of one object are collapsed to
-- the first (they were one application anyway).
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "submitted_by" text;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "approved_by" text;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "approved_checksum" text;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "scheduled_by" text;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "applying_started_at" timestamp with time zone;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "failed_at" timestamp with time zone;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "failure" jsonb;
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
UPDATE "releases" SET "status" = 'draft' WHERE "status" = 'pending';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'releases_status_check') THEN
    ALTER TABLE "releases" ADD CONSTRAINT "releases_status_check" CHECK ("status" IN ('draft', 'in_review', 'approved', 'applying', 'applied', 'failed'));
  END IF;
END $$;
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "frozen_payload" jsonb;
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "target_fingerprint" text;
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "position" integer;
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "apply_outcome" text;
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "applied_at" timestamp with time zone;
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "apply_error" text;
DELETE FROM "release_items" a USING "release_items" b
  WHERE a."release_id" = b."release_id" AND a."type_name" = b."type_name" AND a."object_id" = b."object_id" AND a."id" > b."id";
CREATE UNIQUE INDEX IF NOT EXISTS "release_items_identity_unique" ON "release_items" ("release_id", "type_name", "object_id");
CREATE TABLE IF NOT EXISTS "release_history" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text,
	"source_env_id" text NOT NULL,
	"target_env_id" text NOT NULL,
	"source_role" text,
	"target_role" text,
	"checksum" text,
	"counts" jsonb,
	"error_id" text,
	"error_summary" text,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "release_history_release_idx" ON "release_history" ("release_id", "started_at");
