/**
 * File Name: policy.ts
 * Purpose: Which budgets apply to a request, and the counter each one keys.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Plan section 27. A limit is a budget over an identity:
 *          a policy names its dimensions with `by`, and `by: ['ip', 'route']`
 *          is ONE counter keyed on the pair. Several policies may apply to one
 *          request - the category's and the route's - and every one is
 *          checked; the first denial wins, so a per-workspace budget and a
 *          per-IP budget compose rather than override.
 *
 *          The numbers below are NOT production numbers. The plan is explicit
 *          that none is verified, and D-6 forbids choosing any before data
 *          exists: the first release ships them generous and observe-only,
 *          and the ones the next release enforces come from the near-miss
 *          log. `auth` and `ai` keep their existing hand-placed budgets in
 *          the routes themselves; the category policies here sit ABOVE those
 *          as umbrellas and change nothing they do.
 */
import type { RateLimitDimension, RateLimitPolicy, SurfaceCategory, GatewayRequestContext, RoutePolicy } from '@tangen/types'

/** A policy with the id its counter and its log line carry. */
export interface NamedRateLimitPolicy extends RateLimitPolicy {
  id: string
  by: RateLimitDimension[]
}

/**
 * Per-surface defaults and the identity each counts against (27, "Per-surface
 * policies"). Starting points to be measured and changed, not recommendations.
 */
export const CATEGORY_DEFAULTS: Record<SurfaceCategory, NamedRateLimitPolicy> = {
  content: { id: 'category:content', window: 60, limit: 600, by: ['apiKey', 'workspace'] },
  graphql: { id: 'category:graphql', window: 60, limit: 120, by: ['apiKey', 'workspace'] },
  forms: { id: 'category:forms', window: 60, limit: 10, by: ['ip', 'route'] },
  delivery: { id: 'category:delivery', window: 60, limit: 600, by: ['ip'] },
  management: { id: 'category:management', window: 60, limit: 600, by: ['member', 'workspace'] },
  // The per-email counters stay in the auth routes; this is the per-IP one
  // the audit asked for, so credential stuffing across accounts is seen.
  auth: { id: 'category:auth', window: 60, limit: 20, by: ['ip'] },
  // 30/min refused a bulk upload at the 31st file, which is an ordinary thing
  // to do in the media library. The abuse this bounds is BYTES, and bytes are
  // already capped per request by requestLimits.maxUploadBytes (50 MB), so a
  // low count bought nothing a size cap was not already buying. Still
  // unmeasured, like every number here, but no longer known-wrong.
  media: { id: 'category:media', window: 60, limit: 300, by: ['apiKey', 'workspace'] },
  extension: { id: 'category:extension', window: 60, limit: 120, by: ['extension', 'apiKey'] },
  // The routes keep their own per-member budgets (5-30/60s); this umbrella is
  // wider than any of them on purpose.
  ai: { id: 'category:ai', window: 60, limit: 60, by: ['member'] },
  custom: { id: 'category:custom', window: 60, limit: 300, by: ['apiKey', 'ip'] },
  // Tickets per identity (plan-realtime 4.6). UNMEASURED like everything
  // above: observe-only until the near-miss log says otherwise. Counted by
  // `identity` - the member, or else the api key - so an api-key-minted
  // ticket is budgeted the same as a member's (the section 27 follow-up,
  // resolved). The ws and stream rows share the category but are
  // self-authenticating, so the Gateway sees no identity there and the
  // counter does not apply to them; the hub's own ceilings cover those.
  realtime: { id: 'category:realtime', window: 60, limit: 30, by: ['identity'] },
}

/** Dimensions that exist before a credential is read. */
const PRE_AUTH: ReadonlySet<RateLimitDimension> = new Set(['ip', 'route'])

/**
 * The identity a dimension names on this request, or null when the request
 * has none - a public route has no api key, and a policy counting by one
 * simply does not apply there.
 */
export function identityFor(dimension: RateLimitDimension, ctx: GatewayRequestContext): string | null {
  switch (dimension) {
    case 'ip': return ctx.clientIp
    case 'route': return ctx.route
    case 'workspace': return ctx.workspaceId
    case 'apiKey': return ctx.apiKeyId
    case 'member': return ctx.userId
    // Whichever the request carries. A member session wins when both are
    // somehow present (the playground impersonates a key under a member),
    // because the human is the one asking.
    case 'identity': return ctx.userId ?? ctx.apiKeyId
    case 'extension': return ctx.extensionId
  }
}

/**
 * The counter key for one policy on one request, or null when a dimension it
 * needs is absent. Keys never include a secret: ids only.
 */
export function counterKey(policy: NamedRateLimitPolicy, ctx: GatewayRequestContext): string | null {
  const parts: string[] = []
  for (const dimension of policy.by) {
    const id = identityFor(dimension, ctx)
    if (!id) return null
    parts.push(`${dimension}=${id}`)
  }
  return `tangen:rl:${policy.id}:${parts.join(':')}`
}

/** Whether every dimension the policy names is known before auth. */
export function isPreAuthPolicy(policy: NamedRateLimitPolicy): boolean {
  return policy.by.every((d) => PRE_AUTH.has(d))
}

/**
 * The policies that apply to a request: the resolved category policy (the
 * operator's or workspace's narrowing of the default above), then the
 * route's own when its row declares one. `'none'` on the row switches the
 * route off entirely - the plan allows it for cheap public routes an
 * operator would rather let a CDN absorb.
 */
export function policiesFor(
  route: RoutePolicy,
  resolved: { default: RateLimitPolicy; policies: Partial<Record<SurfaceCategory, RateLimitPolicy>> },
): NamedRateLimitPolicy[] {
  if (route.rateLimit === 'none') return []
  const base = CATEGORY_DEFAULTS[route.category]
  const category = resolved.policies[route.category]
  const out: NamedRateLimitPolicy[] = [{
    id: base.id,
    window: category?.window ?? base.window,
    limit: category?.limit ?? base.limit,
    by: category?.by ?? base.by,
  }]
  if (route.rateLimit && route.rateLimit !== 'inherit') {
    out.push({ id: `route:${route.id}`, window: route.rateLimit.window, limit: route.rateLimit.limit, by: route.rateLimit.by ?? ['ip', 'route'] })
  }
  return out
}
