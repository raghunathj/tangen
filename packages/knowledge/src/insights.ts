/**
 * File Name: insights.ts
 * Purpose: The query-insights log — every retrieval (search/ask/MCP) can
 *          record what was asked and how well the index answered, so admins
 *          get an unanswered / low-confidence backlog to curate Q&A from.
 *          Logging is best-effort by design: a failed insert must never
 *          fail a retrieval.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Query text is END-USER INPUT — treat as PII surface:
 *          truncated to 500 chars, pruned at 90 days (callers run prune
 *          opportunistically), and the whole log has a config off-switch
 *          (knowledge.insights: false). Table is package-owned/idempotent
 *          like knowledge_qa; no pgvector required.
 */
import type { SqlExec } from './store'

export interface QueryLogEntry {
  workspaceId: string
  query: string
  /** Which surface asked: 'search' | 'ask' | 'mcp'. */
  source: string
  /** Audiences granted to the caller, joined — 'public' / 'public,internal'. */
  audience: string
  locale: string
  topScore: number | null
  hitCount: number
  answered: boolean
}

export interface QueryInsightRow {
  query: string
  asks: number
  bestScore: number | null
  answered: boolean
  sources: string[]
  lastSeen: string
}

const MAX_QUERY_CHARS = 500

export function createInsightsStore(exec: SqlExec) {
  return {
    /** One retrieval → one row. Callers wrap in void/catch (best-effort). */
    async log(entry: QueryLogEntry): Promise<void> {
      await exec(
        `INSERT INTO knowledge_queries
         (workspace_id, query, source, audience, locale, top_score, hit_count, answered)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.workspaceId, entry.query.slice(0, MAX_QUERY_CHARS), entry.source,
         entry.audience, entry.locale, entry.topScore, entry.hitCount, entry.answered],
      )
    },

    /** Drops rows older than the retention window (default 90 days). */
    async prune(days = 90): Promise<void> {
      await exec(
        `DELETE FROM knowledge_queries WHERE created_at < now() - $1 * interval '1 day'`,
        [days],
      )
    },

    /**
     * The curation backlog — grouped by normalized query text.
     * mode 'unanswered': nothing ever came back → write the missing content/Q&A.
     * mode 'low': answered but weak (best score under the threshold) → curate.
     * mode 'top': everything, most-asked first (trend view).
     */
    async overview(workspaceId: string, opts: {
      mode?: 'unanswered' | 'low' | 'top'
      threshold?: number
      limit?: number
    } = {}): Promise<QueryInsightRow[]> {
      const params: unknown[] = [workspaceId]
      let having = ''
      if (opts.mode === 'unanswered') {
        having = `HAVING NOT bool_or(answered)`
      } else if (opts.mode === 'low') {
        params.push(opts.threshold ?? 0.5)
        having = `HAVING bool_or(answered) AND max(top_score) < $${params.length}`
      }
      params.push(Math.min(opts.limit ?? 50, 200))
      const rows = await exec(
        `SELECT min(query) AS query, count(*)::int AS asks,
                max(top_score) AS best_score, bool_or(answered) AS answered,
                array_agg(DISTINCT source) AS sources, max(created_at) AS last_seen
           FROM knowledge_queries
          WHERE workspace_id = $1
          GROUP BY lower(btrim(query))
          ${having}
          ORDER BY asks DESC, last_seen DESC
          LIMIT $${params.length}`,
        params,
      )
      return rows.map((r) => ({
        query: String(r.query),
        asks: Number(r.asks),
        bestScore: r.best_score != null ? Number(r.best_score) : null,
        answered: Boolean(r.answered),
        sources: Array.isArray(r.sources) ? r.sources.map(String) : [],
        lastSeen: String(r.last_seen),
      }))
    },
  }
}

export type InsightsStore = ReturnType<typeof createInsightsStore>
