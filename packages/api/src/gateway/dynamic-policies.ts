/**
 * File Name: dynamic-policies.ts
 * Purpose: Route policies that cannot be written down in advance - the ones a
 *   developer's own routes bring with them - registered at mount time and
 *   matched as whole-path patterns rather than prefixes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types for the shape; no I/O, so a lookup stays
 *   as cheap as the static table's prefix scan.
 *
 *   Why this exists. The static table in route-policy.ts describes surfaces the
 *   platform ships. A custom route is declared by the site developer and mounts
 *   at a path only their config knows (routes/custom/router.ts), so no fixed
 *   prefix can classify it: `/api/v1/custom/{workspaceId}/{env}/{path}` and
 *   `/api/v1/custom/{path}` both landed on the FALLBACK, which calls them
 *   `authenticated`. A route that authenticates ITSELF and answers a caller the
 *   platform never saw a credential from therefore disagreed with the table on
 *   every request - and that disagreement was the M3 blocker, because the
 *   moment auth reads the table, the fallback turns a working route into a 401.
 *   Registering a row per route at mount time is the fix: mounting IS the
 *   declaration, so there is no second list to keep in step.
 *
 *   Matching. A dynamic row names a CONCRETE route, so it is consulted before
 *   the static prefixes and wins when it matches - `/api/v1/custom/wsp_a/dev/hello`
 *   is better described by the row that route registered than by any static
 *   prefix that covers the mount. The pattern matches the
 *   WHOLE path, with `:name` matching one segment and `*` matching the rest,
 *   which is Elysia's own path syntax so the row and the mount cannot drift.
 *   Among several matches the one with the most literal segments wins.
 *
 *   The registry is process-global and replaced, not appended: a second
 *   createServer in one process (every test file that builds one) must not
 *   inherit the routes of the first.
 */
import { defineRoutePolicy, type RoutePolicy } from '@tangen/types'

const _dynamic: RoutePolicy[] = []

/**
 * Adds one route's policy to the table.
 * @param policy - The row. Its `match.path` is a whole-path pattern.
 * @returns The registered row.
 * @throws When the pattern is not an absolute path, or when it would match
 *         everything - a row that greedy would silently reclassify the platform.
 */
export function registerRoutePolicy(policy: RoutePolicy): RoutePolicy {
  const pattern = policy.match.path
  if (!pattern.startsWith('/')) {
    throw new Error(`gateway: dynamic route policy '${policy.id}' must declare an absolute path (got '${pattern}')`)
  }
  if (literalSegments(pattern) === 0) {
    throw new Error(
      `gateway: dynamic route policy '${policy.id}' matches every path ('${pattern}'). ` +
      'A row with no literal segment would reclassify surfaces it knows nothing about.',
    )
  }
  const row = defineRoutePolicy(policy)
  _dynamic.push(row)
  return row
}

/**
 * Drops registered rows.
 * @param idPrefix - Clear only rows whose id starts with this; all when absent.
 */
export function clearDynamicRoutePolicies(idPrefix?: string): void {
  const kept = idPrefix === undefined ? [] : _dynamic.filter((p) => !p.id.startsWith(idPrefix))
  _dynamic.length = 0
  _dynamic.push(...kept)
}

/** Every dynamically registered row, in registration order. */
export function dynamicRoutePolicies(): RoutePolicy[] {
  return [..._dynamic]
}

/** How many segments of a pattern are literal - the specificity of a match. */
function literalSegments(pattern: string): number {
  return pattern.split('/').filter((s) => s !== '' && s !== '*' && !s.startsWith(':')).length
}

/**
 * Does a whole-path pattern match this path?
 * @param pattern - Pattern with `:name` segments and an optional `*` tail.
 * @param path - The request pathname.
 * @returns Whether they match end to end.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  const want = pattern.split('/')
  const got = path.split('/')
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]
    // A wildcard tail consumes the rest, including an empty rest.
    if (segment === '*') return true
    if (got[i] === undefined) return false
    if (segment.startsWith(':')) {
      if (got[i] === '') return false
      continue
    }
    if (segment !== got[i]) return false
  }
  return want.length === got.length
}

/**
 * The dynamically registered policy governing one request, if any.
 * @param method - HTTP method.
 * @param path - URL pathname, without query.
 * @returns The most specific matching row, or undefined.
 */
export function resolveDynamicRoutePolicy(method: string, path: string): RoutePolicy | undefined {
  let best: RoutePolicy | undefined
  let bestScore = -1
  for (const policy of _dynamic) {
    const m = policy.match.method
    if (m !== '*' && m.toUpperCase() !== method.toUpperCase()) continue
    if (!matchesPattern(policy.match.path, path)) continue
    const score = literalSegments(policy.match.path) * 1000
      + policy.match.path.length
      + (m === '*' ? 0 : 1)
    if (score > bestScore) { best = policy; bestScore = score }
  }
  return best
}
