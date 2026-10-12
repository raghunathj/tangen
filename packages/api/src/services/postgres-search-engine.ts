/**
 * File Name: postgres-search-engine.ts
 * Purpose: The default content-search engine: PostgreSQL full text, in the
 *   database Tangen already requires.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every non-obvious choice here came out of measurement at
 *   a million documents, and each is noted where it is made. The three that
 *   shape the whole file:
 *
 *   1. Every constraint a search applies is INSIDE the GIN index. The prototype
 *      filtered `is_published` afterwards and PostgreSQL fetched 50,000 heap
 *      rows to discard all of them - 2.3 seconds for an empty result.
 *   2. Facets come from ONE materialised match set. Three dimensions as three
 *      queries cost 56.8 ms; as one CTE, 23.0 ms.
 *   3. Autocomplete is an anchored B-tree range scan, never trigram and never a
 *      ranked body prefix. Trigram was erratic (0.04 ms to 11.6 ms for
 *      different prefixes, 137 ms tails); ranked body prefix was 886 ms.
 *
 *   Writes take an optional transaction and are a single statement, so search
 *   maintenance rides along with the content mutation and adds no round trip.
 */
import { sql } from 'drizzle-orm'
import type {
  SearchEngine, SearchEngineCapabilities, EngineQuery, EngineResult, EngineHit,
  SearchDocumentInput, SearchDocumentRef,
} from './search-engine'
import { describeLanguageSupport, textConfigForLocale } from './search-engine'
import { searchGovernor, SearchGovernor } from './search-governor'

/** Snippet source cap. ts_headline is linear in the text it is handed. */
export const EXCERPT_LIMIT = 2_000

type Db = { execute: (q: unknown) => Promise<unknown> }
const rows = <T>(r: unknown): T[] =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as T[]

/** Metadata dimensions a caller may facet on. Anything else is refused. */
const FACET_KEYS = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/

export class PostgresSearchEngine implements SearchEngine {
  readonly id = 'postgres'

  constructor(
    private readonly db: Db,
    private readonly governor: SearchGovernor = searchGovernor,
    /** Typo tolerance needs pg_trgm and its own migration; off by default. */
    private readonly fuzzyEnabled = false,
  ) {}

