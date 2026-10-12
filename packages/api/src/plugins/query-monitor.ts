/**
 * File Name: query-monitor.ts
 * Purpose: Elysia plugin that opens a Query Monitor capture per /api/v1/*
 *   request (AsyncLocalStorage entered in onRequest - runs inline in the
 *   request's async chain, so downstream db calls attribute correctly) and
 *   finalizes it after the response (or on error; finalize is idempotent).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Mounted early in createServer (before dbPlugin) so
 *   onRequest precedes everything. The store is ALSO stashed on the Elysia
 *   context - finalization must not depend on ALS surviving the post-send
 *   setImmediate that runs onAfterResponse. The monitor's own admin routes
 *   are excluded (watching the watcher is noise).
 */
import { Elysia } from 'elysia'
import { qmAls, qmBegin, qmFinalize, qmEnabled, qmPathEligible, applyQmHookState, normalizeSql, type RequestEntry, serverTimingFor } from '../lib/query-monitor'

function statusOf(c: { set?: { status?: number | string } }): number | undefined {
  const s = c.set?.status
  return typeof s === 'number' ? s : undefined
}

function finalizeFromCtx(c: Record<string, unknown>): void {
  const entry = c.qmEntry as RequestEntry | undefined
  if (!entry) return
  qmFinalize(entry, {
    status: statusOf(c as never),
    workspaceId: c.workspaceId as string | undefined,
    memberId: c.memberId as string | undefined,
    apiKeyId: (c.apiKeyId as string | null | undefined) ?? undefined,
  })
}

export const queryMonitorPlugin = (app: Elysia) => queryMonitorPluginWith()(app)

/**
 * Options form: corsOrigins feeds Timing-Allow-Origin so browsers expose
 * Resource Timing detail for allow-listed site origins (empty list = the
 * permissive dev posture - echo any origin).
 */
export const queryMonitorPluginWith = (opts: { corsOrigins?: string[] } = {}) => (app: Elysia) => {
  const corsOrigins = opts.corsOrigins ?? []
  // Match the db hook to the configured state at startup (env/dev default).
  applyQmHookState()
  return app
    .onRequest((c: any) => {
      // The Gateway plugin opens the entry for EVERY request when it is
      // registered (M1). It sets `capture` from the same enablement rules, so
      // there is nothing left to do here.
      if (c.qmEntry) return
      if (!qmEnabled()) return
      const path = new URL(c.request.url).pathname
      if (!qmPathEligible(path)) return
      const page = c.request.headers.get('x-tangen-page') ?? undefined
      const entry = qmBegin({ method: c.request.method, path, page: page?.slice(0, 300) })
      c.qmEntry = entry
      qmAls.enterWith(entry)
    })
    .onAfterHandle({ as: 'global' } as never, (c: any) => {
      // Headers must be set BEFORE the response is sent (finalize runs after).
      // The handler has completed here, so the query log is complete.
      const entry = c.qmEntry as RequestEntry | undefined
      if (!entry || !entry.capture) return
      // API-key callers only receive timing headers when their key opts in
      // (permissions.toolbar.enabled) - the production Tangen Toolbar gate.
      // Member (admin) requests keep the always-on dev behavior. No SQL ever
      // rides in headers either way.
      if (c.apiKeyId && (c.permissions as { toolbar?: { enabled?: boolean } } | undefined)?.toolbar?.enabled !== true) return
      const dbMs = Math.round(entry.queries.reduce((n, q) => n + q.durationMs, 0))
      const waitMs = Math.round(entry.queries.reduce((n, q) => n + (q.waitMs ?? 0), 0))
      const shapes = new Map<string, number>()
      for (const q of entry.queries) shapes.set(normalizeSql(q.sql), (shapes.get(normalizeSql(q.sql)) ?? 0) + 1)
      const dup = [...shapes.values()].reduce((n, c2) => n + (c2 > 1 ? c2 - 1 : 0), 0)
      c.set.headers['x-tangen-qm'] = `${entry.id};q=${entry.queries.length};db=${dbMs};dup=${dup}${waitMs > 0 ? `;wait=${waitMs}` : ''}`
      // db first (the Toolbar matches it), then qwait, the Gateway's own cost
      // (plan 29.4) and the filters that ran (K4.3): serverTimingFor is the one place.
      c.set.headers['server-timing'] = serverTimingFor(entry)
      // Cross-origin browsers hide Server-Timing detail without this.
      const origin = c.request.headers.get('origin')
      if (origin && (corsOrigins.length === 0 || corsOrigins.includes(origin))) {
        c.set.headers['timing-allow-origin'] = origin
      }
    })
    .onError({ as: 'global' } as never, (c: any) => {
      finalizeFromCtx(c)
    })
    .onAfterResponse({ as: 'global' } as never, (c: any) => {
      finalizeFromCtx(c)
    })
}
