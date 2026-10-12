-- Jobs and flows run as someone (tasks/plan-framework-kernel.md K6, §12):
-- a queued job carries who enqueued it and whose authority it runs with;
-- a job run records the actor it ran as, the initiator, its execution id and
-- its correlation, and the attempt. Additive.
ALTER TABLE "job_queue" ADD COLUMN IF NOT EXISTS "execution" jsonb;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "actor_kind" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "initiator_kind" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "initiator_id" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "execution_id" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "correlation_id" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN IF NOT EXISTS "attempt" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_runs_correlation" ON "job_runs" ("correlation_id");
