/**
 * File Name: index.ts
 * Purpose: The Gateway's rate-limit hook - observe, measure, then enforce.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: M5 of tasks/plan-gateway.md. One hook after the auth
 *          derive has run, so every dimension a policy can name is known: the
 *          category policy and the route's own are checked, the first denial
 *          wins, and the tightest window writes X-RateLimit-Limit / -Remaining
 *          / -Reset on the response - headers the spec promised years ago and
 *          nothing emitted (gap G-j).
 *
 *          Enforcement is OFF by default (D-6, resolved): no number here is
 *          measured, and a guessed 429 in production is worse than none. In
 *          observe mode the request runs whatever the count says, a would-be
 *          denial is logged with the policy, the key's dimensions and the
 *          count, and a NEAR-MISS - a request that consumed more than 80% of
 *          its budget - is logged too, because that log is where the next
 *          release's numbers come from. `gateway.rateLimit.enabled: true` at
 *          any scope turns enforcement on for that workspace or environment
 *          (permissive-wins: a scope may turn a limit on, never off).
 *
 *          The ten hand-placed budgets in the routes (login per email, the AI
 *          routes per member) keep enforcing exactly as before. The Gateway
 *          adds the per-IP `auth` counter the audit asked for and umbrellas
 *          above the rest; nothing it observes changes what those routes do.
 */
import { Elysia } from 'elysia'
import { getLogger } from '@tangen/logging'
import type { GatewayRequestContext, RateLimitOutcome, WorkspaceProject } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { gatewayContextOf, recordGatewayTime } from '../request-context'
import { resolveRoutePolicy } from '../route-policy'
import { effectiveGatewayPolicy, deploymentGatewayPolicy } from '../effective-policy'
import { resolveRequestWorkspace, type DomainLookup } from '../cors'
import { policiesFor, counterKey, type NamedRateLimitPolicy } from './policy'
import { hitOrOpen, type RateLimitStore } from './store'

const logger = getLogger(['tangen', 'api', 'gateway', 'rate-limit'])

/** A request that used more than this share of its budget is a near-miss. */
const NEAR_MISS_SHARE = 0.8

export interface RateLimitObservation {
  kind: 'would-deny' | 'denied' | 'near-miss'
  policy: string
  key: string
  count: number
  limit: number
  route: string | null
  workspaceId: string | null
}

const counts = new Map<string, number>()

/** Log on the 1st, 10th, 100th... occurrence - the policy observer's cadence. */
function shouldEmit(n: number): boolean {
  if (n === 1) return true
  return Number.isInteger(Math.log10(n))
}

/** The running counts, keyed `<kind>|<policy>`. Exposed for tests and the monitor. */
export function rateLimitCounts(): Record<string, number> { return Object.fromEntries(counts) }

/** Tests only. */
export function resetRateLimitCounters(): void { counts.clear() }

/**
 * Records one observation and writes it out, throttled. Exported so a test
 * can drive it without a request.
 */
export function observeRateLimit(o: RateLimitObservation, emit: (line: string, o: RateLimitObservation) => void = defaultEmit): boolean {
  const k = `${o.kind}|${o.policy}`
  const n = (counts.get(k) ?? 0) + 1
  counts.set(k, n)
  if (!shouldEmit(n)) return false
  const verb = o.kind === 'denied' ? 'DENIED' : o.kind === 'would-deny' ? 'would have been denied (observe mode)' : 'near-miss'
  emit(`gateway.ratelimit ${verb}: policy ${o.policy} at ${o.count}/${o.limit} on ${o.route ?? '?'} for ${o.key} x${n}`, o)
  return true
}

function defaultEmit(line: string, o: RateLimitObservation): void {
  if (o.kind === 'near-miss') logger.info(line, { event: 'gateway.ratelimit.near-miss', ...o })
  else logger.warn(line, { event: `gateway.ratelimit.${o.kind}`, ...o })
}

export interface GatewayRateLimitOptions {
  store: RateLimitStore
  projects: () => WorkspaceProject[]
  /**
   * Host -> workspace, for a PUBLIC route: no credential means the auth derive
   * attaches nothing, and the workspace's own budgets would otherwise never
   * reach its own delivery, forms or media surfaces. Same resolver as CORS.
   */
  lookupDomain?: DomainLookup
  /** Test seam: replaces the log. */
  onObservation?: (o: RateLimitObservation) => void
}

/** What one evaluated policy produced. */
interface Evaluated {
  policy: NamedRateLimitPolicy
  key: string
  count: number
  resetAt: number
}

/**
 * Evaluates every applicable policy against the store. Pure over the store:
 * a test hands in a memory store and reads the outcome.
 */
