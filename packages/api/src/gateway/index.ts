/**
 * File Name: index.ts
 * Purpose: The Tangen Core Gateway plugin - one Elysia registration that opens
 *   a request context, stamps a request id, resolves the route policy, and
 *   writes the access log.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is M1 of tasks/plan-gateway.md and it is
 *   DELIBERATELY INERT. It decides nothing. It does not authenticate, reject,
 *   redirect, rate limit, cap a body or touch a CORS header. The route policy
 *   it resolves is recorded in the context and in the log and then ignored -
 *   middleware/auth.ts still owns access by path prefix until M3. The only
 *   observable changes are one response header and some log lines.
 *
 *   Registered FIRST in the chain so its onRequest precedes everything, and
 *   before the Query Monitor plugin because it opens the shared RequestEntry
 *   the monitor would otherwise open for itself. Nothing else about middleware
 *   order changes.
 */
import { Elysia } from 'elysia'
import { qmAls, qmBegin, qmEnabled, qmPathEligible, type RequestEntry } from '../lib/query-monitor'
import { socketAddressOf } from '../lib/client-ip'
import { readWriteOrigin } from '../lib/write-origin'
import { setLogContext } from '@tangen/logging'
import { beginGatewayContext, finalizeGatewayContext, gatewayContextOf, recordGatewayTime, currentGatewayContext, REQUEST_ID_HEADER } from './request-context'
import { logAccess, shouldLogRequest } from './logging'
import { observePolicy } from './policy-observer'
import { emitTelemetry } from '../telemetry/bus'
import { requestEvent } from '../telemetry/contributors'
import { GATEWAY_DEFAULTS } from './resolve-config'

export { REQUEST_ID_HEADER, currentGatewayContext, gatewayContextOf, recordGatewayTime } from './request-context'
export {
  ROUTE_POLICIES, FALLBACK_POLICY, resolveRoutePolicy,
  publicRoutePolicies, selfAuthenticatingRoutePolicies,
} from './route-policy'
export {
  registerRoutePolicy, clearDynamicRoutePolicies, dynamicRoutePolicies,
  resolveDynamicRoutePolicy,
} from './dynamic-policies'
export { resolveGatewayPolicy, GATEWAY_DEFAULTS, GatewayCeilingError } from './resolve-config'
export {
  gatewayCors, decideCors, effectiveCors, resetCorsCache, resolveRequestWorkspace,
  cachedDomainLookup, resolveCorsMode, applyCorsHeaders, corsDivergenceCounts, resetCorsDivergenceCounters,
} from './cors'
export type { CorsMode, CorsDecision, EffectiveCors, DomainLookup, GatewayCorsOptions } from './cors'
export { effectiveGatewayPolicy, deploymentGatewayPolicy, resetEffectivePolicyCache } from './effective-policy'
export {
  gatewayRequestLimits, effectiveRequestLimits, narrowByRoute, bodyCapFor, boundedBody, isAllowedMimeType,
  recordLimitRefusal, formatBytes, limitRefusalCounts, resetLimitRefusalCounters,
} from './request-limits'
export { gatewayMonitorSnapshot, dimensionsOfPolicy } from './monitor'
export type { GatewayMonitorSnapshot } from './monitor'
export type { GatewayRequestLimitsOptions, ResolvedRequestLimits, BodyCapKey } from './request-limits'
export { graphqlDepthCeiling, effectiveGraphqlDepth, assertGraphqlDepth } from './graphql-depth'
export {
  gatewaySurfaceExposure, surfaceAccessFor, refuseClosedSurface, refuseClosedSurfaceForCredential,
  assertPublicRowsExposed, exposureRefusalCounts, resetExposureRefusalCounters,
} from './surface-exposure'
export type { GatewaySurfaceExposureOptions } from './surface-exposure'
export { clampRead, readLimitsFor } from './read-limits'
export {
  connectionLogRecord, connectionLogLine, logConnectionClosed, connectionCounts, countConnectionOpened, resetConnectionCounts,
} from './connection-log'
export {
  realtimeHubGate, installRealtimeLimits, realtimeConnectionClosed, resetRealtimeLimits, realtimeLimitsFor,
  connectionGaugeKeys, REALTIME_MESSAGE_POLICY_ID, CLOSE_RATE_LIMITED, CONNECTION_GAUGE_TTL_SECONDS,
  REALTIME_PRESENCE_POLICY_ID, PRESENCE_MESSAGES_PER_MINUTE, presenceBudgetKey, presenceLimitFor,
} from './realtime-limits'
export type { RealtimeLimitsOptions, RealtimeGate, GateIdentity, GateConnection, PresenceGateConnection, PresenceGateAction, PresenceGateDecision } from './realtime-limits'
export type { ConnectionClosed } from './connection-log'
export type { ReadClamp, ReadParams } from './read-limits'
export {
  gatewayRateLimit, evaluateRateLimit, outcomeOf, observeRateLimit, rateLimitCounts, resetRateLimitCounters,
} from './rate-limit'
export type { GatewayRateLimitOptions, RateLimitObservation } from './rate-limit'
export { CATEGORY_DEFAULTS, policiesFor, counterKey, identityFor, isPreAuthPolicy } from './rate-limit/policy'
export type { NamedRateLimitPolicy } from './rate-limit/policy'
export {
  resolveRateLimitStore, memoryStore, redisStore, postgresStore, pruneRateLimitCounters, hitOrOpen, adjustOrOpen,
  storeFailureCount, resetStoreFailureCount, activeRateLimitStore, setActiveRateLimitStore,
} from './rate-limit/store'
export { attemptLimiter } from './rate-limit/attempts'
export type { AttemptBudget, AttemptLimiter, AttemptState } from './rate-limit/attempts'
export type { RateLimitStore, RateLimitStoreKind, WindowState } from './rate-limit/store'
export {
  observePolicy, detectPolicyMismatch, logPolicyMismatch, requestCarriedCredential,
  policyMismatchCounts, resetPolicyMismatchCounters,
} from './policy-observer'
export type { PolicyMismatch, PolicyMismatchKind } from './policy-observer'
export {
  OPERATOR_ONLY_PATHS, OperatorOnlyKeyError,
  findOperatorOnlyOverride, assertNoOperatorOnlyOverrides,
} from './operator-only'

