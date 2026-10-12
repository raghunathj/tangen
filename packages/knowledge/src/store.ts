/**
 * File Name: store.ts
 * Purpose: The pgvector-backed chunk store. Pure SQL builders over an
 *          INJECTED executor (the host passes its postgres client), so this
 *          package stays dependency-free. One table holds every source kind
 *          (object / table / asset / file); knowledge_meta pins the
 *          embedding provider+model+dimensions per workspace×env so queries
 *          can never silently mix vector spaces.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires the pgvector extension — preflight() returns
 *          exact install instructions instead of failing at runtime. Owns NO
 *          schema: the tables are declared and migrated by @tangen/db
 *          (migration 0041) and the vector space is pinned by its
 *          pinKnowledgeVectorSpace; this package only reads and writes rows.
 */

/** Host-provided SQL executor (e.g. postgres.js `client.unsafe`). */
export type SqlExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export type SourceKind = 'object' | 'table' | 'asset' | 'file' | 'qa'

export interface KnowledgeChunk {
  workspaceId: string
  sourceKind: SourceKind
  /** Object id / table row id / asset id / repo file path. */
  sourceId: string
  /** Type name, table name, folder, or '' for repo files. */
  sourceGroup: string
  /** Field/column the text came from ('' for whole-document sources). */
  field: string
  locale: string
  /** Retrieval audience — enforced in the search SQL ('public' default). */
  audience: string
  chunkIndex: number
  content: string
  contentHash: string
  metadata?: Record<string, unknown>
  embedding: number[]
}

export interface KnowledgeHit {
  sourceKind: SourceKind
  sourceId: string
  sourceGroup: string
  field: string
  audience: string
  chunkIndex: number
  content: string
  metadata: Record<string, unknown> | null
  score: number
}

export interface PreflightResult {
  ok: boolean
  installed: boolean
  available: boolean
  instructions?: string
}

const INSTALL_INSTRUCTIONS = `The pgvector extension is not available on this Postgres server.
Install it, then re-run:
  Ubuntu/Debian:  sudo apt install postgresql-<version>-pgvector
  macOS/Homebrew: brew install pgvector
  Docker:         use the pgvector/pgvector image
  Neon/Supabase/RDS: pgvector ships built in - just enable the extension.
Then, as the database owner: CREATE EXTENSION vector;
and start Tangen again (or run \`bun run db:migrate\` in packages/db): its migrations create knowledge_chunks once the type exists.`

const vec = (embedding: number[]): string => `[${embedding.join(',')}]`

/**
 * Maps raw Postgres errors from missing-pgvector states to an actionable
 * message. Every store method that needs the extension routes failures
 * through this, so a runtime path (embed task, search endpoint) can never
 * surface a bare 'type "vector" does not exist'.
 */
export function friendlyVectorError(err: unknown): Error {
  const msg = (err as Error)?.message ?? String(err)
  if (/type "vector" does not exist|extension "vector"|could not open extension control file/i.test(msg)) {
    return new Error(`pgvector is not installed on this Postgres server.\n${INSTALL_INSTRUCTIONS}`)
  }
  if (/relation "knowledge_chunks" does not exist|relation "knowledge_meta" does not exist/i.test(msg)) {
    return new Error(`The knowledge tables are missing: Tangen's migrations have not run against this database, or pgvector is not enabled in it.\n${INSTALL_INSTRUCTIONS}`)
  }
  return err instanceof Error ? err : new Error(msg)
}

/** Wraps a store op so pgvector/setup failures explain themselves. */
async function explained<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw friendlyVectorError(err)
  }
}

