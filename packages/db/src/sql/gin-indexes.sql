-- Supplemental indexes that drizzle-kit cannot emit directly.
--
-- Run after `bun run db:push`:
--   psql $DATABASE_URL -f packages/db/src/sql/gin-indexes.sql

-- Audit log expression indexes
CREATE INDEX IF NOT EXISTS audit_log_workspace
  ON audit_log (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_object
  ON audit_log ((payload->>'object_id'), created_at DESC);