export interface GatewayPluginOptions {
  /**
   * Access-log verbosity. Defaults to the deployment floor ('errors-only'),
   * raised to full by TANGEN_ACCESS_LOG=1 and silenced by TANGEN_ACCESS_LOG=0.
   * A tenant cannot lower it; that is the operator's floor (plan section 22.3).
   */
  logRequests?: boolean | 'errors-only'
  /** Header names to include in the log. Credential headers are always refused. */
  includeHeaders?: string[]
}

/**
 * The status this request actually answered with.
 *
 * Several sources, in this order, because no single one is right everywhere.
 * Inside onError, `set.status` is not yet the status the caller will see - the
 * error has not been mapped - so the error itself is asked first. A route
 * returning a raw Response (delivery does) never touches `set.status` either,
 * so the Response is asked next. Only then is `set.status` believed. Reading
 * `set.status` alone logs every 404 as a success, which would make the access
 * log lie about exactly the requests worth reading it for.
 *
 * `AuthError` and `RequestError` are asked BY NAME because `middleware/error.ts`
 * maps them in its own onError, which is registered AFTER this one and so runs
 * later. Found on the running server: an unauthenticated request reached the
 * access log as a 500 when the caller had received a 401. That is not just an
 * untidy log line - M2's primary signal is "the table said public and the
 * request came back 401", so a 401 recorded as 500 would have made the whole
 * mismatch mechanism silent on the case it exists to catch.
 * @param c - The Elysia context in onError or onAfterResponse.
 * @returns The status, or null when none can be determined.
 */
function statusOf(c: any): number | null {
  const error = c?.error
  // A parse failure CAUSED by a RequestError - the bounded body reader's 413
  // (M6) - reports the cause. Elysia wraps whatever the body stream threw in
  // a 400 ParseError and keeps the original as `cause`; the wrapper is not
  // the answer the caller receives, so it must not be the one logged.
  const cause = (error as { cause?: unknown } | undefined)?.cause
  if (cause instanceof Error && cause.name === 'RequestError') {
    const declared = (cause as { statusCode?: unknown }).statusCode
    if (typeof declared === 'number') return declared
  }
  const errorStatus = (error as { status?: unknown } | undefined)?.status
  if (typeof errorStatus === 'number') return errorStatus
  if (error instanceof Error) {
    if (error.name === 'AuthError') return 401
    const declared = (error as { statusCode?: unknown }).statusCode
    if (error.name === 'RequestError' && typeof declared === 'number') return declared
  }
  if (c?.code === 'NOT_FOUND') return 404
  if (c?.code === 'VALIDATION') return 422
  if (c?.response instanceof Response) return c.response.status
  if (typeof c?.set?.status === 'number') return c.set.status
  return null
}

