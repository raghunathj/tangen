-- Releases publish in place (tasks/remove-environments-programme.md, R4):
-- who created and who applied a release, and the review state each item
-- carries, existed in the schema and on developer databases that drizzle-kit
-- pushed, but no migration had ever created them. The first fresh database
-- of the three-deployment proof (scripts/verify-deployments-pg.ts) found out.
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN IF NOT EXISTS "applied_by" text;--> statement-breakpoint
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "comparison_state" text;--> statement-breakpoint
ALTER TABLE "release_items" ADD COLUMN IF NOT EXISTS "resolved_values" jsonb;
