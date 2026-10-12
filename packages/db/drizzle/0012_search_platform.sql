-- Search platform: query-log analytics (retention-bounded, no PII), marketing-
-- managed synonyms, and query curation/recommendations. All additive.

CREATE TABLE IF NOT EXISTS search_query_log (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  audience text NOT NULL,            -- internal (Admin) | public (Site)
  term text NOT NULL,                -- the query; no PII beyond what was typed
  result_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_query_log_ws_env_idx ON search_query_log (workspace_id, env_id, created_at);

CREATE TABLE IF NOT EXISTS search_synonyms (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  terms jsonb NOT NULL DEFAULT '[]',  -- interchangeable terms (string[])
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_synonyms_ws_env_idx ON search_synonyms (workspace_id, env_id);

CREATE TABLE IF NOT EXISTS search_recommendations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  env_id text NOT NULL,
  query text NOT NULL,               -- query this rule applies to (case-insensitive)
  pins jsonb NOT NULL DEFAULT '[]',   -- result ids/urls to pin, in order
  hides jsonb NOT NULL DEFAULT '[]',  -- result ids/urls to remove
  audience text,                      -- internal | public | null (both)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_recommendations_ws_env_idx ON search_recommendations (workspace_id, env_id);