function resolveLogMode(explicit: boolean | 'errors-only' | undefined): boolean | 'errors-only' {
  if (explicit !== undefined) return explicit
  const env = process.env.TANGEN_ACCESS_LOG
  if (env === '1') return true
  if (env === '0') return false
  return GATEWAY_DEFAULTS.logging.requests
}

/**
 * The Gateway, as one Elysia plugin.
 * @param opts - Access-log settings; everything else is not yet configurable.
 * @returns An Elysia plugin to register first in the chain.
 */
export const gatewayPlugin = (opts: GatewayPluginOptions = {}) => (app: Elysia) => {
  // Every log line written while a request runs carries its id (Unit 2 of
  // the Phase 2 closure): the same value as the response header and the
  // INTERNAL body, so a client report and a log line meet on one string.
  setLogContext(() => {
    const ctx = currentGatewayContext()
    return ctx ? { requestId: ctx.requestId } : undefined
  })
  const logMode = resolveLogMode(opts.logRequests)
  const includeHeaders = opts.includeHeaders ?? []

  const finish = (c: any) => {
    const ctx = gatewayContextOf(c)
    if (!ctx || ctx.durationMs !== null) return
    finalizeGatewayContext(ctx, {
      status: statusOf(c),
      workspaceId: c.workspaceId ?? null,
      userId: c.memberId ?? null,
      apiKeyId: c.apiKeyId ?? null,
      siteUserId: c.siteUserId ?? null,
      // Populated by the auth chain at M3; recorded here when it already is.
      // A site-auth member on the ticket route is the key's identity with the
      // member named (realtime/site-auth.ts): `site-key`, not `api-key`.
      authMode: c.siteUserId && c.apiKeyId ? 'site-key' : c.apiKeyId ? 'api-key' : c.memberId ? 'member' : undefined,
    })
    if (shouldLogRequest(logMode, ctx.status)) {
      logAccess(ctx, { headers: c.request?.headers, includeHeaders })
    }
    // One telemetry event per finished request (Phase 9C, Unit 12), from the
    // context that already exists. Costs a Set size check when telemetry is
    // off, and can never throw - the bus contains its own subscribers.
    emitTelemetry(requestEvent(ctx))
    // M2. Does the table's answer match what auth actually did? Reported, never
    // acted on - and reported independently of the access-log verbosity,
    // because a disagreement is worth knowing even when the log is quiet.
    observePolicy(ctx, c.request?.headers, c.request?.url)
  }

  return app
    .onRequest((c: any) => {
      const t0 = performance.now()
      const url = new URL(c.request.url)
      const path = url.pathname
      const page = c.request.headers.get('x-tangen-page') ?? undefined
      // One entry, one id, one AsyncLocalStorage - shared with Query Monitor.
      const entry: RequestEntry = qmBegin({ method: c.request.method, path, page: page?.slice(0, 300) })
      // "Monitor off" must still mean zero recording, so the entry exists for
      // the Gateway while capture stays false for the monitor.
      entry.capture = qmEnabled() && qmPathEligible(path)
      entry.gateway = beginGatewayContext({
        requestId: entry.id,
        request: c.request,
        method: c.request.method,
        path,
        socketAddress: socketAddressOf(c),
        startTime: entry.startedAt,
      })
      // Which client connection issued this write, so the realtime envelopes
      // it causes can name it (lib/write-origin.ts). Advisory, unauthenticated,
      // shaped rather than trusted.
      entry.writeOrigin = readWriteOrigin(c.request.headers)
      c.qmEntry = entry
      qmAls.enterWith(entry)
      // Set here rather than in onAfterHandle so a route returning a raw
      // Response (delivery) and an error path both carry the id.
      c.set.headers[REQUEST_ID_HEADER.toLowerCase()] = entry.id
      // Policy resolution is the first Gateway cost on the request (29.4).
      recordGatewayTime(entry.gateway, t0)
    })
    .onError({ as: 'global' } as never, (c: any) => { finish(c) })
    .onAfterResponse({ as: 'global' } as never, (c: any) => { finish(c) })
}
