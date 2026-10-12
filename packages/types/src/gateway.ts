/**
 * File Name: gateway.ts
 * Purpose: The shapes of the Tangen Core Gateway - the hierarchical policy
 *   config (global/deployment, workspace, environment), the route/surface
 *   policy, and the per-request context that carries the answer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Shapes only, no runtime behaviour beyond the one
 *   validation pass in defineGatewayConfig. They live in @tangen/types rather
 *   than @tangen/api so the CLI and the admin can read the same declarations
 *   the server enforces - the same reason storage, mcp and graphql configs live
 *   here.
 *
 *   Policy is HIERARCHICAL and is NOT resolved by object spreading:
 *   global -> workspace -> environment -> route, with a declared rule per
 *   field (see tasks/plan-gateway.md section 22 and gateway/resolve-config.ts).
 *   Keys marked OPERATOR-ONLY below describe the machine rather than a tenant;
 *   a workspace or environment config stating one is an error, not an override,
 *   because a tenant able to widen proxy trust or quieten the audit log would
 *   be a privilege escalation.
 */
import type { TrustedProxyConfig } from './config'

/** The three scopes policy resolves through, outermost first. */
export type PolicyScope = 'global' | 'workspace' | 'route'

/**
 * Request surfaces with distinct governance. Ten rather than five because the
 * code already has ten: `auth` and `ai` carry very different measured budgets,
 * and `extension` and `custom` are open-ended developer surfaces. Eleven with
 * `realtime` (R5 of tasks/plan-realtime.md): a ticket mint and a long-lived
 * connection are neither management traffic nor content reads, and their
 * budget is counted per identity rather than per request.
 */
export type SurfaceCategory =
  | 'content' | 'graphql' | 'forms' | 'delivery' | 'management'
  | 'auth' | 'media' | 'extension' | 'ai' | 'custom' | 'realtime'

/**
 * What the Gateway requires of a caller before the handler runs.
 *
 * Five modes, and the third exists because four could not tell the truth. A
 * refresh cookie, a login body, a webhook token in a URL, a porter transfer
 * token and a site key are all credentials the PLATFORM cannot check - only the
 * route can - and calling those routes `public` said the opposite of what they
 * do. `self-authenticating` says it plainly: the Gateway steps aside, and the
 * route is answerable for the check.
 */
export type AccessMode =
  /** No credential is resolved, ever. Requires a written `reason`. */
  | 'public'
  /** Resolve a credential if present; never reject for its absence. */
  | 'optional-auth'
  /**
   * The Gateway lets the request through and the ROUTE validates its own
   * token, session or key. Requires a written `reason` naming that credential.
   * A 401 or 403 from such a route is the route working, not the platform
   * disagreeing with the table.
   */
  | 'self-authenticating'
  /** A member session or an API key is required. */
  | 'authenticated'
  /** A member session plus a role gate. */
  | 'admin-internal'

/**
 * The modes ordered from most open to most restrictive. Narrowing reads this
 * and nothing else: a scope may move a route DOWN the list (toward restriction)
 * and never up.
 *
 * `self-authenticating` sits above `optional-auth` because it may reject a
 * caller for having nothing, which `optional-auth` promises never to do, and
 * below `authenticated` because the platform itself still resolves no identity.
 */
export const ACCESS_MODES_BY_RESTRICTION = [
  'public',
  'optional-auth',
  'self-authenticating',
  'authenticated',
  'admin-internal',
] as const satisfies readonly AccessMode[]

/**
 * What a SURFACE scope (workspace, environment) may floor a category's access
 * at: any route mode, or `closed` - the surface is switched off
 * (`apiExposure[category]: false`, plan 22.3) and no credential passes. It
 * is not an AccessMode because no route may declare it: a row says what it
 * needs, a scope says whether the surface exists at all.
 */
export type SurfaceAccess = AccessMode | 'closed'

/**
 * How restrictive a mode is, as a number the resolver can compare.
 * @param mode - The access mode, or the surface-only `closed`.
 * @returns Its position in ACCESS_MODES_BY_RESTRICTION; higher is stricter.
 *          `closed` ranks above every mode.
 */
export function accessModeRank(mode: SurfaceAccess): number {
  if (mode === 'closed') return ACCESS_MODES_BY_RESTRICTION.length
  return ACCESS_MODES_BY_RESTRICTION.indexOf(mode as (typeof ACCESS_MODES_BY_RESTRICTION)[number])
}

/** Which credential actually authenticated the request, once known. */
export type AuthMode = 'none' | 'member' | 'api-key' | 'site-key' | 'playground' | 'token'

