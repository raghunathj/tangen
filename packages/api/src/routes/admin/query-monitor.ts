/**
 * File Name: query-monitor.ts
 * Purpose: Admin read/control routes for the Query Monitor (Devspace tool) -
 *   list captured requests, fetch one with its full query log, toggle
 *   capture at runtime, clear the buffer. Owner/admin/superadmin only
 *   (same gate as the API Playground).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Data is the per-process in-memory ring buffer - in a
 *   multi-process deployment each process shows its own view (dev tool;
 *   dev runs single-process). List rows are summaries; SQL text ships only
 *   in the detail route.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import {
  qmList, qmGet, qmClear, qmEnabled, setQmOverride, normalizeSql,
  type RequestEntry, qmFilterMs } from '../../lib/query-monitor'
import { aggregateRoutes, aggregateStatements, findNPlusOne, aggregatePages } from '../../lib/query-monitor-analysis'
import { gatewayMonitorSnapshot } from '../../gateway/monitor'

function requireAdminRole(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
  const role = String(ctx.memberRole ?? '')
  if (role !== 'owner' && role !== 'admin' && role !== 'superadmin') {
    throw new RequestError('FORBIDDEN', 'The Query Monitor is available to owners and admins only', 403)
  }
}

/** List-row projection - drop per-query SQL (detail route serves it). */
function summarize(e: RequestEntry) {
  return {
    id: e.id,
    method: e.method,
    path: e.path,
    page: e.page,
    status: e.status,
    ts: e.ts,
    totalMs: e.totalMs,
    queryCount: e.queries.length,
    droppedQueries: e.droppedQueries,
    dbMs: Math.round(e.queries.reduce((n, q) => n + q.durationMs, 0) * 100) / 100,
    dupCount: (e.dupGroups ?? []).reduce((n, g) => n + g.count - 1, 0),
    cacheHits: e.cacheEvents.filter((c) => c.status === 'hit').length,
    cacheMisses: e.cacheEvents.filter((c) => c.status === 'miss').length,
    // K4.3: the filters that ran, for the Performance Monitor.
    filterMs: qmFilterMs(e),
    filterSteps: e.filters?.length ?? 0,
    workspaceId: e.workspaceId,
  }
}

export const queryMonitorRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/query-monitor/requests', async (ctx: any) => {
      requireAdminRole(ctx)
      const limit = Math.min(Math.max(Number(ctx.query.limit) || 50, 1), 200)
      const offset = Math.max(Number(ctx.query.offset) || 0, 0)
      let rows = qmList()
      // Scope to the caller's workspace/env unless ?all=1 (superadmin debugging)
      if (ctx.query.all !== '1') {
        rows = rows.filter((e) => !e.workspaceId || e.workspaceId === ctx.workspaceId)
      }
      if (ctx.query.path) rows = rows.filter((e) => e.path.includes(String(ctx.query.path)))
      if (ctx.query.page) rows = rows.filter((e) => (e.page ?? '').includes(String(ctx.query.page)))
      if (ctx.query.slow === '1') rows = rows.filter((e) => (e.totalMs ?? 0) >= 100)
      if (ctx.query.dups === '1') rows = rows.filter((e) => (e.dupGroups ?? []).length > 0)
      return {
        data: rows.slice(offset, offset + limit).map(summarize),
        meta: { total: rows.length, limit, offset, enabled: qmEnabled() },
      }
    })

    .get('/api/v1/admin/query-monitor/requests/:id', async (ctx: any) => {
      requireAdminRole(ctx)
      const entry = qmGet(ctx.params.id)
      if (!entry) throw new RequestError('NOT_FOUND', 'Request not found (the ring buffer may have evicted it)', 404)
      return { data: entry }
    })

    .get('/api/v1/admin/query-monitor/aggregates', async (ctx: any) => {
      requireAdminRole(ctx)
      let rows = qmList()
      if (ctx.query.all !== '1') {
        rows = rows.filter((e) => !e.workspaceId || e.workspaceId === ctx.workspaceId)
      }
      return {
        data: {
          routes: aggregateRoutes(rows),
          pages: aggregatePages(rows),
          slowStatements: aggregateStatements(rows, normalizeSql),
          nPlusOne: findNPlusOne(rows),
          sampled: rows.length,
        },
      }
    })

    // Gateway counters (plan 29.5): denials by policy and dimension,
    // near-misses, CORS observe divergences, request-limit refusals, store
    // failures, surface refusals, realtime connections. Process-wide since
    // the process started, like the ring buffer; counters keyed on a
    // workspace are scoped to the caller's unless ?all=1.
    .get('/api/v1/admin/query-monitor/gateway', async (ctx: any) => {
      requireAdminRole(ctx)
      return { data: gatewayMonitorSnapshot({ workspaceId: ctx.query.all === '1' ? null : ctx.workspaceId }) }
    })

    // Full snapshot for offline analysis (save the JSON, hand it to your agent).
    .get('/api/v1/admin/query-monitor/export', async (ctx: any) => {
      requireAdminRole(ctx)
      let rows = qmList()
      if (ctx.query.all !== '1') {
        rows = rows.filter((e) => !e.workspaceId || e.workspaceId === ctx.workspaceId)
      }
      return {
        data: {
          exportedAt: new Date().toISOString(),
          workspaceId: ctx.workspaceId,
          entries: rows,
          aggregates: {
            routes: aggregateRoutes(rows),
            pages: aggregatePages(rows),
            slowStatements: aggregateStatements(rows, normalizeSql),
            nPlusOne: findNPlusOne(rows),
          },
        },
      }
    })

    .post('/api/v1/admin/query-monitor/toggle', async (ctx: any) => {
      requireAdminRole(ctx)
      const on = Boolean((ctx.body as { enabled?: boolean } | undefined)?.enabled)
      setQmOverride(on)
      return { data: { enabled: qmEnabled() } }
    })

    .delete('/api/v1/admin/query-monitor/requests', async (ctx: any) => {
      requireAdminRole(ctx)
      qmClear()
      return { data: { cleared: true } }
    })
