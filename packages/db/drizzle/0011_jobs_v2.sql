-- Jobs v2: durable Postgres queue, run history, scheduler state,
-- admin-managed cron entries, and the Postgres cache fallback.

CREATE TABLE IF NOT EXISTS job_queue (
  id bigserial PRIMARY KEY,
  task_id text NOT NULL,
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS job_queue_due_idx ON job_queue (status, run_at);

CREATE TABLE IF NOT EXISTS job_runs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                -- task | scheduled | cron
  name text NOT NULL,                -- task id / job id / cron entry name
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  status text NOT NULL,              -- running | ok | error
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  error text,
  meta jsonb
);
CREATE INDEX IF NOT EXISTS job_runs_scope_idx ON job_runs (workspace_id, env_id, started_at DESC);

CREATE TABLE IF NOT EXISTS scheduler_state (
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  job_id text NOT NULL,
  last_run timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, env_id, job_id)
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  name text NOT NULL,
  schedule text NOT NULL,
  action jsonb NOT NULL,             -- {type:'url',...} | {type:'task',...}
  enabled boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cron_jobs_scope_idx ON cron_jobs (workspace_id, env_id, enabled);

CREATE TABLE IF NOT EXISTS cache_entries (
  key text PRIMARY KEY,
  value text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  stored_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_entries_tags_idx ON cache_entries USING gin (tags);
CREATE INDEX IF NOT EXISTS cache_entries_expiry_idx ON cache_entries (expires_at);
