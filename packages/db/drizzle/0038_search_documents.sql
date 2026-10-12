-- btree_gin lets a GIN index carry ordinary scalar columns alongside the
-- tsvector, which is what keeps the scope filters INSIDE the index. It is a
-- standard contrib extension and is TRUSTED from PostgreSQL 13, so the database
-- owner can install it without superuser. If this fails, the deployment is on a
-- managed service that withholds contrib, and search must be told so plainly
-- rather than silently building an index that filters after the fact.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gin;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Tangen search needs the btree_gin extension (standard PostgreSQL contrib, trusted since 13). Install it as the database owner: CREATE EXTENSION btree_gin;  Underlying error: %', SQLERRM;
END $$;

-- The search index, in the database that was already mandatory.
--
-- One row per (workspace, environment, source, type, object, LOCALE). The
-- locale is part of the identity because the text-search configuration is per
-- row: a French document has to be stemmed and queried as French, and one row
-- carrying every translation could only ever be stemmed once.
--
-- `search_vector` is GENERATED, and its configuration comes from the row's own
-- `cfg` column - PostgreSQL accepts `to_tsvector(cfg, ...)` as immutable. So the
-- language is data, the vector maintains itself, and no application code or
-- trigger ever computes it.
--
-- No pg_trgm here on purpose. Measured at a million documents, the trigram index
-- cost 36% of write throughput and 175% more WAL than the FTS index it
-- accompanied - more than full-text search itself. Typo tolerance is an opt-in
-- capability, not a default, and lives in its own migration.
CREATE TABLE IF NOT EXISTS "search_documents" (
  "workspace_id"  text        NOT NULL,
  "env_id"        text        NOT NULL,
  "source"        text        NOT NULL,          -- 'content' | 'media' | 'ext:<id>:<src>'
  "type_slug"     text        NOT NULL,
  "object_id"     text        NOT NULL,
  "locale"        text        NOT NULL DEFAULT '',
  "cfg"           regconfig   NOT NULL DEFAULT 'simple',
  "title"         text        NOT NULL DEFAULT '',
  "slug"          text,
  "body"          text        NOT NULL DEFAULT '',
  -- Bounded snippet source. ts_headline is linear in the text it is given:
  -- 101 ms to snippet twenty 100 KB documents, against 1 ms for 1 KB ones.
  "excerpt"       text        NOT NULL DEFAULT '',
  "status"        text        NOT NULL DEFAULT 'draft',
  "is_published"  boolean     NOT NULL DEFAULT false,
  "metadata"      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "search_vector" tsvector GENERATED ALWAYS AS (
       setweight(to_tsvector("cfg", coalesce("title",   '')), 'A')
    || setweight(to_tsvector("cfg", coalesce("slug",    '')), 'B')
    || setweight(to_tsvector("cfg", coalesce("excerpt", '')), 'B')
    || setweight(to_tsvector("cfg", coalesce("body",    '')), 'C')
  ) STORED,
  CONSTRAINT "search_documents_pkey"
    PRIMARY KEY ("workspace_id", "env_id", "source", "type_slug", "object_id", "locale")
);

-- Every constraint a search actually applies lives INSIDE the index.
--
-- The prototype put only the vector in the GIN index and filtered
-- `is_published` afterwards: PostgreSQL fetched 50,000 matching heap rows and
-- then discarded every one of them, for 2.3 seconds. A filter outside the index
-- is not a filter, it is a post-processing step that pays full price.
CREATE INDEX IF NOT EXISTS "search_documents_fts"
  ON "search_documents"
  USING gin ("workspace_id", "env_id", "locale", "is_published", "source", "type_slug", "search_vector");

-- Autocomplete. An anchored B-tree, NOT trigram: measured across five prefixes
-- at a million documents, trigram ranged from 0.04 ms to 11.6 ms with a 137 ms
-- tail, while this is 0.015-0.104 ms p50 and under 1.2 ms at p95 for every
-- prefix tried. `text_pattern_ops` is what makes LIKE 'x%' an index range scan.
CREATE INDEX IF NOT EXISTS "search_documents_title_prefix"
  ON "search_documents" ("workspace_id", "env_id", lower("title") text_pattern_ops);
CREATE INDEX IF NOT EXISTS "search_documents_slug_prefix"
  ON "search_documents" ("workspace_id", "env_id", lower("slug") text_pattern_ops);

-- Exact identifier lookup: the CMS case, and the fastest path in the design.
CREATE INDEX IF NOT EXISTS "search_documents_slug"
  ON "search_documents" ("workspace_id", "env_id", "slug");
-- Facet and filter dimensions that are not text.
CREATE INDEX IF NOT EXISTS "search_documents_scope"
  ON "search_documents" ("workspace_id", "env_id", "is_published", "type_slug");
CREATE INDEX IF NOT EXISTS "search_documents_metadata"
  ON "search_documents" USING gin ("metadata" jsonb_path_ops);
-- Backfill progress scans by object identity.
CREATE INDEX IF NOT EXISTS "search_documents_object"
  ON "search_documents" ("workspace_id", "env_id", "source", "object_id");
