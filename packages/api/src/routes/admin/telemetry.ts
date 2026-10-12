/**
 * File Name: telemetry.ts
 * Purpose: What the Admin reads from the telemetry ring and the metric
 *          aggregate (closure plan Phase 9C, Units 29, 30, 33 and 34).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Owner and admin only - the same gate the Query Monitor
 *          and the API Playground use, because operational history says things
 *          about an installation that an editor has no business reading. That
 *          gate is a PERMISSION and is separate from whether the telemetry
 *          capability is on, which the routes report rather than enforce.
 *
 *          Every read is scoped to the caller's workspace AND environment. A
 *          request without both reads the unscoped ring, never everybody's.
 */
import { Elysia } from 'elysia'
import { RequestError } from '../../lib/errors'
import { queryEvents, ringScopes, clearRing, RING_CAPACITY } from '../../telemetry/ring'
import { metricsSnapshot } from '../../telemetry/metrics'
import { droppedCounts } from '../../telemetry/bus'
import { telemetryEnabled, telemetryCollecting, sampledOutCount } from '../../telemetry/collector'
import { TELEMETRY_EVENTS } from '../../telemetry/contract'

function requireAdminRole(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
  const role = String(ctx.memberRole ?? '')
  if (role !== 'owner' && role !== 'admin' && role !== 'superadmin') {
    throw new RequestError('FORBIDDEN', 'Telemetry is available to owners and admins only', 403)
  }
}

/** The scope a request reads: its workspace, or nothing. */
const scopeOf = (ctx: any) => ({
  workspaceId: ctx.workspaceId ? String(ctx.workspaceId) : undefined,
})

/**
 * A FUNCTION over the app, not a module-scope `new Elysia()`: routes mount
 * when the composer composes them, never as a side effect of an import
 * (the Phase 7 framework boundary, which caught this).
 */
export const telemetryRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/telemetry/overview', async (ctx: any) => {
      requireAdminRole(ctx)
      const scope = scopeOf(ctx)
      const metrics = metricsSnapshot(scope)
      const ring = queryEvents({ ...scope, limit: 1 })
      return {
        data: {
          // The capability's own state, so the Admin can say "off" rather than
          // "empty" - two different things (Phase 8B).
          enabled: telemetryEnabled(),
          collecting: telemetryCollecting(),
          since: metrics.since,
          series: metrics.series,
          ring: { capacity: RING_CAPACITY, kept: ring.kept, written: ring.written },
          // Loss, made visible rather than emitted back through the same path.
          dropped: droppedCounts(),
          sampledOut: sampledOutCount(),
          scopes: ringScopes().length,
        },
      }
    })

    .get('/api/v1/admin/telemetry/events', async (ctx: any) => {
      requireAdminRole(ctx)
      const q = ctx.query ?? {}
      const names = typeof q.name === 'string' && q.name
        ? q.name.split(',').filter((n: string) => (TELEMETRY_EVENTS as readonly string[]).includes(n))
        : undefined
      const page = queryEvents({
        ...scopeOf(ctx),
        names,
        severity: q.severity === 'error' || q.severity === 'warn' || q.severity === 'info' ? q.severity : undefined,
        status: q.status === 'ok' || q.status === 'failed' ? q.status : undefined,
        requestId: typeof q.requestId === 'string' && q.requestId ? q.requestId : undefined,
        operationId: typeof q.operationId === 'string' && q.operationId ? q.operationId : undefined,
        since: Number.isFinite(Number(q.since)) && Number(q.since) > 0 ? Number(q.since) : undefined,
        limit: Number(q.limit) || 100,
      })
      return {
        data: page.events,
        meta: {
          kept: page.kept, written: page.written, filtered: page.filtered,
          capacity: RING_CAPACITY, enabled: telemetryEnabled(), collecting: telemetryCollecting(),
        },
      }
    })

    .delete('/api/v1/admin/telemetry/events', async (ctx: any) => {
      requireAdminRole(ctx)
      clearRing(scopeOf(ctx))
      return { data: { cleared: true } }
    })
