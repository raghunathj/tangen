/**
 * File Name: cors.ts
 * Purpose: Workspace-aware CORS - the Gateway decides every Access-Control-*
 *          header, per request, AFTER the workspace is known.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: M4 of tasks/plan-gateway.md (section 26). Until now
 *          CORS was one boot-time plugin fed the UNION of every environment of
 *          every project, because a plugin registered at boot has no request
 *          and so no workspace. The consequence was a cross-workspace boundary
 *          failure: workspace A's declared origin was a valid origin for
 *          workspace B's routes. The fix is not a better list; it is deciding
 *          CORS at step 7 of 21.6, after the workspace (step 4) and the
 *          environment (step 5) are resolved from what a PREFLIGHT can carry -
 *          a preflight has no credential, so only routing identifiers count:
 *          the X-Tangen-Workspace header, the `?workspace=` query (delivery),
 *          the Host against `workspace_domains`, and the sole loaded workspace.
 *
 *          An unresolvable workspace on a cross-origin request is a DENIAL,
 *          not a guess (26.2): no Allow-Origin, the request proceeds, the
 *          route answers as it would for any caller. Development keeps the
 *          old union as its fallback so a bare clone still works (26.4).
 *
 *          Per-policy modes (26.5): a `cors: 'public'` row (delivery, media,
 *          embeds) answers from `gateway.cors.publicOrigins` - `'*'` is legal
 *          there precisely because those responses carry no credentials - a
 *          `'default'` row answers the workspace's credentialed list, and a
 *          `'none'` row gets no CORS headers at all. `credentials` comes from
 *          the resolved policy rather than a hard-coded true, and is forced off
 *          beside any wildcard because no browser accepts that pair.
 *
 *          ENFORCE is now the default (2026-10-13), which is what 26.4 said
 *          would happen after one release of observation: the per-workspace
 *          decision answers, and workspace A's declared origin is no longer a
 *          valid origin for workspace B's routes. `TANGEN_CORS_MODE=observe`
 *          restores the old union for a deployment that needs a migration
 *          window, and logs every divergence with workspace, env and origin so
 *          the real cross-workspace dependencies can be declared before
 *          flipping back. An unrecognised value enforces, because a typo must
 *          not reopen the union.
 *
 *          The Elysia `cors` plugin is not used: its credentials and exposed
 *          headers are fixed at registration, and this layer needs them to
 *          follow the route's policy row.
 */
import { Elysia } from 'elysia'
import { getLogger } from '@tangen/logging'
import type { WorkspaceProject, RouteCorsMode, GatewayConfig } from '@tangen/types'
import { resolveWorkspaceFromRequest, resolveWorkspaceId } from '../lib/workspace-boundary'
import { extractHostDomain } from '../middleware/auth'
import { corsOriginsFor, collectCorsOrigins, declaresCorsOrigins } from '../lib/cors-origins'
import { isProductionLike } from '../lib/cors-policy'
import { resolveRoutePolicy } from './route-policy'
import { resolveGatewayPolicy, GATEWAY_DEFAULTS } from './resolve-config'
import { gatewayContextOf, recordGatewayTime } from './request-context'

export type CorsMode = 'observe' | 'enforce'

/** How long a Host -> workspace answer is reused. Domains change rarely; preflights arrive constantly. */
const DOMAIN_CACHE_TTL_MS = 60_000

/** Preflight answers may be cached this long by the browser - the plugin's old default. */
const PREFLIGHT_MAX_AGE = '5'

/** Resolves the deployment's mode from the operator's environment. */
export function resolveCorsMode(value: string | undefined = process.env.TANGEN_CORS_MODE): CorsMode {
  // Unset means ENFORCE, and so does any unrecognised value: a typo in an
  // operator's environment must not silently reopen the union.
  return value === 'observe' ? 'observe' : 'enforce'
}

// ─── Workspace and environment, before any credential ───────────────────────

