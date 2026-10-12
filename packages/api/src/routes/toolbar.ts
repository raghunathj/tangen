/**
 * File Name: toolbar.ts
 * Purpose: Key-scoped Performance Monitor read route for the Tangen Toolbar -
 *   GET /api/v1/toolbar/qm/:entryId lets a toolbar-enabled API key drill into
 *   ITS OWN captured requests (the entry id arrives via the X-Tangen-Qm
 *   response header) and see per-query timings with redacted statement
 *   shapes. Raw SQL text stays behind the admin-gated Performance Monitor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: API-key auth ONLY (member sessions use the admin
 *   routes), gated on permissions.toolbar.enabled - the same switch that
 *   gates the timing headers. Everything the key must not see is a uniform
 *   404: unknown/evicted entries, capture off, and entries produced by a
 *   DIFFERENT key or by an admin member (a key can never read other callers'
 *   requests). Query shapes go through redactSqlShape (normalizeSql + literal
 *   stripping) so no literal value ever leaves this route.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../lib/errors'
import { qmGet, qmEnabled, redactSqlShape } from '../lib/query-monitor'

export const toolbarQmRoutes = (app: Elysia) =>
  app.get('/api/v1/toolbar/qm/:entryId', async (ctx: any) => {
    if (!ctx.apiKeyId || ctx.memberId) {
      throw new RequestError('FORBIDDEN', 'API key required: this route serves the Tangen Toolbar drill-down (admins use the Performance Monitor)', 403)
    }
    const toolbarEnabled = (ctx.permissions as { toolbar?: { enabled?: boolean } } | undefined)?.toolbar?.enabled === true
    if (!toolbarEnabled) {
      throw new RequestError('FORBIDDEN', 'This API key does not have the toolbar permission enabled', 403)
    }

    const entry = qmEnabled() ? qmGet(String(ctx.params.entryId)) : undefined
    // Uniform 404: unknown/evicted id, capture off, or another caller's entry.
    if (!entry || entry.apiKeyId !== ctx.apiKeyId) {
      throw new RequestError('NOT_FOUND', 'Request not found (it may have been evicted, or capture is off)', 404)
    }

    return {
      data: {
        id: entry.id,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        ts: entry.ts,
        totalMs: entry.totalMs,
        dbMs: Math.round(entry.queries.reduce((n, q) => n + q.durationMs, 0) * 100) / 100,
        waitMs: Math.round(entry.queries.reduce((n, q) => n + (q.waitMs ?? 0), 0) * 100) / 100,
        queryCount: entry.queries.length,
        droppedQueries: entry.droppedQueries,
        dupCount: (entry.dupGroups ?? []).reduce((n, g) => n + g.count - 1, 0),
        queries: entry.queries.map((q) => ({
          shape: redactSqlShape(q.sql),
          durationMs: q.durationMs,
          ...(q.waitMs != null && q.waitMs > 0 ? { waitMs: q.waitMs } : {}),
          ...(q.error ? { error: true } : {}),
        })),
      },
    }
  })
