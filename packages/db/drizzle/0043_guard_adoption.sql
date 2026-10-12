-- Adoption of what only the boot guard ever defined (closure plan, Phase 1 Unit 5).
--
-- Until this migration, `object_types.localized` and the `entity_tags` table
-- with its two indexes existed in ensure-system-schema.ts alone: created at
-- boot and before every push by a hand-maintained guard, never by a
-- migration. The guard is now derived from the migrations and defines
-- nothing itself, so these move here, verbatim and idempotent: a database the
-- guard already provisioned is adopted as it stands.
ALTER TABLE "object_types" ADD COLUMN IF NOT EXISTS "localized" boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "entity_tags" ("workspace_id" text NOT NULL, "env_id" text NOT NULL, "entity_type" text NOT NULL, "entity_id" text NOT NULL, "tag" text NOT NULL, "source" text NOT NULL DEFAULT 'user', "created_at" timestamp with time zone DEFAULT now() NOT NULL, "created_by" text, CONSTRAINT "entity_tags_pk" PRIMARY KEY("workspace_id","env_id","entity_type","entity_id","tag"));
CREATE INDEX IF NOT EXISTS "entity_tags_filter_idx" ON "entity_tags" ("workspace_id","env_id","entity_type","tag");
CREATE INDEX IF NOT EXISTS "entity_tags_entity_idx" ON "entity_tags" ("workspace_id","env_id","entity_type","entity_id");
