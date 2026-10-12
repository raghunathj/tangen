-- Knowledge (RAG) tables, owned by @tangen/db (freeze review C4).
--
-- Until this migration, @tangen/knowledge created these four tables itself at
-- runtime with CREATE TABLE IF NOT EXISTS: no ledger, no doctor, a second DDL
-- authority. The canonical text now lives in packages/db/src/knowledge-schema.ts
-- and this file carries it verbatim (the test proves it). Every statement is
-- idempotent, so an installation whose tables the runtime already created is
-- adopted as it stands: nothing is dropped, recreated or rewritten.
--
-- pgvector is an operator prerequisite (decision B): Tangen never runs
-- CREATE EXTENSION vector. knowledge_meta, knowledge_qa and knowledge_queries
-- need nothing and are created here unconditionally. knowledge_chunks needs the
-- vector type, so it is created only when that type exists; when pgvector is
-- enabled later, the canonical migration entrypoint (runMigrations, which the
-- API runs at boot) applies the same statements. The embedding column is typed
-- to the configured model dimensions by pinKnowledgeVectorSpace, the one
-- configuration-driven DDL step, also owned by @tangen/db.

CREATE TABLE IF NOT EXISTS "knowledge_meta" (
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "dimensions" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "env_id")
);
CREATE TABLE IF NOT EXISTS "knowledge_qa" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "audience" text NOT NULL DEFAULT 'public',
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "knowledge_qa_scope_idx" ON "knowledge_qa" ("workspace_id", "env_id");
CREATE TABLE IF NOT EXISTS "knowledge_queries" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "query" text NOT NULL,
  "source" text NOT NULL,
  "audience" text NOT NULL DEFAULT 'public',
  "locale" text NOT NULL DEFAULT '',
  "top_score" real,
  "hit_count" integer NOT NULL DEFAULT 0,
  "answered" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "knowledge_queries_scope_idx" ON "knowledge_queries" ("workspace_id", "env_id", "created_at");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    EXECUTE $ddl$CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "env_id" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "source_group" text NOT NULL DEFAULT '',
  "field" text NOT NULL DEFAULT '',
  "locale" text NOT NULL DEFAULT '',
  "audience" text NOT NULL DEFAULT 'public',
  "chunk_index" integer NOT NULL DEFAULT 0,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "metadata" jsonb,
  "embedding" vector NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
)$ddl$;
    EXECUTE $ddl$ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "audience" text NOT NULL DEFAULT 'public'$ddl$;
    EXECUTE $ddl$CREATE INDEX IF NOT EXISTS "knowledge_chunks_scope_idx" ON "knowledge_chunks" ("workspace_id", "env_id", "source_kind", "source_id")$ddl$;
  END IF;
END $$;