export type DomainLookup = (domain: string) => Promise<string | null>

/**
 * Wraps a `workspace_domains` lookup in a short cache. `localhost` never
 * resolves, matching the auth middleware, so a dev machine costs no query.
 */
export function cachedDomainLookup(lookup: DomainLookup, ttlMs = DOMAIN_CACHE_TTL_MS, now = () => Date.now()): DomainLookup {
  const cache = new Map<string, { value: string | null; until: number }>()
  return async (domain) => {
    if (!domain || domain === 'localhost') return null
    const hit = cache.get(domain)
    if (hit && hit.until > now()) return hit.value
    let value: string | null = null
    try { value = await lookup(domain) } catch { value = null }
    cache.set(domain, { value, until: now() + ttlMs })
    return value
  }
}

/**
 * The workspace a request addresses, from routing identifiers alone - the
 * only things a preflight carries. Order follows 26.2: header, query,
 * Host domain, sole loaded workspace. Null means "not resolvable", which on a
 * cross-origin request is a denial rather than a guess.
 */
export async function resolveRequestWorkspace(
  request: Request,
  projects: WorkspaceProject[],
  lookupDomain: DomainLookup,
): Promise<string | null> {
  const fromHeaders = resolveWorkspaceFromRequest(request.headers, projects)
  if (fromHeaders) return fromHeaders
  const url = new URL(request.url)
  const query = url.searchParams.get('workspace')
  if (query) return resolveWorkspaceId(query, projects)
  const host = request.headers.get('host') ?? ''
  const byDomain = await lookupDomain(extractHostDomain(host))
  if (byDomain) return byDomain
  return projects.length === 1 ? projects[0]!.workspaceId : null
}

// ─── The effective policy for one workspace ─────────────────────────────────

export interface EffectiveCors {
  origins: string[]
  credentials: boolean
  publicOrigins: string[] | '*'
  exposeHeaders: string[]
  /**
   * Whether any origin was DECLARED (by the workspace or the operator ceiling)
   * rather than defaulted by the resolver. Absent means: judge by `origins`.
   */
  declared?: boolean
}

/**
 * Memoized per PROJECT OBJECT. Keying on the object
 * rather than the workspace id means a refreshed project list (createServer
 * runs again on a config reload) starts clean by construction, and a stale
 * policy cannot outlive the config it was computed from.
 */
let _effective = new WeakMap<WorkspaceProject, EffectiveCors>()

/** Test helper - forgets every memoized policy. */
export function resetCorsCache(): void { _effective = new WeakMap() }

/**
 * The CORS policy for one workspace, memoized the way resolveStorage is,
 * because it runs on every request.
 *
 * Scopes, outermost first (22.3): the operator's ceiling (`gateway.cors` on
 * the root config) and the workspace's `gateway.cors`, which narrows it and
 * adds what the workspace has always declared - `server.cors.origins` and the
 * resolved Admin and frontend URLs. Nothing a workspace already has needs to change.
 */
export function effectiveCors(project: WorkspaceProject | undefined): EffectiveCors {
  if (!project) return { origins: [], credentials: false, publicOrigins: [], exposeHeaders: GATEWAY_DEFAULTS.cors.exposeHeaders, declared: false }
  const hit = _effective.get(project)
  if (hit) return hit

  const workspaceGateway = (project.config as { gateway?: GatewayConfig } | undefined)?.gateway
  const declared = corsOriginsFor(project)
  const resolved = resolveGatewayPolicy({
    global: project.deploymentGateway as GatewayConfig | undefined,
    workspace: { ...workspaceGateway, cors: { ...workspaceGateway?.cors, origins: [...new Set([...(workspaceGateway?.cors?.origins ?? []), ...declared])] } },
  }, { source: 'runtime' })
  const origins = new Set<string>(resolved.cors.origins)
  const serverCors = (project.config as { server?: { cors?: { credentials?: boolean } } } | undefined)?.server?.cors
  const credentials = resolved.cors.credentials && serverCors?.credentials !== false
  const operatorOrigins = ((project.deploymentGateway as GatewayConfig | undefined)?.cors?.origins ?? []).length > 0
  const value: EffectiveCors = { origins: [...origins], credentials: credentials && !origins.has('*'), publicOrigins: resolved.cors.publicOrigins, exposeHeaders: resolved.cors.exposeHeaders, declared: operatorOrigins || declaresCorsOrigins(project) }
  _effective.set(project, value)
  return value
}


