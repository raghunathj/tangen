/**
 * File Name: resolve-config.ts
 * Purpose: Resolves the four policy scopes - global/deployment, workspace,
 *   environment, route - into one effective policy, with a declared rule per
 *   field and a hard ceiling that only ever narrows downward.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure over @tangen/types shapes; no I/O, no Elysia.
 *
 *   Why this is not `{ ...global, ...workspace, ...env, ...route }`. Object
 *   spreading resolves every field the same way - last writer wins - which is
 *   correct for a cache hint and catastrophic for a body cap. The whole point
 *   of the hierarchy is that a lower scope may narrow a limit and may not widen
 *   one, and spreading cannot express the difference. Each field below names
 *   its rule: narrowMin, narrowRate, subsetOf, restrictiveWins, permissiveWins,
 *   or operator-only.
 *
 *   Breach handling is fixed, not configurable, because a configurable failure
 *   mode for a security ceiling is another ceiling that can be widened:
 *     - AUTHORED (a workspace.config.ts a human wrote) -> THROW at boot,
 *       naming scope, key, requested and allowed. Cheap to fix, loud to ignore.
 *     - RUNTIME (an extension manifest, a future UI edit) -> CLAMP and report.
 *       A third-party manifest must not be able to stop the server.
 *
 *   Built at M1 observe-only, so the semantics were settled before any field
 *   was migrated onto it, then adopted field by field: M4 CORS, M5 rate
 *   limits, M6 request limits, and the surface `access` floor
 *   (apiExposure, plan 22.3) that surface-exposure.ts and the auth derive
 *   read. See tasks/plan-gateway.md.
 */
import type {
  AccessMode, GatewayConfig, PolicyScope, RateLimitPolicy, RequestLimits, SurfaceAccess, SurfaceCategory,
  TrustedProxyConfig,
} from '@tangen/types'
import { OPERATOR_ONLY_KEYS, accessModeRank } from '@tangen/types'

/** Where an offending value came from, which decides throw versus clamp. */
export type PolicySource = 'authored' | 'runtime'

export interface CeilingBreach {
  scope: PolicyScope
  key: string
  requested: unknown
  allowed: unknown
  kind: 'exceeds-ceiling' | 'outside-parent-set' | 'operator-only'
}

export interface NarrowContext {
  key: string
  scope: PolicyScope
  source?: PolicySource
  onBreach?: (breach: CeilingBreach) => void
}

/** Thrown when an AUTHORED config asks for more than its ceiling allows. */
export class GatewayCeilingError extends Error {
  readonly breach: CeilingBreach
  constructor(breach: CeilingBreach, message: string) {
    super(message)
    this.name = 'GatewayCeilingError'
    this.breach = breach
  }
}

function report(breach: CeilingBreach, ctx: NarrowContext): void {
  ctx.onBreach?.(breach)
  if ((ctx.source ?? 'authored') !== 'authored') return
  const what = breach.kind === 'operator-only'
    ? `gateway: ${breach.scope} config states '${breach.key}', which is operator-only. ` +
      'It describes the deployment rather than a tenant, so it belongs in the global environment file.'
    : `gateway: ${breach.scope} requested ${breach.key}=${JSON.stringify(breach.requested)} ` +
      `which exceeds the ceiling of ${JSON.stringify(breach.allowed)}. ` +
      'A ceiling narrows downward only; raise it where it is set, or ask for less.'
  throw new GatewayCeilingError(breach, what)
}

/** Numeric ceiling: the child may lower it, never raise it. */
export function narrowMin(parent: number | undefined, child: number | undefined, ctx: NarrowContext): number | undefined {
  if (child === undefined) return parent
  if (parent === undefined) return child
  if (child <= parent) return child
  report({ scope: ctx.scope, key: ctx.key, requested: child, allowed: parent, kind: 'exceeds-ceiling' }, ctx)
  return parent
}

/** Numeric floor: the child may raise it, never lower it. */
export function narrowMax(parent: number | undefined, child: number | undefined, ctx: NarrowContext): number | undefined {
  if (child === undefined) return parent
  if (parent === undefined) return child
  if (child >= parent) return child
  report({ scope: ctx.scope, key: ctx.key, requested: child, allowed: parent, kind: 'exceeds-ceiling' }, ctx)
  return parent
}

/**
 * Rate ceiling. Compares REQUESTS PER SECOND rather than raw limits, because
 * "1000 per hour" against "100 per minute" is not obviously narrower and gets
 * re-derived incorrectly every time it is not written down. The child's window
 * shape is preserved so a caller still sees the budget it asked about.
 */