/**
 * Identity buckets a rate limit may count against (plan section 27). `ip` and
 * `route` exist before any credential; the rest only once auth has run, so a
 * policy naming them counts nothing on a public route. `identity` is the
 * member OR the api key, whichever the request carries: a counter needs every
 * dimension it names, so a budget meant for "whoever is asking" cannot say
 * `['member', 'apiKey']` - that applies to nobody - and says this instead.
 */
export type RateLimitDimension = 'ip' | 'workspace' | 'apiKey' | 'member' | 'identity' | 'route' | 'extension'

/** What the Gateway decided about one request's budget, for headers and the access log. */
export interface RateLimitOutcome {
  /** The policy that answered - the tightest one when several composed. */
  policy: string
  limit: number
  remaining: number
  /** Unix seconds when the window resets. */
  resetAt: number
  /** The budget was exhausted. In observe mode the request still ran. */
  denied: boolean
  /** Whether a denial was enforced (429) or only observed. */
  mode: 'observe' | 'enforce'
}

export interface RateLimitPolicy {
  /** Window length in seconds. */
  window: number
  /** Requests permitted per window. */
  limit: number
  by?: RateLimitDimension[]
}

export interface RequestLimits {
  maxBodyBytes?: number
  maxUploadBytes?: number
  maxUploadMimeTypes?: string[]
  maxGraphqlDepth?: number
  /** The most rows one REST read may ask for. Clamped, never refused. */
  maxQueryLimit?: number
  /** The deepest relation expansion (?depth=) a REST read may ask for. Clamped, never refused. */
  maxRelationDepth?: number
}

/**
 * What a request limit refused, for the access log. Present on the context
 * ONLY when a cap bit; a request that fit carries null, the way a request no
 * budget applied to carries no rate-limit outcome.
 */
export interface RequestLimitOutcome {
  /** The requestLimits key that refused, or (via 'clamp') the one that clamped. */
  limit: 'maxBodyBytes' | 'maxUploadBytes' | 'maxUploadMimeTypes' | 'maxGraphqlDepth' | 'maxQueryLimit' | 'maxRelationDepth'
  /** The resolved ceiling: bytes, levels, rows, or the allow-list. */
  allowed: number | string[]
  /** What the request carried: a declared length, bytes seen before the cut, the MIME type, a depth, or a row count. */
  observed: number | string
  /**
   * Where it was seen: the Content-Length header, the bounded body reader,
   * the upload's own check, the GraphQL depth measured before validation, or
   * a REST read parameter that was clamped rather than refused.
   */
  via: 'content-length' | 'stream' | 'upload' | 'graphql' | 'clamp'
}

export interface GatewayCorsConfig {
  /** Origins allowed on credentialed surfaces. Narrows by SUBSET only. */
  origins?: string[]
  /** Forced false whenever the effective origin set contains '*'. */
  credentials?: boolean
  /** Origins allowed on PUBLIC surfaces (delivery, embeds, assets). */
  publicOrigins?: string[] | '*'
  /** OPERATOR-ONLY. May any workspace declare '*' publicOrigins at all. */
  allowWildcardPublicOrigins?: boolean
  /** OPERATOR-ONLY. Headers a browser may read off a response. */
  exposeHeaders?: string[]
}

export interface GatewayRateLimitConfig {
  enabled?: boolean
  default?: RateLimitPolicy
  policies?: Partial<Record<SurfaceCategory, RateLimitPolicy>>
  /** OPERATOR-ONLY. Where counters live. */
  store?: 'auto' | 'memory' | 'redis' | 'postgres'
  /** OPERATOR-ONLY. Whether a store outage lets traffic through. */
  failOpen?: boolean
}

export interface GatewayLoggingConfig {
  /** OPERATOR sets the FLOOR; a lower scope may only raise verbosity. */
  requests?: boolean | 'errors-only'
  /** Header names to include in the access log. Subset of the operator list. */
  includeHeaders?: string[]
  /** OPERATOR-ONLY. Names always redacted. A lower scope may only ADD names. */
  redact?: string[]
  /** 0..1. A lower scope may only sample MORE. */
  sampleRate?: number
}

/**
 * Realtime ceilings (tasks/plan-realtime.md 4.6, the Gateway half). Scopes
 * G W E, narrow-min like requestLimits: a workspace may ask for fewer
 * connections than the deployment allows, never more. Connections are
 * counted in the rate-limit store, so the numbers hold across processes;
 * the hub's own per-process ceiling stays above all of this.
 */
