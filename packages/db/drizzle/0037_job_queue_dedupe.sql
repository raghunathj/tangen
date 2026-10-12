-- One pending job per logical target.
--
-- The search indexer enqueues a job per content mutation, and those jobs carry
-- no snapshot: each one re-reads the object and reconciles the index to
-- whatever it finds. So while a job is still QUEUED, a second job for the same
-- object is pure duplicate work - a hundred autosaves produced a hundred jobs
-- that all indexed the same final state.
--
-- The index is deliberately PARTIAL on status='queued'. A claimed (running)
-- row leaves the index, so a mutation arriving mid-job can always enqueue the
-- follow-up reconciliation it needs; without that, a change made while a job
-- was running would be silently dropped. A failed row leaves it too, so one
-- poisoned job cannot block current state from ever being reconciled.
--
-- dedupe_key is NULL for every other task, and NULL is not deduplicated.
ALTER TABLE "job_queue" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "job_queue_dedupe_uniq"
  ON "job_queue" ("dedupe_key")
  WHERE "status" = 'queued' AND "dedupe_key" IS NOT NULL;