export function narrowRate(
  ceiling: RateLimitPolicy | undefined,
  child: RateLimitPolicy | undefined,
  ctx: NarrowContext,
): RateLimitPolicy | undefined {
  if (!child) return ceiling
  if (!ceiling) return child
  const ceilingRate = ceiling.limit / ceiling.window
  const childRate = child.limit / child.window
  if (childRate <= ceilingRate) return child
  const clamped: RateLimitPolicy = {
    window: child.window,
    limit: Math.max(1, Math.floor(ceilingRate * child.window)),
    ...(child.by ?? ceiling.by ? { by: child.by ?? ceiling.by } : {}),
  }
  report({ scope: ctx.scope, key: ctx.key, requested: child, allowed: clamped, kind: 'exceeds-ceiling' }, ctx)
  return clamped
}

/** List ceiling: the child may only keep entries the parent already allows. */
export function subsetOf(
  parent: readonly string[] | undefined,
  child: readonly string[] | undefined,
  ctx: NarrowContext,
): string[] | undefined {
  if (child === undefined) return parent ? [...parent] : undefined
  if (parent === undefined) return [...child]
  const kept = child.filter((entry) => parent.includes(entry))
  const dropped = child.filter((entry) => !parent.includes(entry))
  if (dropped.length > 0) {
    report({ scope: ctx.scope, key: ctx.key, requested: dropped, allowed: [...parent], kind: 'outside-parent-set' }, ctx)
  }
  return kept
}

/** Union that only ever grows: used where MORE is the safer answer (redaction). */
export function unionOf(...lists: Array<readonly string[] | undefined>): string[] {
  const out = new Set<string>()
  for (const list of lists) for (const entry of list ?? []) out.add(entry)
  return [...out]
}

/** `false` at any scope wins. The default for every safety boolean. */
export function restrictiveWins(...values: Array<boolean | undefined>): boolean | undefined {
  let seen: boolean | undefined
  for (const value of values) {
    if (value === undefined) continue
    if (value === false) return false
    seen = value
  }
  return seen
}

/**
 * The route/surface `access` rule (plan section 22.3): a route may only ever
 * move TOWARD restriction. The order is the one declared once in
 * ACCESS_MODES_BY_RESTRICTION, so `self-authenticating` narrows `public` and is
 * itself narrowed by `authenticated` - a route that checks its own credential
 * can never be relabelled open by a lower scope, and can never claim to satisfy
 * a surface that requires a platform credential.
 * @param parent - The mode the surface above allows.
 * @param child - The mode the route declares, if any.
 * @returns The stricter of the two; the parent when the route states nothing.
 */
export function narrowAccess(parent: AccessMode, child: AccessMode | undefined): AccessMode
export function narrowAccess(parent: SurfaceAccess, child: AccessMode | undefined): SurfaceAccess
export function narrowAccess(parent: SurfaceAccess, child: AccessMode | undefined): SurfaceAccess {
  if (child === undefined) return parent
  return accessModeRank(child) > accessModeRank(parent) ? child : parent
}

/** `true` at any scope wins. Used only where MORE is safer (access logging). */
export function permissiveWins(...values: Array<boolean | undefined>): boolean | undefined {
  let seen: boolean | undefined
  for (const value of values) {
    if (value === undefined) continue
    if (value === true) return true
    seen = value
  }
  return seen
}

// ── The effective policy ──────────────────────────────────────────────────────

export interface ResolvedGatewayPolicy {
  cors: { origins: string[]; credentials: boolean; publicOrigins: string[] | '*'; exposeHeaders: string[] }
  rateLimit: {
    enabled: boolean
    default: RateLimitPolicy
    policies: Partial<Record<SurfaceCategory, RateLimitPolicy>>
    store: 'auto' | 'memory' | 'redis' | 'postgres'
    failOpen: boolean
  }
  requestLimits: Required<Pick<RequestLimits, 'maxBodyBytes' | 'maxUploadBytes' | 'maxGraphqlDepth' | 'maxQueryLimit' | 'maxRelationDepth'>>
    & { maxUploadMimeTypes: string[] | undefined }
  trustedProxy: TrustedProxyConfig | undefined
  logging: { requests: boolean | 'errors-only'; includeHeaders: string[]; redact: string[]; sampleRate: number }
  observability: { serverTiming: boolean; requestIdHeader: false | string }
  /** Realtime ceilings (plan-realtime 4.6), narrow-min through G W E. */
  realtime: { maxConnections: number; maxConnectionsPerIdentity: number; maxMessagesPerMinute: number }
  apiExposure: Partial<Record<SurfaceCategory, boolean>>
  /**
   * The access FLOOR per category that the surface scopes impose, which a
   * route row may narrow and never widen (narrowAccess). Today the only
   * floor a scope can set is `closed`, from `apiExposure[category]: false`;
   * a category with no entry floors nothing and the row's own access stands.
   */
  access: Partial<Record<SurfaceCategory, SurfaceAccess>>
}