export async function evaluateRateLimit(
  store: RateLimitStore,
  policies: NamedRateLimitPolicy[],
  ctx: GatewayRequestContext,
): Promise<Evaluated[]> {
  const out: Evaluated[] = []
  for (const policy of policies) {
    const key = counterKey(policy, ctx)
    if (!key) continue                         // a dimension this request does not have
    const state = await hitOrOpen(store, key, policy.window)
    if (!state) continue                       // store failure: allowed, uncounted, logged
    out.push({ policy, key, count: state.count, resetAt: state.resetAt })
  }
  return out
}

/** The outcome the headers and the log carry: the tightest policy's state. */
export function outcomeOf(evaluated: Evaluated[], mode: 'observe' | 'enforce'): RateLimitOutcome | null {
  if (evaluated.length === 0) return null
  const tightest = [...evaluated].sort((a, b) => (a.policy.limit - a.count) - (b.policy.limit - b.count))[0]!
  return {
    policy: tightest.policy.id,
    limit: tightest.policy.limit,
    remaining: Math.max(0, tightest.policy.limit - tightest.count),
    resetAt: Math.ceil(tightest.resetAt / 1000),
    denied: evaluated.some((e) => e.count > e.policy.limit),
    mode,
  }
}


/**
 * The hook. `onBeforeHandle` rather than `onRequest` because the post-auth
 * dimensions (key, member, workspace) exist only once the auth derive has
 * run, and derives run before any beforeHandle.
 */
export const gatewayRateLimit = (opts: GatewayRateLimitOptions) => (app: Elysia) =>
  app.onBeforeHandle(async (c: any) => {
    // Timed (29.4): the check, the store round-trip and the headers.
    const t0 = performance.now()
    try {
      await check(opts, c)
    } finally {
      recordGatewayTime(gatewayContextOf(c), t0)
    }
  })

async function check(opts: GatewayRateLimitOptions, c: any): Promise<void> {
    const ctx = gatewayContextOf(c)
    if (!ctx) return
    const request: Request = c.request
    const route = resolveRoutePolicy(request.method, new URL(request.url).pathname)
    if (route.rateLimit === 'none') return

    // The identity the auth derive attached, copied onto the context NOW
    // rather than at finish, so the counters can key on it.
    if (c.workspaceId && !ctx.workspaceId) ctx.workspaceId = c.workspaceId
    if (c.memberId && !ctx.userId) ctx.userId = c.memberId
    if (c.apiKeyId && !ctx.apiKeyId) ctx.apiKeyId = c.apiKeyId

    const projects = opts.projects()
    // A public route carries no credential, so the derive attached nothing;
    // the workspace is then what the request names - the X-Tangen-Workspace
    // header, ?workspace= (delivery), the Host domain, or the sole loaded
    // workspace - exactly as CORS and the request limits resolve it. Without
    // that, a workspace's own rate-limit policy never reached its own public
    // surfaces and the operator's deployment policy was ignored there too.
    if (!ctx.workspaceId) {
      ctx.workspaceId = await resolveRequestWorkspace(request, projects, opts.lookupDomain ?? (async () => null))
    }
    const project = ctx.workspaceId ? projects.find((p) => p.workspaceId === ctx.workspaceId) : undefined
    // The workspace's policy when one resolved, the operator's deployment
    // ceiling when none did - never the bare built-in defaults while an
    // operator has written a policy.
    const resolved = project
      ? effectiveGatewayPolicy(project)
      : deploymentGatewayPolicy(projects.find((p) => p.deploymentGateway) ?? projects[0])
    const mode: 'observe' | 'enforce' = resolved.rateLimit.enabled ? 'enforce' : 'observe'

    const evaluated = await evaluateRateLimit(opts.store, policiesFor(route, resolved.rateLimit), ctx)
    const outcome = outcomeOf(evaluated, mode)
    if (!outcome) return
    ctx.rateLimit = outcome
    c.set.headers['x-ratelimit-limit'] = String(outcome.limit)
    c.set.headers['x-ratelimit-remaining'] = String(outcome.remaining)
    c.set.headers['x-ratelimit-reset'] = String(outcome.resetAt)

    const observe = (o: RateLimitObservation) => opts.onObservation ? opts.onObservation(o) : observeRateLimit(o)
    for (const e of evaluated) {
      const base = { policy: e.policy.id, key: e.key, count: e.count, limit: e.policy.limit, route: ctx.route, workspaceId: ctx.workspaceId }
      if (e.count > e.policy.limit) observe({ kind: mode === 'enforce' ? 'denied' : 'would-deny', ...base })
      else if (e.count > e.policy.limit * NEAR_MISS_SHARE) observe({ kind: 'near-miss', ...base })
    }

    if (mode === 'enforce' && outcome.denied) {
      const retryAfterSeconds = Math.max(1, outcome.resetAt - Math.floor(Date.now() / 1000))
      throw new RequestError('RATE_LIMITED', 'Too many requests - try again later', 429, undefined, { retryAfterSeconds, policy: outcome.policy })
    }
}