export function createKnowledgeStore(exec: SqlExec) {
  return {
    /** Is pgvector usable? Never throws — reports with instructions. */
    async preflight(): Promise<PreflightResult> {
      try {
        const rows = await exec(
          `SELECT installed_version IS NOT NULL AS installed, TRUE AS available
             FROM pg_available_extensions WHERE name = 'vector'`,
        )
        if (rows.length === 0) return { ok: false, installed: false, available: false, instructions: INSTALL_INSTRUCTIONS }
        const installed = Boolean(rows[0].installed)
        return { ok: true, installed, available: true, ...(installed ? {} : {}) }
      } catch (e) {
        return { ok: false, installed: false, available: false, instructions: `${(e as Error).message}\n${INSTALL_INSTRUCTIONS}` }
      }
    },

    /** The vector-space pin. Mismatched queries must be refused by callers. */
    async getMeta(workspaceId: string) {
      const rows = await exec(
        `SELECT provider, model, dimensions FROM knowledge_meta WHERE workspace_id = $1`,
        [workspaceId],
      )
      return rows[0] as { provider: string; model: string; dimensions: number } | undefined
    },

    async setMeta(workspaceId: string, meta: { provider: string; model: string; dimensions: number }) {
      await exec(
        `INSERT INTO knowledge_meta (workspace_id, provider, model, dimensions, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (workspace_id)
         DO UPDATE SET provider = $3, model = $4, dimensions = $5, updated_at = now()`,
        [workspaceId, meta.provider, meta.model, meta.dimensions],
      )
    },

    /** Content-hash of existing chunks for a source — the skip-unchanged check. */
    async sourceHashes(workspaceId: string, sourceKind: SourceKind, sourceId: string): Promise<string[]> {
      const rows = await explained(() => exec(
        `SELECT DISTINCT content_hash FROM knowledge_chunks
         WHERE workspace_id = $1 AND source_kind = $2 AND source_id = $3`,
        [workspaceId, sourceKind, sourceId],
      ))
      return rows.map((r) => String(r.content_hash))
    },

    /** Replace-all-chunks-for-source (delete + insert — chunk counts change). */
    async replaceSource(chunks: KnowledgeChunk[], scope: {
      workspaceId: string; sourceKind: SourceKind; sourceId: string
    }): Promise<void> {
      return explained(async () => {
      await exec(
        `DELETE FROM knowledge_chunks WHERE workspace_id = $1 AND source_kind = $2 AND source_id = $3`,
        [scope.workspaceId, scope.sourceKind, scope.sourceId],
      )
      for (const c of chunks) {
        await exec(
          `INSERT INTO knowledge_chunks
           (workspace_id, source_kind, source_id, source_group, field, locale, audience, chunk_index, content, content_hash, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)`,
          [c.workspaceId, c.sourceKind, c.sourceId, c.sourceGroup, c.field, c.locale, c.audience,
           c.chunkIndex, c.content, c.contentHash, c.metadata ? JSON.stringify(c.metadata) : null, vec(c.embedding)],
        )
      }
      })
    },

    async deleteSource(workspaceId: string, sourceKind: SourceKind, sourceId: string): Promise<void> {
      await exec(
        `DELETE FROM knowledge_chunks WHERE workspace_id = $1 AND source_kind = $2 AND source_id = $3`,
        [workspaceId, sourceKind, sourceId],
      )
    },

    /** Cosine top-k, optionally filtered by source kinds/groups/locale. */
    async search(workspaceId: string, embedding: number[], opts: {
      k?: number
      sourceKinds?: SourceKind[]
      sourceGroups?: string[]
      /** Restrict to one locale (+ default-locale fallback). Omit = default only. */
      locale?: string
      /**
       * Audiences the CALLER is allowed to retrieve — enforced here, in the
       * vector SQL (fail closed: omit ⇒ public only).
       */
      audiences?: string[]
      /**
       * Score multiplier for curated Q&A chunks (>1 ⇒ curated beats raw
       * content at equal relevance). Applied as an over-fetch + re-rank so
       * the vector index still serves the inner scan.
       */
      qaBoost?: number
    } = {}): Promise<KnowledgeHit[]> {
      return explained(async () => {
      const params: unknown[] = [workspaceId, vec(embedding)]
      let where = `workspace_id = $1`
      if (opts.sourceKinds?.length) {
        params.push(opts.sourceKinds)
        where += ` AND source_kind = ANY($${params.length})`
      }
      if (opts.sourceGroups?.length) {
        params.push(opts.sourceGroups)
        where += ` AND source_group = ANY($${params.length})`
      }
      // Audience enforcement lives HERE — retrieval-layer, never post-filtered
      const audiences = opts.audiences?.length ? opts.audiences : ['public']
      params.push(audiences)
      where += ` AND audience = ANY($${params.length})`
      // No cross-locale mixing: requested locale + default fallback, else default only
      if (opts.locale) {
        params.push(opts.locale)
        where += ` AND locale IN ('', $${params.length})`
      } else {
        where += ` AND locale = ''`
      }
      const k = Math.min(opts.k ?? 8, 50)
      const boost = opts.qaBoost && opts.qaBoost !== 1 ? opts.qaBoost : null
      let sql: string
      if (boost) {
        // Over-fetch by raw distance (index-friendly), then re-rank with the
        // curated boost so qa pairs can overtake near-equal raw content.
        params.push(boost)
        const boostIdx = params.length
        params.push(Math.min(k * 4, 100))
        const innerIdx = params.length
        params.push(k)
        sql = `SELECT * FROM (
            SELECT source_kind, source_id, source_group, field, audience, chunk_index, content, metadata,
                   (1 - (embedding <=> $2::vector)) * (CASE WHEN source_kind = 'qa' THEN $${boostIdx}::float8 ELSE 1.0 END) AS score
              FROM knowledge_chunks
             WHERE ${where}
             ORDER BY embedding <=> $2::vector
             LIMIT $${innerIdx}
          ) ranked
          ORDER BY score DESC
          LIMIT $${params.length}`
      } else {
        params.push(k)
        sql = `SELECT source_kind, source_id, source_group, field, audience, chunk_index, content, metadata,
                1 - (embedding <=> $2::vector) AS score
           FROM knowledge_chunks
          WHERE ${where}
          ORDER BY embedding <=> $2::vector
          LIMIT $${params.length}`
      }
      const rows = await exec(sql, params)
      return rows.map((r) => {
        // jsonb params written as strings read back double-encoded — normalize
        let metadata = (r.metadata as Record<string, unknown> | string | null) ?? null
        if (typeof metadata === 'string') {
          try { metadata = JSON.parse(metadata) } catch { metadata = null }
        }
        return {
          sourceKind: r.source_kind as SourceKind,
          sourceId: String(r.source_id),
          sourceGroup: String(r.source_group),
          field: String(r.field),
          audience: String(r.audience ?? 'public'),
          chunkIndex: Number(r.chunk_index),
          content: String(r.content),
          metadata: metadata as Record<string, unknown> | null,
          score: Number(r.score),
        }
      })
      })
    },

    /** Chunk counts by audience (status displays). */
    async audienceCounts(workspaceId: string): Promise<Record<string, number>> {
      const rows = await exec(
        `SELECT audience, count(*)::int AS n FROM knowledge_chunks
          WHERE workspace_id = $1 GROUP BY audience`,
        [workspaceId],
      ).catch(() => [])
      return Object.fromEntries(rows.map((r) => [String(r.audience), Number(r.n)]))
    },

    /** Chunk counts by source kind (status displays). */
    async counts(workspaceId: string): Promise<Record<string, number>> {
      const rows = await exec(
        `SELECT source_kind, count(*)::int AS n FROM knowledge_chunks
          WHERE workspace_id = $1 GROUP BY source_kind`,
        [workspaceId],
      )
      return Object.fromEntries(rows.map((r) => [String(r.source_kind), Number(r.n)]))
    },
  }
}

export type KnowledgeStore = ReturnType<typeof createKnowledgeStore>