/**
 * Built-in defaults. Conservative enough to be safe, generous enough that
 * nobody notices them in development. NONE of these is a production rate-limit
 * number: rate limiting ships disabled and its numbers come from measurement.
 */
export const GATEWAY_DEFAULTS: ResolvedGatewayPolicy = {
  cors: { origins: [], credentials: true, publicOrigins: [], exposeHeaders: ['X-Tangen-Qm', 'Server-Timing', 'X-Tangen-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'] },
  rateLimit: {
    // On by default (2026-10-13). The per-surface policies in
    // rate-limit/policy.ts carry the real numbers; the two that matter are
    // `auth` (20/min by ip, which is brute-force protection the deployment
    // had none of) and `forms` (10/min by ip+route). A policy counting by a
    // dimension the request lacks does not apply, so public asset bytes stay
    // unlimited - `counterKey` returns null without an apiKey. `failOpen`
    // below means a store outage passes traffic rather than refusing it.
    enabled: true,
    default: { window: 60, limit: 600 },
    policies: {},
    store: 'auto',
    failOpen: true,
  },
  requestLimits: {
    maxBodyBytes: 10_000_000,
    // Today's hard-coded media cap (routes/media/upload.ts), written down.
    maxUploadBytes: 50_000_000,
    maxGraphqlDepth: 12,
    maxQueryLimit: 100,
    // Above every depth the docs and the SDK examples ask for (2), below
    // what a cyclic schema would let a caller fan out to.
    maxRelationDepth: 5,
    maxUploadMimeTypes: undefined,
  },
  trustedProxy: undefined,
  // Starting points, UNMEASURED like the rate-limit numbers: the hub's own
  // per-process ceiling written down, a generous per-identity count, and a
  // message rate far above what subscribe/ping traffic produces. Observe-only
  // until gateway.rateLimit.enabled says otherwise (D-6).
  realtime: { maxConnections: 500, maxConnectionsPerIdentity: 20, maxMessagesPerMinute: 600 },
  logging: { requests: 'errors-only', includeHeaders: [], redact: [], sampleRate: 1 },
  observability: { serverTiming: true, requestIdHeader: 'X-Tangen-Request-Id' },
  apiExposure: {},
  access: {},
}

export interface GatewayScopes {
  global?: GatewayConfig
  workspace?: GatewayConfig
  /** The route scope reuses the same shape; only a few keys are meaningful. */
  route?: GatewayConfig
}

export interface ResolveOptions {
  source?: PolicySource
  onBreach?: (breach: CeilingBreach) => void
}