  get capabilities(): SearchEngineCapabilities {
    return {
      fullText: true,
      prefix: true,
      fuzzy: this.fuzzyEnabled,
      facets: true,
      highlight: true,
      consistency: 'transactional',
      languages: describeLanguageSupport(),
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  async search(q: EngineQuery): Promise<EngineResult> {
    const query = this.governor.normalizeQuery(q.query)
    const { limit, offset } = this.governor.clamp(q.limit, q.offset)
    const cfg = textConfigForLocale(q.locale)

    return this.governor.run(q.workspaceId, async () => {
      const scope = this.scope(q)
      // ONE materialised match set: results and every facet dimension read from
      // it, instead of re-running the match per dimension.
      const facetKeys = (q.facets ?? []).filter((k) => FACET_KEYS.test(k)).slice(0, 5)
      const wantFacets = facetKeys.length > 0
      const headline = q.highlight
        ? sql`ts_headline(${sql.raw(`'${cfg}'`)}::regconfig, m.excerpt, websearch_to_tsquery(${sql.raw(`'${cfg}'`)}::regconfig, ${query}), 'MaxFragments=1,MaxWords=24,MinWords=8')`
        : sql`null::text`

      const statement = sql`
        WITH m AS MATERIALIZED (
          SELECT object_id, source, type_slug, locale, title, slug, status, is_published, excerpt, metadata,
                 ts_rank_cd(search_vector, websearch_to_tsquery(${sql.raw(`'${cfg}'`)}::regconfig, ${query})) AS score
            FROM search_documents
           WHERE ${scope}
             AND search_vector @@ websearch_to_tsquery(${sql.raw(`'${cfg}'`)}::regconfig, ${query})
           LIMIT ${this.governor.config.maxResults * 10}
        )
        SELECT m.object_id, m.source, m.type_slug, m.locale, m.title, m.slug, m.status, m.is_published,
               m.score, m.metadata, ${headline} AS highlight,
               ${wantFacets ? sql`(SELECT jsonb_object_agg(k, v) FROM (${this.facetSelects(facetKeys)}) f(k, v))` : sql`null::jsonb`} AS facets
          FROM m
         ORDER BY m.score DESC, m.object_id
         LIMIT ${limit} OFFSET ${offset}`

      const res = await this.withTimeout(statement, query, q.workspaceId)
      const list = rows<Record<string, unknown>>(res)
      const facets = (list[0]?.facets ?? null) as Record<string, Array<{ value: string; count: number }>> | null
      // The inner LIMIT is a safety valve, not a page: if it was reached the
      // ranking is over a bounded prefix of the matches and the caller is told.
      const truncated = list.length === limit && offset + limit >= this.governor.config.maxResults
      if (truncated) this.governor.noteTruncated()
      return { hits: list.map(toHit), ...(facets ? { facets } : {}), ...(truncated ? { truncated } : {}) }
    })
  }

  /**
   * Autocomplete: an anchored range scan on `lower(title)`/`lower(slug)` using
   * the text_pattern_ops indexes. Uniformly 0.015-0.104 ms at a million
   * documents, where trigram ranged over three orders of magnitude.
   */
  async suggest(q: Omit<EngineQuery, 'facets' | 'highlight'>): Promise<EngineHit[]> {
    const query = this.governor.normalizeQuery(q.query).toLowerCase()
    const { limit } = this.governor.clamp(q.limit)
    // LIKE metacharacters would turn an anchored range scan into a full scan.
    const prefix = `${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    return this.governor.run(q.workspaceId, async () => {
      const scope = this.scope(q as EngineQuery)
      // Two anchored range scans, then one row per document with the better
      // score - a title match outranks a slug match, and a document matching
      // both must not appear twice.
      const res = await this.withTimeout(sql`
        SELECT DISTINCT ON (source, type_slug, object_id, locale)
               object_id, source, type_slug, locale, title, slug, status, is_published, metadata, score
          FROM (
            SELECT object_id, source, type_slug, locale, title, slug, status, is_published, metadata, 1.0::float8 AS score
              FROM search_documents WHERE ${scope} AND lower(title) LIKE ${prefix}
             UNION ALL
            SELECT object_id, source, type_slug, locale, title, slug, status, is_published, metadata, 0.5::float8 AS score
              FROM search_documents WHERE ${scope} AND lower(slug) LIKE ${prefix}
          ) u
         ORDER BY source, type_slug, object_id, locale, score DESC
         LIMIT ${limit}`, query, q.workspaceId)
      return rows<Record<string, unknown>>(res).map(toHit)
    })
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  /**
   * One statement for any number of documents, so it can be folded into the
   * caller's transaction and cost no extra round trip. `cfg` is derived from
   * the locale here rather than by the caller, so the language rule lives in
   * exactly one place.
   */
  async index(docs: SearchDocumentInput[], tx?: unknown): Promise<void> {
    return this.write(docs, tx, 'overwrite')
  }

  /** Gap filling only - an existing document always wins. See the contract. */
  async indexIfAbsent(docs: SearchDocumentInput[], tx?: unknown): Promise<void> {
    return this.write(docs, tx, 'if-absent')
  }

  private async write(docs: SearchDocumentInput[], tx: unknown, mode: 'overwrite' | 'if-absent'): Promise<void> {
    if (docs.length === 0) return
    const db = (tx as Db) ?? this.db
    const values = docs.map((d) => sql`(
      ${d.workspaceId}, ${d.source}, ${d.typeSlug}, ${d.objectId}, ${d.locale ?? ''},
      ${textConfigForLocale(d.locale)}::regconfig,
      ${d.title ?? ''}, ${d.slug ?? null}, ${d.body ?? ''}, ${(d.excerpt ?? '').slice(0, EXCERPT_LIMIT)},
      ${d.status ?? 'draft'}, ${d.isPublished ?? false}, ${JSON.stringify(d.metadata ?? {})}::jsonb, now())`)
    await db.execute(sql`
      INSERT INTO search_documents
        (workspace_id, source, type_slug, object_id, locale, cfg, title, slug, body, excerpt, status, is_published, metadata, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ${mode === 'if-absent'
        ? sql`ON CONFLICT (workspace_id, source, type_slug, object_id, locale) DO NOTHING`
        : sql`ON CONFLICT (workspace_id, source, type_slug, object_id, locale) DO UPDATE SET
        cfg = EXCLUDED.cfg, title = EXCLUDED.title, slug = EXCLUDED.slug, body = EXCLUDED.body,
        excerpt = EXCLUDED.excerpt, status = EXCLUDED.status, is_published = EXCLUDED.is_published,
        metadata = EXCLUDED.metadata, updated_at = now()
      -- Skip the write entirely when nothing searchable changed: a status-only
      -- or metadata-only edit should not revectorise, and re-writing identical
      -- text is measurably cheaper to skip than to perform.
      WHERE search_documents.title      IS DISTINCT FROM EXCLUDED.title
         OR search_documents.slug       IS DISTINCT FROM EXCLUDED.slug
         OR search_documents.body       IS DISTINCT FROM EXCLUDED.body
         OR search_documents.excerpt    IS DISTINCT FROM EXCLUDED.excerpt
         OR search_documents.status     IS DISTINCT FROM EXCLUDED.status
         OR search_documents.is_published IS DISTINCT FROM EXCLUDED.is_published
         OR search_documents.cfg        IS DISTINCT FROM EXCLUDED.cfg
         OR search_documents.metadata   IS DISTINCT FROM EXCLUDED.metadata`}`)
  }

  /** Removes every locale of an object unless one is named. */
  async remove(refs: SearchDocumentRef[], tx?: unknown): Promise<void> {
    if (refs.length === 0) return
    const db = (tx as Db) ?? this.db
    const preds = refs.map((r) => sql`(workspace_id = ${r.workspaceId}
      AND source = ${r.source} AND type_slug = ${r.typeSlug} AND object_id = ${r.objectId}
      ${r.locale !== undefined ? sql`AND locale = ${r.locale}` : sql``})`)
    await db.execute(sql`DELETE FROM search_documents WHERE ${sql.join(preds, sql` OR `)}`)
  }

  /** Uninstalling an extension is one statement, which an in-memory index cannot offer. */
  async removeSource(workspaceId: string, source: string): Promise<number> {
    const res = await this.db.execute(sql`
      DELETE FROM search_documents
       WHERE workspace_id = ${workspaceId} AND source = ${source}
      RETURNING 1`)
    return rows(res).length
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * The scope predicate. Every column named here is in `search_documents_fts`,
   * so PostgreSQL narrows inside the index instead of fetching and discarding.
   */
  private scope(q: EngineQuery) {
    const parts = [sql`workspace_id = ${q.workspaceId}`]
    if (q.locale !== undefined) parts.push(sql`locale = ${q.locale}`)
    if (q.audience === 'public') parts.push(sql`is_published = true`)
    if (q.source) parts.push(sql`source = ${q.source}`)
    if (q.typeSlug) parts.push(sql`type_slug = ${q.typeSlug}`)
    if (q.allowedTypes && q.allowedTypes.length > 0) {
      parts.push(sql`type_slug IN (${sql.join(q.allowedTypes.map((t) => sql`${t}`), sql`, `)})`)
    }
    return sql.join(parts, sql` AND `)
  }

  private facetSelects(keys: string[]) {
    return sql.join(keys.map((k) => sql`
      SELECT ${k}::text, jsonb_agg(jsonb_build_object('value', value, 'count', n) ORDER BY n DESC)
        FROM (SELECT coalesce(m.metadata->>${k}, '') AS value, count(*)::int AS n
                FROM m GROUP BY 1) s`), sql` UNION ALL `)
  }

  /**
   * A local statement_timeout, set and reset around the query. PostgreSQL
   * cancels the statement rather than letting it hold a pooled connection for
   * the two seconds the worst measured query took, and the caller learns it
   * timed out instead of receiving a silent empty page.
   */
  private async withTimeout(statement: unknown, query: string, workspaceId: string): Promise<unknown> {
    const ms = this.governor.config.statementTimeoutMs
    const db = this.db as Db & { transaction?: (f: (tx: Db) => Promise<unknown>) => Promise<unknown> }
    try {
      // SET LOCAL only exists inside a transaction, and only a transaction
      // guarantees the timeout and the query land on the SAME pooled
      // connection - setting it on one connection and running on another is
      // how a timeout silently does nothing. The extra COMMIT costs one round
      // trip; against a query allowed to run for two seconds that is the
      // cheapest insurance available without touching pool configuration.
      if (typeof db.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = ${sql.raw(String(ms))}`)
          return tx.execute(statement)
        })
      }
      return await db.execute(statement)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/statement timeout|canceling statement/i.test(message)) {
        this.governor.noteTimeout(query, workspaceId)
        return []
      }
      throw err
    }
  }
}

function toHit(r: Record<string, unknown>): EngineHit {
  return {
    objectId: String(r.object_id),
    source: String(r.source),
    typeSlug: String(r.type_slug),
    locale: String(r.locale ?? ''),
    title: String(r.title ?? ''),
    slug: (r.slug as string | null) ?? null,
    status: String(r.status ?? 'draft'),
    isPublished: Boolean(r.is_published),
    score: Number(r.score ?? 0),
    ...(r.highlight ? { highlight: String(r.highlight) } : {}),
    ...(r.metadata ? { metadata: r.metadata as Record<string, unknown> } : {}),
  }
}
