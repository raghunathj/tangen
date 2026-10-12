/**
 * File Name: search-analytics.ts
 * Purpose: GET /api/v1/admin/search-analytics — the Settings → Search dashboard
 *          data (top searches, zero-result searches, volume trend, totals). Reads
 *          retention-bounded query logs (no PII) and summarizes them. Read-only;
 *          requires manage:settings. `days` (≤90) and `audience` filter the window.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { and, eq, gte, desc } from 'drizzle-orm'
import { searchQueryLog } from '@tangen/db'
import { requireCapability } from '../../lib/member-access'
import { summarizeSearchLogs } from '../../services/search-analytics'

export const searchAnalyticsRoute = (app: Elysia) =>
  app.get('/api/v1/admin/search-analytics', async (ctx: any) => {
    const { db, workspaceId, permissions, query } = ctx
    requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')

    const days = Math.min(Math.max(Number(query.days ?? 30), 1), 90)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const audience = query.audience === 'internal' || query.audience === 'public' ? query.audience : undefined

    const rows = await db
      .select({
        term: searchQueryLog.term,
        resultCount: searchQueryLog.resultCount,
        createdAt: searchQueryLog.createdAt,
        audience: searchQueryLog.audience,
      })
      .from(searchQueryLog)
      .where(and(
        eq(searchQueryLog.workspaceId, workspaceId),
        gte(searchQueryLog.createdAt, since),
      ))
      .orderBy(desc(searchQueryLog.createdAt))
      .limit(5000)

    return { data: summarizeSearchLogs(rows as any, { audience }), meta: { days } }
  })
