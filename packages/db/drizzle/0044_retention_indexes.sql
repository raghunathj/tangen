-- Retention (closure plan Phase 2, Unit 3): the daily purge deletes by
-- workspace (or target environment) and age, so every table it covers needs
-- an index on that pair. audit_log, workspace_activity and search_query_log
-- already had one; these three did not.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retention_idx" ON "webhook_deliveries" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "job_runs_retention_idx" ON "job_runs" ("workspace_id", "started_at");
CREATE INDEX IF NOT EXISTS "promotion_log_retention_idx" ON "promotion_log" ("to_env_id", "promoted_at");
