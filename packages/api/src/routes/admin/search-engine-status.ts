/**
 * File Name: search-engine-status.ts
 * Purpose: What the search engine is, what it can do, and what it has been
 *   doing - the production view.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Everything reported here is something the investigation
 *   found by measuring rather than by reading: broad queries evicting the OLTP
 *   working set, a two-second worst case, one workspace crowding out another.
 *   An operator should be able to see all three happening.
 */
import { Elysia } from 'elysia'
import { sql } from 'drizzle-orm'
import { RequestError } from '../../lib/errors'
import { searchGovernor } from '../../services/search-governor'
import { fuzzyEnabled } from '../../services/search-engine-registry'

function requireAdminRole(ctx: { memberId?: string; memberRole?: string }): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
  const role = String(ctx.memberRole ?? '')
  if (role !== 'owner' && role !== 'admin' && role !== 'superadmin') {
    throw new RequestError('FORBIDDEN', 'Search status is available to owners and admins only', 403)
  }
}

export const searchEngineStatusRoute = (app: Elysia) =>
  app.get('/api/v1/admin/search/engine', async (ctx: any) => {
    requireAdminRole(ctx)
    const engine = ctx.searchEngineRef?.current
    // What is actually indexed, scoped to the caller's workspace and
    // environment - an operator migrating needs to see the corpus fill up, and
    // nobody needs another workspace's counts.
    const corpus = await ctx.db.execute(sql`
      SELECT source, type_slug, locale, count(*)::int AS documents,
             count(*) FILTER (WHERE is_published)::int AS published,
             max(updated_at) AS newest
        FROM search_documents
       WHERE workspace_id = ${ctx.workspaceId}
       GROUP BY 1, 2, 3
       ORDER BY 4 DESC
       LIMIT 50`).catch(() => [])
    const byType = (Array.isArray(corpus) ? corpus : ((corpus as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
    return {
      data: {
        engine: engine?.id ?? 'none',
        indexed: {
          documents: byType.reduce((n, r) => n + Number(r.documents ?? 0), 0),
          published: byType.reduce((n, r) => n + Number(r.published ?? 0), 0),
          byType,
        },
        capabilities: engine?.capabilities ?? null,
        // Named plainly rather than discovered by a user whose search is empty.
        unsupportedLanguages: engine?.capabilities?.languages?.unsupported ?? [],
        fuzzy: { enabled: fuzzyEnabled(), note: 'Typo tolerance needs pg_trgm and is opt-in: it costs more write throughput and WAL than full-text search itself.' },
        governance: searchGovernor.snapshot(),
      },
    }
  })