export interface GatewayRealtimeConfig {
  /** Open connections for one workspace in one environment, across every process. */
  maxConnections?: number
  /** Open connections for one identity (member or api key) in one workspace. */
  maxConnectionsPerIdentity?: number
  /** Inbound protocol messages one connection may send per minute. */
  maxMessagesPerMinute?: number
}

export interface GatewayObservabilityConfig {
  serverTiming?: boolean
  /** OPERATOR-ONLY. Default 'X-Tangen-Request-Id'; false disables the header. */
  requestIdHeader?: false | string
}

/**
 * One scope's worth of Gateway policy. The same shape is authored at global,
 * workspace and environment scope; what differs is which keys are legal there.
 */
export interface GatewayConfig {
  rateLimit?: GatewayRateLimitConfig
  cors?: GatewayCorsConfig
  requestLimits?: RequestLimits
  /** OPERATOR-ONLY. Who sits in front of the process. */
  trustedProxy?: TrustedProxyConfig
  logging?: GatewayLoggingConfig
  observability?: GatewayObservabilityConfig
  /** Which surfaces this scope exposes at all. Restrictive-wins. */
  apiExposure?: Partial<Record<SurfaceCategory, boolean>>
  /** Realtime connection and message ceilings. Narrow-min. */
  realtime?: GatewayRealtimeConfig
}

/** Keys no workspace or environment scope may state. Enforced by the resolver. */
export const OPERATOR_ONLY_KEYS = [
  'trustedProxy',
  'rateLimit.store',
  'rateLimit.failOpen',
  'cors.allowWildcardPublicOrigins',
  'cors.exposeHeaders',
  'logging.redact',
  'observability.requestIdHeader',
] as const

export type OperatorOnlyKey = (typeof OPERATOR_ONLY_KEYS)[number]

/** How a route's CORS posture is chosen. */
export type RouteCorsMode = 'default' | 'public' | 'none'

/**
 * The narrowest scope: what one route or surface declares about itself. A
 * route may only ever be MORE restrictive than the environment above it.
 */
export interface RoutePolicy {
  /** Stable id, used in logs and in future per-workspace overrides. */
  id: string
  match: { method: string; path: string; exact?: boolean }
  access: AccessMode
  category: SurfaceCategory
  /**
   * MANDATORY when `access` is 'public' or 'self-authenticating' - the two
   * modes where the Gateway checks nothing. Enforced by defineRoutePolicy.
   * A public row must say why it is open; a self-authenticating row must name
   * the credential the route checks instead.
   */
  reason?: string
  /**
   * Where this route's credential lives when it is NOT a header.
   *
   * A WebSocket upgrade and an EventSource carry no headers a browser can
   * set, so the realtime routes take a single-use ticket in the query string.
   * The policy observer reads this: without it, every legitimate connection
   * was reported as an anonymous success, and an error that fires on every
   * success trains the reader to ignore the one it exists to raise.
   *
   * Declared per route, so a query name is a credential only where the table
   * says it is: `?ticket=` on an object route launders nothing.
   */
  credential?: {
    query?: string[]
    /** The credential is the request body (a login, a registration, an OTP): the platform cannot observe it, the route verifies it. */
    body?: boolean
    /** The credential is a cookie the route verifies (a refresh token); `cookie` is deliberately not a credential header. */
    cookie?: boolean
    /** The credential is a signed token in the path (a per-flow webhook URL). */
    path?: boolean
  }
  rateLimit?: RateLimitPolicy | 'inherit' | 'none'
  cors?: RouteCorsMode
  cache?: 'no-store' | 'revalidate' | 'immutable'
  /** Narrows the resolved limits for this surface; never widens them. */
  requestLimits?: RequestLimits
  /**
   * Which byte ceiling this surface's body is measured against. Default
   * maxBodyBytes (a JSON body); a surface that carries FILES - the media
   * upload, a Porter package - names maxUploadBytes.
   */
  bodyLimit?: 'maxBodyBytes' | 'maxUploadBytes'
  workspace?: 'required' | 'optional' | 'none'
  env?: 'required' | 'optional' | 'none'
  logging?: 'full' | 'errors-only' | 'none'
}

/**
 * Everything the Gateway knows about one in-flight request. Carried on the
 * AsyncLocalStorage that Query Monitor already owns, so there is one store and
 * one lifecycle rather than two.
 *
 * NEVER add to this: raw tokens, key hashes, passwords, Authorization or Cookie
 * values, request or response bodies, SQL parameter values, or email addresses.
 */