export interface CorsDecision {
  /** The Allow-Origin value, or null for no CORS headers at all. */
  allowOrigin: string | null
  credentials: boolean
  exposeHeaders: string[]
}

const NONE: CorsDecision = { allowOrigin: null, credentials: false, exposeHeaders: [] }

/**
 * Decides the headers for one request. Pure, so the whole matrix is a table
 * test: route mode x origin lists x resolution x deployment posture.
 */
export function decideCors(input: {
  routeCors: RouteCorsMode
  origin: string | null
  policy: EffectiveCors
  /** Whether the workspace was resolved; an unresolved one is a denial outside development. */
  resolved: boolean
  productionLike: boolean
}): CorsDecision {
  const { origin, policy } = input
  if (!origin) return NONE                       // not a cross-origin request
  if (input.routeCors === 'none') return NONE
  const expose = policy.exposeHeaders

  // 26.2: an unresolvable workspace gets no Allow-Origin, never a reflected
  // guess - outside development. Development keeps the bare-clone posture the
  // old layer had: a workspace that declares nothing at all (or none resolved
  // and nothing declared) is answered with whatever asked, so a fresh clone
  // works before anyone has written a config.
  if (input.productionLike && !input.resolved) return NONE
  const nothingDeclared = policy.declared === undefined ? policy.origins.length === 0 : !policy.declared
  if (!input.productionLike && nothingDeclared && policy.publicOrigins.length === 0) {
    return { allowOrigin: origin, credentials: true, exposeHeaders: expose }
  }

  if (input.routeCors === 'public') {
    // Public surfaces carry no credentials, which is exactly what makes a
    // wildcard legal here and nowhere else.
    if (policy.publicOrigins === '*' || policy.origins.includes('*')) return { allowOrigin: '*', credentials: false, exposeHeaders: expose }
    const allowed = policy.publicOrigins.includes(origin) || policy.origins.includes(origin)
    return allowed ? { allowOrigin: origin, credentials: false, exposeHeaders: expose } : NONE
  }

  if (policy.origins.includes('*')) return { allowOrigin: '*', credentials: false, exposeHeaders: expose }
  if (!policy.origins.includes(origin)) return NONE
  return { allowOrigin: origin, credentials: policy.credentials, exposeHeaders: expose }
}

/** Writes a decision onto Elysia's `set.headers`. Vary is set whenever the answer depends on the origin. */
export function applyCorsHeaders(headers: Record<string, string | number | undefined>, decision: CorsDecision, preflight: Request | null): void {
  headers['vary'] = 'Origin'
  if (decision.allowOrigin === null) return
  headers['access-control-allow-origin'] = decision.allowOrigin
  if (decision.credentials) headers['access-control-allow-credentials'] = 'true'
  if (decision.exposeHeaders.length > 0) headers['access-control-expose-headers'] = decision.exposeHeaders.join(', ')
  if (preflight) {
    headers['access-control-allow-methods'] = preflight.headers.get('access-control-request-method') ?? '*'
    const requested = preflight.headers.get('access-control-request-headers')
    if (requested) headers['access-control-allow-headers'] = requested
    headers['access-control-max-age'] = PREFLIGHT_MAX_AGE
  }
}

// ─── The plugin ─────────────────────────────────────────────────────────────

