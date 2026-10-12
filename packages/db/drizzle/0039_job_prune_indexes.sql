-- Housekeeping must not scale with retained history.
--
-- Every five minutes the queue worker prunes finished jobs older than the
-- retention window. Neither prune had an index on the column it filters by, so
-- each one was a full sequential scan of the retained table - 15k rows of
-- job_queue and 46k rows of job_runs, every pass, to delete nothing at all on
-- a quiet server. That was the whole of an idle server's periodic read volume
-- once the claim query was fixed, and it grew with site activity: the busier a
-- site had been, the more an idle server paid to confirm there was nothing to
-- do. Same class of defect as the claim's ORDER BY id, one layer down.
--
-- With the column indexed, a prune with nothing old enough to delete positions
-- at the cutoff and stops: two buffers regardless of how much history is kept.
--
-- job_queue: finished_at is NULL until a job finishes, and the prune filters on
-- status IN ('done','failed') as well. A partial index matching that predicate
-- measured identically to a plain one (same size, same two buffers), so the
-- plain index is used: it does not depend on the planner proving the partial
-- predicate, and it stays useful if the prune's status list ever changes.
--
-- job_runs: job_runs_scope_idx is (workspace_id, env_id, started_at DESC), and
-- a bare started_at range cannot use it with started_at in third position.
CREATE INDEX IF NOT EXISTS "job_queue_finished_idx" ON "job_queue" ("finished_at");

CREATE INDEX IF NOT EXISTS "job_runs_started_idx" ON "job_runs" ("started_at");