export interface GatewayRequestContext {
  requestId: string
  /** An upstream id, accepted ONLY from a trusted proxy. */
  upstreamRequestId: string | null
  /** performance.now() at the start of the request. */
  startTime: number
  method: string
  path: string
  /** The matched RoutePolicy id, or null when nothing matched. */
  route: string | null
  routeCategory: SurfaceCategory
  accessMode: AccessMode
  authMode: AuthMode
  clientIp: string | null
  origin: string | null
  workspaceId: string | null
  userId: string | null
  apiKeyId: string | null
  /**
   * The site member behind a `site-key` request (the site key plus the site
   * session on the realtime ticket route): an auth_users id, never the email.
   * Present only when `authMode` is `site-key`.
   */
  siteUserId?: string | null
  extensionId: string | null
  /** The rate-limit decision, once a limited route has been evaluated. */
  rateLimit: RateLimitOutcome | null
  /** The request limit that refused, when one did. */
  limits: RequestLimitOutcome | null
  status: number | null
  durationMs: number | null
  /**
   * The Gateway's own cost on this request, ms: policy resolution, CORS, the
   * body cap and the rate-limit check, accumulated hook by hook. Written to
   * Server-Timing as `gateway;dur=` (plan 29.4). Optional because it is
   * measured, not resolved: a context a test builds by hand need not carry it.
   */
  gatewayMs?: number
}

/**
 * Identity helper for a Gateway config block, matching every other define*
 * in this package - plus the one runtime check argued for in the plan (D-9),
 * because these three mistakes are silent at every other layer.
 * @param config - The block to declare.
 * @returns The same object.
 * @throws When a limit is zero, a window is not positive, or a wildcard origin
 *         is paired with credentials.
 */
export function defineGatewayConfig(config: GatewayConfig): GatewayConfig {
  const policies: Array<[string, RateLimitPolicy | undefined]> = [
    ['rateLimit.default', config.rateLimit?.default],
    ...Object.entries(config.rateLimit?.policies ?? {}).map(
      ([k, v]) => [`rateLimit.policies.${k}`, v] as [string, RateLimitPolicy | undefined],
    ),
  ]
  for (const [key, policy] of policies) {
    if (!policy) continue
    if (!(policy.limit > 0)) throw new Error(`gateway: ${key}.limit must be greater than 0 (got ${policy.limit})`)
    if (!(policy.window > 0)) throw new Error(`gateway: ${key}.window must be a positive number of seconds (got ${policy.window})`)
  }
  const limits = config.requestLimits ?? {}
  for (const key of ['maxBodyBytes', 'maxUploadBytes', 'maxGraphqlDepth', 'maxQueryLimit', 'maxRelationDepth'] as const) {
    const value = limits[key]
    if (value !== undefined && !(value > 0)) {
      throw new Error(`gateway: requestLimits.${key} must be greater than 0 (got ${value})`)
    }
  }
  const realtime = config.realtime ?? {}
  for (const key of ['maxConnections', 'maxConnectionsPerIdentity', 'maxMessagesPerMinute'] as const) {
    const value = realtime[key]
    if (value !== undefined && !(value > 0)) {
      throw new Error(`gateway: realtime.${key} must be greater than 0 (got ${value})`)
    }
  }
  if (config.cors?.origins?.includes('*') && config.cors?.credentials === true) {
    throw new Error(
      "gateway: cors.origins ['*'] cannot be combined with cors.credentials true - " +
      'every browser rejects that pair, so the response would be unusable. Declare explicit origins.',
    )
  }
  return config
}

/**
 * Identity helper for a route policy, with the one rule the table exists to
 * enforce: a route the Gateway does not authenticate must say WHY.
 * @param policy - The route policy.
 * @returns The same object.
 * @throws When access is 'public' or 'self-authenticating' and no reason is given.
 */
export function defineRoutePolicy(policy: RoutePolicy): RoutePolicy {
  if (policy.access === 'public' && !policy.reason?.trim()) {
    throw new Error(
      `gateway: route policy '${policy.id}' is public and must carry a reason. ` +
      'A reviewer reading the table has to see not just that a route is open but why.',
    )
  }
  if (policy.access === 'self-authenticating' && !policy.reason?.trim()) {
    throw new Error(
      `gateway: route policy '${policy.id}' is self-authenticating and must carry a reason ` +
      'naming the credential the route checks for itself. Without it the row is ' +
      'indistinguishable from a route that checks nothing.',
    )
  }
  return policy
}
