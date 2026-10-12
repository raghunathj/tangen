/**
 * File Name: knowledge-schema.ts
 * Purpose: The ONE authority for the Knowledge tables' DDL (freeze review C4).
 *          The canonical statements live here; migration 0041 carries them
 *          verbatim (a test proves it); `ensureConditionalSystemSchema` applies
 *          the pgvector-dependent part from the canonical migration entrypoint
 *          when the extension arrived after the migration ran; and
 *          `pinKnowledgeVectorSpace` is the single configuration-driven DDL
 *          step - typing `embedding` to the configured model's dimensions and
 *          building its ANN index - owned here, not by @tangen/knowledge.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pgvector is an OPERATOR PREREQUISITE (decision B in
 *          docs/architecture/database-safety.md): Tangen never runs
 *          `CREATE EXTENSION vector`. `knowledge_meta`, `knowledge_qa` and
 *          `knowledge_queries` need nothing and always exist after 0041;
 *          `knowledge_chunks` needs the `vector` type and exists once it does.
 *          Every statement is idempotent so the migration adopts tables an
 *          older @tangen/knowledge created at runtime without touching a row.
 */

/** One statement in, rows out; the shape postgres.js `unsafe` and PGlite `query` both give. */
export type SystemSqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export const KNOWLEDGE_TABLES = ['knowledge_meta', 'knowledge_chunks', 'knowledge_qa', 'knowledge_queries'] as const
export type KnowledgeTable = typeof KNOWLEDGE_TABLES[number]

/** The tables that need nothing but PostgreSQL. Idempotent: adoption of runtime-created tables is a no-op. */
export const KNOWLEDGE_TABLE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "knowledge_meta" (
  "workspace_id" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "dimensions" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id")
)`,
  `CREATE TABLE IF NOT EXISTS "knowledge_qa" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "audience" text NOT NULL DEFAULT 'public',
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS "knowledge_qa_scope_idx" ON "knowledge_qa" ("workspace_id")`,
  `CREATE TABLE IF NOT EXISTS "knowledge_queries" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "query" text NOT NULL,
  "source" text NOT NULL,
  "audience" text NOT NULL DEFAULT 'public',
  "locale" text NOT NULL DEFAULT '',
  "top_score" real,
  "hit_count" integer NOT NULL DEFAULT 0,
  "answered" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS "knowledge_queries_scope_idx" ON "knowledge_queries" ("workspace_id", "created_at")`,
]

/**
 * The table that needs pgvector's `vector` type. `embedding` is declared
 * without dimensions: they belong to the configured model and are applied by
 * `pinKnowledgeVectorSpace`. Installs whose table an older runtime created
 * already carry `vector(N)`; the pin leaves a matching column alone.
 */
export const KNOWLEDGE_CHUNKS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" text NOT NULL,
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
)`,
  `ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "audience" text NOT NULL DEFAULT 'public'`,
  `CREATE INDEX IF NOT EXISTS "knowledge_chunks_scope_idx" ON "knowledge_chunks" ("workspace_id", "source_kind", "source_id")`,
]

/** The migration's form of the pgvector-dependent DDL: applied only when the `vector` type is installed. */
export function knowledgeChunksMigrationBlock(): string {
  const body = KNOWLEDGE_CHUNKS_DDL.map((s) => `    EXECUTE $ddl$${s}$ddl$;`).join('\n')
  return `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
${body}
  END IF;
END $$;`
}

export const VECTOR_INSTALLED_SQL = `SELECT 1 AS ok FROM pg_type WHERE typname = 'vector'`

/** True when pgvector's `vector` type exists in this database. */
export async function isVectorInstalled(exec: SystemSqlExec): Promise<boolean> {
  return (await exec(VECTOR_INSTALLED_SQL)).length > 0
}

/**
 * The part of the system schema that depends on an optional server extension,
 * applied from the canonical migration entrypoint (`runMigrations`) so an
 * extension installed AFTER migration 0041 ran still yields the table the
 * migration declares. Idempotent; nothing when pgvector is absent.
 */
export async function ensureConditionalSystemSchema(exec: SystemSqlExec): Promise<{ knowledgeChunks: 'applied' | 'skipped' }> {
  if (!(await isVectorInstalled(exec))) return { knowledgeChunks: 'skipped' }
  for (const stmt of KNOWLEDGE_CHUNKS_DDL) await exec(stmt)
  return { knowledgeChunks: 'applied' }
}

export interface KnowledgeSchemaStatus {
  /** pgvector's `vector` type exists in this database. */
  vectorInstalled: boolean
  /** The server ships pgvector (installable); null when it could not be asked. */
  vectorAvailable: boolean | null
  tables: Record<KnowledgeTable, boolean>
  /** The typed dimensions of `knowledge_chunks.embedding`; null when untyped; undefined when the table is absent. */
  embeddingDimensions: number | null | undefined
}

const EMBEDDING_TYPE_SQL = `SELECT format_type(a.atttypid, a.atttypmod) AS type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relname = 'knowledge_chunks' AND a.attname = 'embedding' AND NOT a.attisdropped`