export interface GatewayCorsOptions {
  /** Read per request, so a refreshed project list is seen. */
  projects: () => WorkspaceProject[]
  lookupDomain: DomainLookup
  mode?: CorsMode
  productionLike?: boolean
  /** Test seam: receives every observe-mode divergence instead of the log. */
  onDivergence?: (d: { workspaceId: string | null; origin: string; route: string }) => void
}

const divergenceCounts = new Map<string, number>()

/**
 * Observe-mode divergences since the process started, keyed
 * `<workspaceId or unresolved>|<route>` - every occurrence, not only the
 * first one the log reports. For the Performance Monitor (plan 29.5).
 */
export function corsDivergenceCounts(): Record<string, number> { return Object.fromEntries(divergenceCounts) }

/** Tests only. */
export function resetCorsDivergenceCounters(): void { divergenceCounts.clear() }

/**
 * The Gateway's CORS layer. One `onRequest`: resolve workspace and env, decide,
 * write headers, and answer a preflight with 204 so no route has to.
 */
export const gatewayCors = (opts: GatewayCorsOptions) => (app: Elysia) => {
  const mode = opts.mode ?? resolveCorsMode()
  const productionLike = opts.productionLike ?? isProductionLike()
  const log = getLogger(['tangen', 'api', 'cors'])
  const reported = new Set<string>()
  const divergence = opts.onDivergence ?? ((d) => {
    const k = `${d.workspaceId}|${d.origin}|${d.route}`
    if (reported.has(k)) return
    reported.add(k)
    log.warn(
      `CORS observe: origin ${d.origin} is allowed by the process-wide union but NOT by workspace ${d.workspaceId ?? '(unresolved)'}` +
      ` on route ${d.route}. Declare it for that workspace, or this request is refused when TANGEN_CORS_MODE=enforce.`,
    )
  })

  // Timed as one hook (29.4): the try/finally adds this layer's cost to the
  // context whichever way the decision went, including a preflight answered here.
  return app.onRequest(async (c: any) => {
    const t0 = performance.now()
    try {
      return await decide(c)
    } finally {
      recordGatewayTime(gatewayContextOf(c), t0)
    }
  })

  async function decide(c: any): Promise<Response | undefined> {
    const request: Request = c.request
    const origin = request.headers.get('origin')
    if (!origin) return                          // not a CORS request; nothing to decide
    const projects = opts.projects()
    const policy = gatewayContextOf(c) ? resolveRoutePolicy(request.method, new URL(request.url).pathname) : resolveRoutePolicy(request.method, new URL(request.url).pathname)
    const routeCors: RouteCorsMode = policy.cors ?? 'default'

    const workspaceId = await resolveRequestWorkspace(request, projects, opts.lookupDomain)
    const project = workspaceId ? projects.find((p) => p.workspaceId === workspaceId) : undefined
    const scoped = decideCors({ routeCors, origin, policy: effectiveCors(project), resolved: !!project, productionLike })

    let decision = scoped
    if (mode === 'observe') {
      // The union answers, exactly as before; the scoped decision only speaks.
      const union = collectCorsOrigins(projects)
      decision = decideCors({
        routeCors: 'default', origin, resolved: true, productionLike,
        policy: { origins: union, credentials: !union.includes('*'), publicOrigins: [], exposeHeaders: GATEWAY_DEFAULTS.cors.exposeHeaders },
      })
      if (decision.allowOrigin !== null && scoped.allowOrigin === null) {
        const k = `${workspaceId ?? 'unresolved'}|${policy.id}`
        divergenceCounts.set(k, (divergenceCounts.get(k) ?? 0) + 1)
        divergence({ workspaceId, origin, route: policy.id })
      }
    }

    const preflight = request.method === 'OPTIONS' && request.headers.has('access-control-request-method')
    applyCorsHeaders(c.set.headers, decision, preflight ? request : null)
    if (preflight) return new Response(null, { status: 204 })
  }
}