/** Reads a dotted key off a GatewayConfig without any typing gymnastics. */
function at(config: GatewayConfig | undefined, key: string): unknown {
  let node: unknown = config
  for (const part of key.split('.')) {
    if (node === undefined || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** A lower scope stating an operator-only key is an error, not an override. */
function assertNoOperatorKeys(config: GatewayConfig | undefined, scope: PolicyScope, opts: ResolveOptions): void {
  if (!config) return
  for (const key of OPERATOR_ONLY_KEYS) {
    if (at(config, key) === undefined) continue
    report(
      { scope, key, requested: at(config, key), allowed: undefined, kind: 'operator-only' },
      { key, scope, source: opts.source, onBreach: opts.onBreach },
    )
  }
}

/**
 * Resolves global -> workspace -> environment -> route into one policy.
 * @param scopes - The authored blocks, outermost first.
 * @param opts - `source` decides throw (authored) versus clamp (runtime).
 * @returns The effective policy. Nothing enforces it yet; M1 is observe-only.
 */
export function resolveGatewayPolicy(scopes: GatewayScopes, opts: ResolveOptions = {}): ResolvedGatewayPolicy {
  const { global: g, workspace: w, route: r } = scopes
  const source = opts.source ?? 'authored'
  const ctx = (key: string, scope: PolicyScope): NarrowContext => ({ key, scope, source, onBreach: opts.onBreach })

  for (const [config, scope] of [[w, 'workspace'], [r, 'route']] as const) {
    assertNoOperatorKeys(config, scope, { source, onBreach: opts.onBreach })
  }

  // CORS. Origins narrow by SUBSET - never union, which is the cross-workspace
  // leak in miniature. Credentials are restrictive-wins AND forced off by a
  // wildcard, because no browser accepts that pair.
  let origins = (g?.cors?.origins ?? GATEWAY_DEFAULTS.cors.origins).slice()
  origins = subsetOf(origins.length > 0 ? origins : undefined, w?.cors?.origins, ctx('cors.origins', 'workspace')) ?? []
  const wildcard = origins.includes('*')
  const credentials = wildcard
    ? false
    : restrictiveWins(g?.cors?.credentials, w?.cors?.credentials, r?.cors?.credentials)
      ?? GATEWAY_DEFAULTS.cors.credentials

  const globalPublic = g?.cors?.publicOrigins
  const wildcardAllowed = g?.cors?.allowWildcardPublicOrigins === true
  let publicOrigins: string[] | '*' = globalPublic ?? GATEWAY_DEFAULTS.cors.publicOrigins
  for (const [config, scope] of [[w, 'workspace']] as const) {
    const declared = config?.cors?.publicOrigins
    if (declared === undefined) continue
    if (declared === '*') {
      if (globalPublic === '*' || wildcardAllowed) { publicOrigins = '*'; continue }
      report(
        { scope, key: 'cors.publicOrigins', requested: '*', allowed: publicOrigins, kind: 'outside-parent-set' },
        ctx('cors.publicOrigins', scope),
      )
      continue
    }
    publicOrigins = publicOrigins === '*'
      ? [...declared]
      : subsetOf(publicOrigins.length > 0 ? publicOrigins : undefined, declared, ctx('cors.publicOrigins', scope)) ?? []
  }

  // Rate limiting. `enabled` is permissive-wins: a scope may turn a limit ON,
  // never off, so a tenant cannot opt out of a budget the operator set.
  //
  // The default has to be folded in BEFORE the tenant is consulted, or it is
  // not a floor at all: `permissiveWins(undefined, false)` is `false`, so
  // while the default was `false` a tenant writing `false` was a harmless
  // no-op, and the moment the default became `true` that same line became an
  // opt-out the comment above says does not exist. The operator may still
  // turn it off for the deployment; only the tenant is barred from weakening
  // whatever is effective.
  const deploymentRateEnabled = g?.rateLimit?.enabled ?? GATEWAY_DEFAULTS.rateLimit.enabled
  const rateEnabled = permissiveWins(deploymentRateEnabled, w?.rateLimit?.enabled)
    ?? deploymentRateEnabled
  let rateDefault = g?.rateLimit?.default ?? GATEWAY_DEFAULTS.rateLimit.default
  rateDefault = narrowRate(rateDefault, w?.rateLimit?.default, ctx('rateLimit.default', 'workspace'))!
  const categories = new Set<SurfaceCategory>([
    ...Object.keys(g?.rateLimit?.policies ?? {}),
    ...Object.keys(w?.rateLimit?.policies ?? {}),
    ...Object.keys(r?.rateLimit?.policies ?? {}),
  ] as SurfaceCategory[])
  const policies: Partial<Record<SurfaceCategory, RateLimitPolicy>> = {}
  for (const category of categories) {
    let policy = g?.rateLimit?.policies?.[category] ?? rateDefault
    policy = narrowRate(policy, w?.rateLimit?.policies?.[category], ctx(`rateLimit.policies.${category}`, 'workspace'))!
    policy = narrowRate(policy, r?.rateLimit?.policies?.[category], ctx(`rateLimit.policies.${category}`, 'route'))!
    policies[category] = policy
  }

  // Request limits. The descent the locked decision names: 50MB -> 20MB ->
  // 10MB -> 2MB is valid; asking upward at any step is not.
  const limitKeys = ['maxBodyBytes', 'maxUploadBytes', 'maxGraphqlDepth', 'maxQueryLimit', 'maxRelationDepth'] as const
  const requestLimits = { ...GATEWAY_DEFAULTS.requestLimits }
  for (const key of limitKeys) {
    let value: number | undefined = g?.requestLimits?.[key] ?? GATEWAY_DEFAULTS.requestLimits[key]
    value = narrowMin(value, w?.requestLimits?.[key], ctx(`requestLimits.${key}`, 'workspace'))
    value = narrowMin(value, r?.requestLimits?.[key], ctx(`requestLimits.${key}`, 'route'))
    requestLimits[key] = value as number
  }
  let mimeTypes = g?.requestLimits?.maxUploadMimeTypes
  for (const [config, scope] of [[w, 'workspace'], [r, 'route']] as const) {
    mimeTypes = subsetOf(mimeTypes, config?.requestLimits?.maxUploadMimeTypes, ctx('requestLimits.maxUploadMimeTypes', scope))
  }
  requestLimits.maxUploadMimeTypes = mimeTypes

  // Realtime ceilings: the same descent as request limits.
  const realtime = { ...GATEWAY_DEFAULTS.realtime }
  for (const key of ['maxConnections', 'maxConnectionsPerIdentity', 'maxMessagesPerMinute'] as const) {
    let value: number | undefined = g?.realtime?.[key] ?? GATEWAY_DEFAULTS.realtime[key]
    value = narrowMin(value, w?.realtime?.[key], ctx(`realtime.${key}`, 'workspace'))
    realtime[key] = value as number
  }

  // Logging. `requests` is permissive-wins because the safer value is MORE
  // logging: a tenant that could quieten the access log could erase its own
  // audit trail. `redact` only ever grows.
  const requestsValues = [g?.logging?.requests, w?.logging?.requests, r?.logging?.requests]
    .filter((v) => v !== undefined) as Array<boolean | 'errors-only'>
  const verbosity = (v: boolean | 'errors-only') => (v === true ? 2 : v === 'errors-only' ? 1 : 0)
  const requests = requestsValues.length === 0
    ? GATEWAY_DEFAULTS.logging.requests
    : requestsValues.reduce((a, b) => (verbosity(b) > verbosity(a) ? b : a))
  let includeHeaders = g?.logging?.includeHeaders
  for (const [config, scope] of [[w, 'workspace']] as const) {
    includeHeaders = subsetOf(includeHeaders, config?.logging?.includeHeaders, ctx('logging.includeHeaders', scope))
  }
  let sampleRate: number | undefined = g?.logging?.sampleRate ?? GATEWAY_DEFAULTS.logging.sampleRate
  sampleRate = narrowMax(sampleRate, w?.logging?.sampleRate, ctx('logging.sampleRate', 'workspace'))

  // Surface exposure. Restrictive-wins per category; a switched-off surface
  // is the `closed` access floor every row in that category narrows to.
  const apiExposure: Partial<Record<SurfaceCategory, boolean>> = {}
  const exposureKeys = new Set<SurfaceCategory>([
    ...Object.keys(g?.apiExposure ?? {}), ...Object.keys(w?.apiExposure ?? {}),
  ] as SurfaceCategory[])
  for (const key of exposureKeys) {
    apiExposure[key] = restrictiveWins(g?.apiExposure?.[key], w?.apiExposure?.[key]) ?? true
  }
  const access: Partial<Record<SurfaceCategory, SurfaceAccess>> = {}
  for (const [key, exposed] of Object.entries(apiExposure) as Array<[SurfaceCategory, boolean]>) {
    if (exposed === false) access[key] = 'closed'
  }

  return {
    cors: {
      origins,
      credentials,
      publicOrigins,
      exposeHeaders: g?.cors?.exposeHeaders ?? GATEWAY_DEFAULTS.cors.exposeHeaders,
    },
    rateLimit: {
      enabled: rateEnabled,
      default: rateDefault,
      policies,
      store: g?.rateLimit?.store ?? GATEWAY_DEFAULTS.rateLimit.store,
      failOpen: g?.rateLimit?.failOpen ?? GATEWAY_DEFAULTS.rateLimit.failOpen,
    },
    requestLimits,
    realtime,
    trustedProxy: g?.trustedProxy ?? GATEWAY_DEFAULTS.trustedProxy,
    logging: {
      requests,
      includeHeaders: includeHeaders ?? GATEWAY_DEFAULTS.logging.includeHeaders,
      // Redaction is a security control, so lower scopes may only ADD to it.
      redact: unionOf(
        GATEWAY_DEFAULTS.logging.redact, g?.logging?.redact,
        w?.logging?.redact, r?.logging?.redact,
      ),
      sampleRate: sampleRate ?? GATEWAY_DEFAULTS.logging.sampleRate,
    },
    observability: {
      serverTiming: restrictiveWins(
        g?.observability?.serverTiming, w?.observability?.serverTiming,
      ) ?? GATEWAY_DEFAULTS.observability.serverTiming,
      requestIdHeader: g?.observability?.requestIdHeader ?? GATEWAY_DEFAULTS.observability.requestIdHeader,
    },
    apiExposure,
    access,
  }
}
