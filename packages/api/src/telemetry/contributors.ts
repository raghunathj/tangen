/**
 * File Name: contributors.ts
 * Purpose: The translations from what Tangen already observes into telemetry
 *          events (closure plan Phase 9C, Units 12, 13, 15, 16, 17 and 18).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every one of these reads an EXISTING boundary - the
 *          Gateway's finished request, the Phase 6A query observer, the Phase
 *          9B Flow event seam, the platform event bus. Nothing here wraps a
 *          repository function, opens a hook or instruments the database a
 *          second time; if there was no boundary already, the contributor was
 *          not written.
 */
import { emitTelemetry } from './bus'
import { observeQueries, type QueryFacts } from '../services/query-observer'
import type { GatewayRequestContext } from '@tangen/types'
import type { TelemetryEventInput } from './contract'

/** Milliseconds at or beyond which a content read is called slow. */
export const SLOW_QUERY_MS = 200

/** `2xx`, `4xx`, `5xx` - a CLASS, because the code is the high-cardinality part. */
const statusClass = (status: number | null): string => (status === null ? 'none' : `${Math.floor(status / 100)}xx`)

/**
 * One finished request.
 *
 * Deliberately absent: the path, the query string, the body, any header. The
 * ROUTE TEMPLATE goes on the event (`/api/v1/objects/:type`) and only the
 * status CLASS becomes a metric label, so a million object ids cannot become a
 * million series.
 */
export function requestEvent(ctx: GatewayRequestContext): TelemetryEventInput {
  const failed = ctx.status === null || ctx.status >= 500
  return {
    name: 'http.request.completed',
    severity: failed ? 'error' : ctx.status !== null && ctx.status >= 400 ? 'warn' : 'info',
    status: ctx.status !== null && ctx.status < 400 ? 'ok' : 'failed',
    durationMs: ctx.durationMs ?? undefined,
    requestId: ctx.requestId,
    workspaceId: ctx.workspaceId ?? undefined,
    attributes: {
      method: ctx.method,
      // The template, never the path. `route` is absent on a route the table
      // does not describe, and an absent attribute beats a raw URL.
      ...(ctx.route ? { route: ctx.route } : {}),
      statusClass: statusClass(ctx.status),
      ...(ctx.status !== null ? { status: ctx.status } : {}),
      ...(ctx.routeCategory ? { policy: ctx.routeCategory } : {}),
    },
  }
}

/**
 * One content read, from the Phase 6A seam. That seam already refuses to carry
 * a value, a filter, SQL or a message - it hands over shape facts and an error
 * CODE - which is exactly why telemetry consumes it instead of tapping the
 * database a second time.
 */
export function queryEvent(facts: QueryFacts): TelemetryEventInput {
  return {
    name: 'db.query.completed',
    severity: facts.ok ? 'info' : 'error',
    status: facts.ok ? 'ok' : 'failed',
    durationMs: facts.durationMs,
    requestId: facts.requestId ?? undefined,
    workspaceId: facts.workspaceId,
    attributes: {
      type: facts.type,
      operation: facts.operation,
      rows: facts.rows,
      depth: facts.depth,
      slow: facts.durationMs >= SLOW_QUERY_MS,
      ...(facts.total !== null ? { total: facts.total } : {}),
      ...(facts.cache ? { cache: facts.cache } : {}),
      ...(facts.statements !== null ? { statements: facts.statements } : {}),
      ...(facts.errorCode ? { errorCode: facts.errorCode } : {}),
    },
  }
}

/** Subscribes telemetry to the query seam. Returns the unsubscribe. */
export function contributeQueries(): () => void {
  return observeQueries((facts) => emitTelemetry(queryEvent(facts)))
}

/**
 * A platform event that carries operational meaning, translated.
 *
 * Only a handful are worth a telemetry event; the rest of the bus is domain
 * traffic that already has a durable home. Flows' own events (Phase 9B) arrive
 * namespaced as `ext:flows:*` and carry ids and codes only - never node input
 * or output - so they can be forwarded as they are.
 */
export function platformEvent(type: string, payload: Record<string, unknown>): TelemetryEventInput | null {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const scope = { workspaceId: str(payload.workspaceId) }

  switch (type) {
    case 'ext:flows:execution.succeeded':
    case 'ext:flows:execution.failed': {
      const failed = type.endsWith('failed')
      return {
        name: 'flow.execution.completed',
        severity: failed ? 'error' : 'info',
        status: failed ? 'failed' : 'ok',
        durationMs: num(payload.ms),
        operationId: str(payload.executionId),
        ...scope,
        attributes: {
          ...(str(payload.flowId) ? { flowId: str(payload.flowId)! } : {}),
          ...(str(payload.nodeId) ? { nodeId: str(payload.nodeId)! } : {}),
          ...(num(payload.attempt) !== undefined ? { attempt: num(payload.attempt)! } : {}),
          result: failed ? 'failed' : 'succeeded',
          ...(str(payload.code) ? { errorCode: str(payload.code)! } : {}),
        },
      }
    }
    case 'ext:flows:node.retry_scheduled':
      return {
        name: 'flow.node.retry_scheduled',
        severity: 'warn',
        operationId: str(payload.executionId),
        ...scope,
        attributes: {
          ...(str(payload.flowId) ? { flowId: str(payload.flowId)! } : {}),
          ...(str(payload.nodeId) ? { nodeId: str(payload.nodeId)! } : {}),
          ...(num(payload.attempt) !== undefined ? { attempt: num(payload.attempt)! } : {}),
          ...(str(payload.code) ? { errorCode: str(payload.code)! } : {}),
        },
      }
    case 'release.applied':
    case 'release.failed': {
      const failed = type.endsWith('failed')
      return {
        name: 'release.apply.completed',
        severity: failed ? 'error' : 'info',
        status: failed ? 'failed' : 'ok',
        operationId: str(payload.releaseId),
        ...scope,
        attributes: {
          ...(str(payload.releaseId) ? { releaseId: str(payload.releaseId)! } : {}),
          result: failed ? 'failed' : 'applied',
          ...(num(payload.items) !== undefined ? { items: num(payload.items)! } : {}),
        },
      }
    }
    default:
      return null
  }
}

/** Subscribes telemetry to the platform bus. Returns the unsubscribe. */
export function contributePlatformEvents(bus: { on(type: '*', handler: (e: unknown) => void): () => void }): () => void {
  return bus.on('*', (raw) => {
    const e = raw as { type?: unknown; payload?: unknown }
    if (typeof e?.type !== 'string') return
    const event = platformEvent(e.type, (e.payload ?? {}) as Record<string, unknown>)
    if (event) emitTelemetry(event)
  })
}
