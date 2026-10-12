/**
 * File Name: request-context.ts
 * Purpose: The per-request Gateway context - what it contains, where it is
 *   stored, and how it is opened and finished.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built on the AsyncLocalStorage Query Monitor already
 *   owns (`qmAls` in lib/query-monitor.ts) rather than a second one.
 *
 *   Why reuse it. A second ALS would mean two stores, two lifecycles and two
 *   places to rediscover the same lesson - that ALS does NOT survive the
 *   post-send setImmediate that runs onAfterResponse, so finalization has to
 *   read the entry off the Elysia context instead
 *   (plugins/query-monitor.ts:11-15). Query Monitor solved that once. Putting
 *   the Gateway context on the same RequestEntry means one store, one
 *   lifecycle, one solved problem, and one id shared between the access log and
 *   the query trace - so "which queries did request X run" is answerable
 *   without correlating two identifiers.
 *
 *   The entry is opened for EVERY request, including the ones Query Monitor
 *   does not watch. `entry.capture` carries that distinction, so "monitor off"
 *   still means zero recording and zero headers.
 *
 *   Request id: X-Tangen-Request-Id, not X-Request-Id. Every header this
 *   platform emits or reads is X-Tangen-* (X-Tangen-Qm, X-Tangen-Key,
 *   X-Tangen-Workspace, X-Tangen-Playground, X-Tangen-Transfer, X-Tangen-Page),
 *   and an unprefixed name would collide with whatever nginx, Cloudflare or an
 *   ALB sets - leaving "whose id is this?" ambiguous, which is the one thing a
 *   correlation id must not be. An INBOUND X-Request-Id is recorded as
 *   upstreamRequestId only when a trusted proxy is configured, for the same
 *   reason X-Forwarded-For is only read then: a caller that picks its own id
 *   picks which log lines it collides with - and even then only when it is
 *   shaped like an identifier (acceptUpstreamRequestId).
 *
 *   Correlation beyond the access log: the Gateway installs the request id as
 *   the logging context (setLogContext), so every log line written while a
 *   request runs carries `requestId`, the same value the client got in the
 *   header and, on a 500, in the INTERNAL body.
 */
import type { GatewayRequestContext } from '@tangen/types'
import { qmAls, type RequestEntry } from '../lib/query-monitor'
import { clientIp, getTrustedProxy } from '../lib/client-ip'
import { resolveRoutePolicy } from './route-policy'

/** The response header carrying the id. Decision D-13. */
export const REQUEST_ID_HEADER = 'X-Tangen-Request-Id'
/** The inbound header honoured only behind a trusted proxy. */
export const UPSTREAM_REQUEST_ID_HEADER = 'x-request-id'
/** What an upstream id may look like: an identifier, never a log line. */
export const UPSTREAM_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/

/**
 * The upstream request id to record, or null. Two explicit rules: the header
 * counts only behind a trusted proxy (a caller that picks its own id picks
 * which log lines it collides with), and only when it is shaped like an
 * identifier - printable, bounded, no whitespace or control characters, so
 * it cannot forge or split a log record.
 */
export function acceptUpstreamRequestId(raw: string | null | undefined, trustedProxy: boolean): string | null {
  if (!trustedProxy || raw === null || raw === undefined) return null
  const value = raw.trim()
  return UPSTREAM_REQUEST_ID.test(value) ? value : null
}

/**
 * Opens the Gateway context for one request.
 * @param opts - Request id (shared with the Query Monitor entry), the request,
 *               and the socket peer address when the runtime exposes one.
 * @returns A fresh context with the route policy resolved and no identity yet.
 */
export function beginGatewayContext(opts: {
  requestId: string
  request: Request
  method: string
  path: string
  socketAddress?: string | null
  startTime: number
}): GatewayRequestContext {
  const policy = resolveRoutePolicy(opts.method, opts.path)
  const trustedProxy = getTrustedProxy()
  const upstream = acceptUpstreamRequestId(opts.request.headers.get(UPSTREAM_REQUEST_ID_HEADER), trustedProxy?.enabled === true)
  return {
    requestId: opts.requestId,
    upstreamRequestId: upstream,
    startTime: opts.startTime,
    method: opts.method,
    path: opts.path,
    route: policy.id,
    routeCategory: policy.category,
    accessMode: policy.access,
    authMode: 'none',
    clientIp: clientIp(opts.request, trustedProxy, opts.socketAddress ?? null),
    origin: opts.request.headers.get('origin'),
    workspaceId: null,
    userId: null,
    apiKeyId: null,
    extensionId: null,
    rateLimit: null,
    limits: null,
    status: null,
    durationMs: null,
  }
}

/**
 * Adds the time since `startedAt` to the context's gateway cost. Each hook
 * calls it in a `finally`, so the figure is the sum of what the Gateway
 * itself did and nothing a handler did; rounding waits for the header.
 * @param ctx - The context, when one is open.
 * @param startedAt - performance.now() when the hook began.
 */
export function recordGatewayTime(ctx: GatewayRequestContext | undefined, startedAt: number): void {
  if (!ctx) return
  ctx.gatewayMs = (ctx.gatewayMs ?? 0) + (performance.now() - startedAt)
}

/** The Gateway context for the request currently executing, if one is open. */
export function currentGatewayContext(): GatewayRequestContext | undefined {
  return qmAls.getStore()?.gateway
}

/** The Gateway context stashed on an Elysia context, which survives the send. */
export function gatewayContextOf(c: unknown): GatewayRequestContext | undefined {
  return (c as { qmEntry?: RequestEntry } | undefined)?.qmEntry?.gateway
}

/**
 * Fills in what is only known once the response exists. Idempotent.
 * @param ctx - The context to finish.
 * @param info - Status plus whatever identity the chain resolved.
 */
export function finalizeGatewayContext(
  ctx: GatewayRequestContext | undefined,
  info: {
    status?: number | null
    workspaceId?: string | null
    userId?: string | null
    apiKeyId?: string | null
    siteUserId?: string | null
    extensionId?: string | null
    authMode?: GatewayRequestContext['authMode']
  },
): void {
  if (!ctx || ctx.durationMs !== null) return
  ctx.status = info.status ?? null
  ctx.durationMs = Math.round((performance.now() - ctx.startTime) * 100) / 100
  if (info.workspaceId) ctx.workspaceId = info.workspaceId
  if (info.userId) ctx.userId = info.userId
  if (info.apiKeyId) ctx.apiKeyId = info.apiKeyId
  if (info.siteUserId) ctx.siteUserId = info.siteUserId
  if (info.extensionId) ctx.extensionId = info.extensionId
  if (info.authMode) ctx.authMode = info.authMode
}
