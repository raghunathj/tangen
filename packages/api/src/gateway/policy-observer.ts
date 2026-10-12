/**
 * File Name: policy-observer.ts
 * Purpose: M2's evidence mechanism - compare what the route-policy table SAYS
 *   about a request against what the existing auth chain actually DID, and
 *   report the disagreements without acting on any of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/logging for the sink; the detection itself is
 *   pure, so a disagreement can be asserted without a server.
 *
 *   STILL OBSERVE ONLY: nothing here changes a status, a body or a header. What
 *   changed at M3 is what a mismatch MEANS. While auth compared its own path
 *   prefixes, a disagreement meant the table was an inaccurate description and
 *   the evidence was there to make M3 safe. Now auth reads the table, so a
 *   disagreement means the table is WRONG IN PRODUCTION and a request was
 *   handled on a row that does not describe it. The line says so, and it is
 *   logged at error rather than warn.
 *
 *   Three disagreements are worth reporting, and only three.
 *
 *   `public-but-rejected` - the table says the route needs no credential and
 *   the request came back 401 or 403. Either the row is wrong or something
 *   above it is rejecting a caller it should not; both are worth knowing before
 *   auth is driven from the table. It applies to `public` ONLY: a
 *   self-authenticating route answering 401 is that route's own check failing -
 *   an expired refresh cookie, a wrong password - which is the route working.
 *
 *   `self-auth-but-anonymous-success` - the table says the route checks a
 *   credential of its own and the request SUCCEEDED with none on the wire and
 *   no identity resolved. That is the one thing this mode can get wrong: either
 *   the route's own check is missing, or the row is mislabelled and belongs in
 *   the public set with a written reason. Both are worth a warning.
 *
 *   `authenticated-but-anonymous` - the table says a credential is required and
 *   the request SUCCEEDED with none on the wire and none resolved. This is the
 *   dangerous direction: at M3 the table would start rejecting that caller, so
 *   every occurrence is a request M3 would break. The known example is the
 *   short-form custom route at `/api/v1/{workspaceId}/{env}/{path}`, a shape no
 *   static prefix can match - it lands on the restrictive fallback while
 *   authenticating itself. That gap is REPORTED here rather than papered over,
 *   because a fallback that quietly disagrees with reality is exactly how M3
 *   would ship a 401 for a working public route.
 *
 *   A credential PRESENT on the wire suppresses the second kind even when no
 *   identity was resolved: the route validated something of its own (a preview
 *   token, a site key, a transfer token) and "no member and no API key" is not
 *   the same as "no credential".
 *
 *   Throttling. This runs on every request, so an unthrottled warn on a hot
 *   disagreeing path would cost more than it tells. Occurrences are counted per
 *   kind and route and emitted at 1, 10, 100, ... - the first is immediate, and
 *   the volume is still legible because every line carries the running count.
 */
import { getLogger } from '@tangen/logging'
import type { AccessMode, GatewayRequestContext, SurfaceCategory } from '@tangen/types'
import { scrubPath } from './logging'
import { resolveRoutePolicy, ROUTE_POLICIES } from './route-policy'

/** The three disagreements worth reporting. */
export type PolicyMismatchKind =
  | 'public-but-rejected'
  | 'authenticated-but-anonymous'
  | 'self-auth-but-anonymous-success'

export interface PolicyMismatch {
  kind: PolicyMismatchKind
  /** The matched policy id, or 'unmatched' when the fallback answered. */
  route: string
  category: SurfaceCategory
  method: string
  /** Scrubbed - a token in the path never reaches this record. */
  path: string
  /** What the TABLE said. */
  tableAccess: AccessMode
  /** What actually happened. */
  status: number
  /** Which credential the chain resolved, if any. */
  authMode: GatewayRequestContext['authMode']
  /** Whether any credential header was on the wire at all. */
  credentialPresent: boolean
  requestId: string
  /** How many times this kind and route have disagreed since the process started. */
  occurrences: number
  /**
   * Raised from `warn` to `error` at M3. The table decides now: a mismatch is
   * no longer an inaccurate description, it is a live misclassification.
   */
  severity: 'error'
}

/**
 * Header names whose presence means the caller offered SOMETHING. Deliberately
 * not the full secret-header list: `cookie` is excluded because every browser
 * sends one for unrelated reasons, and counting it would mask the exact case
 * this signal exists to find.
 */
const CREDENTIAL_HEADERS = [
  'authorization',
  'proxy-authorization',
  'x-tangen-key',
  'x-tangen-playground',
  'x-tangen-transfer',
  'x-tangen-preview-token',
  'x-api-key',
] as const

/**
 * Did the caller put any credential on the wire?
 * @param headers - The request headers, if the runtime gave us any.
 * @returns Whether a credential-bearing header was present.
 */
export function requestCarriedCredential(headers?: Headers, url?: string | null): boolean {
  if (headers && CREDENTIAL_HEADERS.some((name) => (headers.get(name)?.trim() ?? '') !== '')) return true
  // Some routes cannot take a header: a WebSocket upgrade and an EventSource
  // are opened by the browser, which sets none. Those carry their credential
  // in the query string, and the route policy TABLE says which name - so a
  // `?ticket=` on a route that declares nothing is still anonymous.
  if (!url) return false
  let parsed: URL
  try { parsed = new URL(url, 'http://local') } catch { return false }
  const names = resolveRoutePolicy('GET', parsed.pathname).credential?.query
  if (!names?.length) return false
  return names.some((name) => (parsed.searchParams.get(name)?.trim() ?? '') !== '')
}

