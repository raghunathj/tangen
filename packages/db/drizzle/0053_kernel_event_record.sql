-- The framework kernel's durable event record and attribution kinds
-- (tasks/plan-framework-kernel.md K5, §10, §18).
--
-- audit_log becomes the event record the domain operations write INSIDE
-- their transaction: who acted (actor kind and id, on behalf of whom), in
-- which execution (kind, id, correlation, causation), to which resource, in
-- which locale, through which transport. The columns are additive; rows the
-- bus subscriber wrote before this migration keep their shape.
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_kind" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "initiator_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "initiator_kind" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "execution_kind" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "execution_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "correlation_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "causation_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "resource_kind" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "resource_type" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "resource_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "locale" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "recorded_in_transaction" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_resource" ON "audit_log" ("workspace_id", "resource_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_correlation" ON "audit_log" ("correlation_id");--> statement-breakpoint
-- A revision knows which locale it captured (null: the base row), and the
-- published revision carries the translations map the snapshot froze.
ALTER TABLE "_revisions" ADD COLUMN IF NOT EXISTS "locale" text;