function parseVectorType(type: string | undefined): number | null | undefined {
  if (type === undefined) return undefined
  const m = /^vector\((\d+)\)$/.exec(type)
  return m ? Number(m[1]) : null
}

/** What doctor and the diagnostics look at: the extension, the four tables, the typed dimensions. */
export async function readKnowledgeSchemaStatus(exec: SystemSqlExec): Promise<KnowledgeSchemaStatus> {
  const vectorInstalled = await isVectorInstalled(exec)
  let vectorAvailable: boolean | null = null
  try {
    vectorAvailable = (await exec(`SELECT 1 AS ok FROM pg_available_extensions WHERE name = 'vector'`)).length > 0
  } catch { vectorAvailable = null }
  // No bind parameters: doctor's read-only query takes a bare statement.
  const present = new Set((await exec(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN (${KNOWLEDGE_TABLES.map((t) => `'${t}'`).join(', ')})`,
  )).map((r) => String(r.table_name)))
  const tables = Object.fromEntries(KNOWLEDGE_TABLES.map((t) => [t, present.has(t)])) as Record<KnowledgeTable, boolean>
  const typeRows = tables.knowledge_chunks ? await exec(EMBEDDING_TYPE_SQL) : []
  return { vectorInstalled, vectorAvailable, tables, embeddingDimensions: parseVectorType(typeRows[0]?.type as string | undefined) }
}

/** What an operator has to do, given the status; empty when Knowledge can run. */
export function knowledgeSchemaAdvice(status: KnowledgeSchemaStatus): string {
  if (!status.vectorInstalled) {
    return status.vectorAvailable === false
      ? 'pgvector is not installed on this PostgreSQL server. It is a prerequisite Tangen does not install: add the package for your platform (docs/knowledge.md, "Enabling pgvector"), run `CREATE EXTENSION vector;` as the database owner, then start Tangen again so its migrations create knowledge_chunks.'
      : 'pgvector is available on this server but not enabled in this database. Run `CREATE EXTENSION vector;` as the database owner, then start Tangen again (or run `bun run db:migrate` in packages/db) so its migrations create knowledge_chunks.'
  }
  const missing = KNOWLEDGE_TABLES.filter((t) => !status.tables[t])
  if (missing.length > 0) {
    return `The knowledge table${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing: Tangen's migrations have not run against this database. They run at API boot (unless TANGEN_SKIP_MIGRATE=1), or run \`bun run db:migrate\` in packages/db.`
  }
  return ''
}

export class KnowledgeSchemaError extends Error {
  readonly status: KnowledgeSchemaStatus
  constructor(status: KnowledgeSchemaStatus, message = knowledgeSchemaAdvice(status)) {
    super(message)
    this.name = 'KnowledgeSchemaError'
    this.status = status
  }
}

export interface VectorSpacePin {
  dimensions: number
  /** The column was (re)typed to these dimensions. */
  retyped: boolean
  /** The ANN index now on the column: built here, already there, or none (sequential scan). */
  index: 'hnsw' | 'ivfflat' | 'existing' | 'none'
}

/**
 * Pins `knowledge_chunks.embedding` to the configured model's dimensions and
 * gives it an ANN index. The one configuration-driven DDL step Knowledge has;
 * owned here so the DDL has exactly one author. Idempotent: a column already
 * typed to `dimensions` is left alone. Refuses to retype a column that holds
 * rows in another space - that is a rebuild, and the caller says so.
 */
export async function pinKnowledgeVectorSpace(exec: SystemSqlExec, dimensions: number): Promise<VectorSpacePin> {
  const dims = Math.floor(dimensions)
  if (!(dims > 0)) throw new Error(`knowledge: embedding dimensions must be a positive integer, got ${dimensions}`)
  const status = await readKnowledgeSchemaStatus(exec)
  if (!status.tables.knowledge_chunks) throw new KnowledgeSchemaError(status)

  let retyped = false
  if (status.embeddingDimensions !== dims) {
    if (status.embeddingDimensions !== null && status.embeddingDimensions !== undefined) {
      const n = Number((await exec(`SELECT count(*)::int AS n FROM "knowledge_chunks"`))[0]?.n ?? 0)
      if (n > 0) {
        throw new Error(`knowledge_chunks holds ${n} chunk${n === 1 ? '' : 's'} in a ${status.embeddingDimensions}-dimension vector space and the configured model needs ${dims}. Run: tangen knowledge index --rebuild`)
      }
    }
    await exec(`ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(${dims})`)
    retyped = true
  }

  const existing = await exec(`SELECT 1 AS ok FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'knowledge_chunks' AND indexname = 'knowledge_chunks_embedding_idx'`)
  if (existing.length > 0) return { dimensions: dims, retyped, index: 'existing' }
  // HNSW when the server has it (pgvector >= 0.5); ivfflat otherwise; a sequential scan still answers at small scale.
  try {
    await exec(`CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops)`)
    return { dimensions: dims, retyped, index: 'hnsw' }
  } catch {
    try {
      await exec(`CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100)`)
      return { dimensions: dims, retyped, index: 'ivfflat' }
    } catch {
      return { dimensions: dims, retyped, index: 'none' }
    }
  }
}