/**
 * Does the table's answer disagree with what the request actually did?
 * @param ctx - The finished request context.
 * @param opts - Whether a credential header was on the wire.
 * @returns The mismatch to report, or null when the two agree.
 */
export function detectPolicyMismatch(
  ctx: GatewayRequestContext,
  opts: { credentialPresent: boolean },
): PolicyMismatch | null {
  const status = ctx.status
  // No status means no response to compare against - a crash before one
  // existed, which the access log already records as an error.
  if (status === null) return null

  const kind = mismatchKind(ctx, status, opts.credentialPresent)
  if (!kind) return null

  const route = ctx.route ?? 'unmatched'
  const key = `${kind}|${route}`
  const occurrences = (counts.get(key) ?? 0) + 1
  return {
    kind,
    route,
    category: ctx.routeCategory,
    method: ctx.method,
    path: scrubPath(ctx.path),
    tableAccess: ctx.accessMode,
    status,
    authMode: ctx.authMode,
    credentialPresent: opts.credentialPresent,
    requestId: ctx.requestId,
    occurrences,
    severity: 'error',
  }
}

function mismatchKind(
  ctx: GatewayRequestContext,
  status: number,
  credentialPresent: boolean,
): PolicyMismatchKind | null {
  const anonymous = !credentialPresent
    && ctx.authMode === 'none'
    && ctx.userId === null
    && ctx.apiKeyId === null
  if (ctx.accessMode === 'public') {
    return status === 401 || status === 403 ? 'public-but-rejected' : null
  }
  if (ctx.accessMode === 'self-authenticating') {
    // A 401 or 403 here is EXPECTED: the route checked its own credential and
    // said no. The very first live mismatch was exactly that - the admin
    // refreshing an expired session - and counting it would raise a warning on
    // every session expiry. What is not expected is the opposite: succeeding
    // for a caller who offered nothing means nothing was checked - unless the
    // table says the credential is somewhere the platform cannot see: the
    // body of a login, the cookie of a refresh, the signed path of a webhook.
    // Those routes succeed for a caller who "offered nothing" on the wire the
    // observer reads, and reporting every login as a misclassification trains
    // the reader to ignore the one report that matters.
    const row = ROUTE_POLICIES.find((p) => p.id === ctx.route)
    if (row?.credential?.body || row?.credential?.cookie || row?.credential?.path) return null
    return status < 400 && anonymous ? 'self-auth-but-anonymous-success' : null
  }
  if (ctx.accessMode === 'authenticated' || ctx.accessMode === 'admin-internal') {
    return status < 400 && anonymous ? 'authenticated-but-anonymous' : null
  }
  // optional-auth makes no claim the request can contradict: the handler is
  // meant to decide, which is precisely why the mode exists.
  return null
}

const counts = new Map<string, number>()
const logger = getLogger(['tangen', 'api', 'gateway'])

/** Emit at 1, 10, 100, ... so the first is immediate and volume stays legible. */
function shouldEmit(occurrences: number): boolean {
  if (occurrences === 1) return true
  const log10 = Math.log10(occurrences)
  return Number.isInteger(log10)
}

/**
 * Records one disagreement and writes it out, subject to the throttle.
 * @param mismatch - The mismatch from detectPolicyMismatch.
 * @returns Whether a log line was written (false means counted only).
 */
export function logPolicyMismatch(mismatch: PolicyMismatch): boolean {
  const key = `${mismatch.kind}|${mismatch.route}`
  counts.set(key, mismatch.occurrences)
  if (!shouldEmit(mismatch.occurrences)) return false
  // The essentials go in the MESSAGE, not only in the structured fields. The
  // pretty console formatter prints the message and drops properties, so a
  // line reading only "gateway.policy.mismatch" named no route - which made
  // the first live mismatch impossible to investigate. The fields stay for
  // structured sinks; the message is what a person reads in a terminal.
  //
  // error, not warn: auth reads this table now, so the row that disagreed is
  // the row a request was actually handled on.
  logger.error(mismatchMessage(mismatch), { event: 'gateway.policy.mismatch', ...mismatch })
  return true
}

/**
 * One line a person can act on: what disagreed, on which request, how often,
 * and - since M3 - that the row which disagreed is the row auth acted on.
 */
export function mismatchMessage(m: PolicyMismatch): string {
  return `gateway.policy.mismatch ${m.kind} ${m.method} ${m.path} ${m.status} `
    + `table=${m.route}/${m.tableAccess} observed=${m.authMode}${m.credentialPresent ? '+credential' : ''} `
    + `x${m.occurrences} - the table DECIDES access since M3, so this row is wrong in production`
}

/** The running counts, keyed `<kind>|<route>`. Exposed so a test can read them. */
export function policyMismatchCounts(): Record<string, number> {
  return Object.fromEntries(counts)
}

/** Clears the counters. Tests only - the process otherwise counts for its lifetime. */
export function resetPolicyMismatchCounters(): void {
  counts.clear()
}

/**
 * The whole observation for one finished request: detect, count, log.
 * @param ctx - The finished request context.
 * @param headers - The request headers, for the credential-presence check.
 * @param url - The request URL, for routes whose credential is a query param.
 * @returns The mismatch found, or null when the table and reality agreed.
 */
export function observePolicy(
  ctx: GatewayRequestContext,
  headers?: Headers,
  url?: string | null,
): PolicyMismatch | null {
  const mismatch = detectPolicyMismatch(ctx, { credentialPresent: requestCarriedCredential(headers, url) })
  if (mismatch) logPolicyMismatch(mismatch)
  return mismatch
}
