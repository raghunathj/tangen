/**
 * File Name: request-limits.ts
 * Purpose: The Gateway's request and body limits - a body cap that refuses
 *   before the parser allocates, the ceiling an upload is measured against,
 *   and the MIME allow-list a scope may declare.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: M6 of tasks/plan-gateway.md, first half. The limits
 *   themselves have resolved through the hierarchy since M1 (resolve-config.ts:
 *   global -> workspace -> environment, narrow-min); this file is where a
 *   request first meets them.
 *
 *   Why `onRequest` and not `onBeforeHandle`. Elysia parses the body BEFORE
 *   any beforeHandle runs, so a cap placed there has already paid for the
 *   allocation it exists to prevent. `onRequest` runs before routing and
 *   before parsing, which is the only place "before the body is parsed" is
 *   literally true. The price is that auth has not run yet, so the workspace
 *   comes from what M4's CORS layer already reads pre-auth - the
 *   X-Tangen-Workspace header, ?workspace=, the Host domain, or the sole
 *   loaded workspace - and a request that resolves no workspace still meets
 *   the operator's deployment ceiling rather than the built-in default.
 *
 *   Two checks, in order. Content-Length first: a declared size over the cap
 *   is answered 413 without reading a byte. Then, for every body that remains
 *   (chunked bodies declare nothing), the request on the context is replaced
 *   with one whose body is a bounded reader: it counts what it passes through,
 *   and past the cap it cancels the source and errors with a 413. Bun's own
 *   `maxRequestBodySize` stops a DECLARED oversize at the socket and is left
 *   at its default above all of this; it does not bound a chunked body, which
 *   is why the reader exists.
 *
 *   What the refusal looks like downstream. Elysia wraps whatever the body
 *   stream threw in a 400 ParseError and keeps the original as `cause`;
 *   middleware/error.ts and the Gateway's statusOf both read the cause, so
 *   the caller and the access log see 413 and not the wrapper. A route that
 *   reads `request.arrayBuffer()` itself gets the RequestError directly.
 *
 *   Which ceiling a surface reads is the route row's business (`bodyLimit`
 *   on RoutePolicy): the media upload and the Porter receive and import
 *   surfaces carry files and are measured against maxUploadBytes; everything
 *   else is a JSON body and reads maxBodyBytes. A row may narrow either
 *   further and may never widen one.
 *
 *   431 for oversized headers is not implemented here because the runtime
 *   already answers it: Bun's HTTP parser refuses a header block over roughly
 *   16KB with 431 before `fetch` is ever called, for every route, and there
 *   is no per-workspace dimension to a header size worth adding. The
 *   request-limits test proves it against a real Bun.serve.
 */
import { Elysia } from 'elysia'
import type { GatewayRequestContext, RequestLimitOutcome, RoutePolicy, WorkspaceProject } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { gatewayContextOf, recordGatewayTime } from './request-context'
import { resolveRoutePolicy } from './route-policy'
import { effectiveGatewayPolicy, deploymentGatewayPolicy } from './effective-policy'
import { narrowMin, subsetOf, type ResolvedGatewayPolicy } from './resolve-config'
import { resolveRequestWorkspace, type DomainLookup } from './cors'

/** The resolved request limits a request is measured against. */
export type ResolvedRequestLimits = ResolvedGatewayPolicy['requestLimits']

/** The two byte ceilings a body can be measured against. */
export type BodyCapKey = 'maxBodyBytes' | 'maxUploadBytes'

/**
 * Bytes as a human reads them in an error message: 64B, 10KB, 2MB, 1.5MB.
 * Decimal units, because the ceilings are authored in decimal (50_000_000).
 * @param n - A byte count.
 * @returns The short form.
 */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n}B`
  const units = ['KB', 'MB', 'GB']
  let value = n
  let unit = ''
  for (const u of units) {
    value /= 1000
    unit = u
    if (value < 1000) break
  }
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${unit}`
}

/**
 * Narrows the resolved limits by what a route row declares. Runtime source:
 * a row is code the platform or an extension wrote, and a per-request
 * resolution must never throw for it - it clamps, as 22.2 says for anything
 * that is not an authored workspace config.
 * @param resolved - The policy for the workspace and environment.
 * @param route - The matched route row.
 * @returns The limits this request is measured against.
 */
export function narrowByRoute(resolved: ResolvedRequestLimits, route: RoutePolicy): ResolvedRequestLimits {
  const declared = route.requestLimits
  if (!declared) return resolved
  const ctx = (key: string) => ({ key: `requestLimits.${key}`, scope: 'route' as const, source: 'runtime' as const })
  return {
    maxBodyBytes: narrowMin(resolved.maxBodyBytes, declared.maxBodyBytes, ctx('maxBodyBytes'))!,
    maxUploadBytes: narrowMin(resolved.maxUploadBytes, declared.maxUploadBytes, ctx('maxUploadBytes'))!,
    maxGraphqlDepth: narrowMin(resolved.maxGraphqlDepth, declared.maxGraphqlDepth, ctx('maxGraphqlDepth'))!,
    maxQueryLimit: narrowMin(resolved.maxQueryLimit, declared.maxQueryLimit, ctx('maxQueryLimit'))!,
    maxRelationDepth: narrowMin(resolved.maxRelationDepth, declared.maxRelationDepth, ctx('maxRelationDepth'))!,
    maxUploadMimeTypes: subsetOf(resolved.maxUploadMimeTypes, declared.maxUploadMimeTypes, ctx('maxUploadMimeTypes')),
  }
}

/**
 * The request limits for one workspace, environment and route.
 * @param project - The workspace, when known.
 * @param envSlug - The environment slug, when known.
 * @param route - The matched route row; its own limits narrow the result.
 * @returns The effective limits.
 */
export function effectiveRequestLimits(
  project: WorkspaceProject | undefined,
  route: RoutePolicy,
): ResolvedRequestLimits {
  return narrowByRoute(effectiveGatewayPolicy(project).requestLimits, route)
}

/**
 * Which byte ceiling this surface's body is measured against.
 * @param route - The matched route row.
 * @returns The requestLimits key.
 */
export function bodyCapFor(route: RoutePolicy): BodyCapKey {
  return route.bodyLimit ?? 'maxBodyBytes'
}

/**
 * Is this MIME type on the allow-list? Permissive when none is declared
 * (D-11); exact media-type match otherwise, case-insensitive, parameters
 * ignored. An empty type cannot pass a declared list: the list is a decision
 * about what /media will serve back, and "unknown" is not on it.
 * @param type - The type the upload carried.
 * @param allowed - The resolved allow-list, or undefined for permissive.
 * @returns Whether the upload may proceed.
 */
export function isAllowedMimeType(type: string, allowed: readonly string[] | undefined): boolean {
  if (allowed === undefined) return true
  const media = type.split(';')[0]!.trim().toLowerCase()
  if (media === '') return false
  return allowed.some((entry) => entry.trim().toLowerCase() === media)
}

/**
 * A body stream that counts what it passes through and refuses past the cap.
 * @param source - The request body.
 * @param cap - Bytes allowed.
 * @param onBreach - Called once with the bytes seen when the cap is passed.
 * @returns A stream to hand the parser in place of the source.
 */
export function boundedBody(
  source: ReadableStream<Uint8Array>,
  cap: number,
  onBreach: (seenBytes: number) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let seen = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) { controller.close(); return }
      seen += value.byteLength
      if (seen > cap) {
        await reader.cancel().catch(() => {})
        onBreach(seen)
        controller.error(new RequestError(
          'PAYLOAD_TOO_LARGE',
          `Request body exceeds the maximum allowed size of ${formatBytes(cap)}`,
          413,
        ))
        return
      }
      controller.enqueue(value)
    },
    cancel(reason) { return reader.cancel(reason) },
  })
}

/**
 * Records a refusal on the request context, so the access log says why.
 * @param ctx - The Gateway context, when one is open.
 * @param outcome - What refused and what was seen.
 */
export function recordLimitRefusal(ctx: GatewayRequestContext | undefined, outcome: RequestLimitOutcome): void {
  if (ctx && !ctx.limits) ctx.limits = outcome
  const k = `${outcome.limit}|${outcome.via}`
  refusalCounts.set(k, (refusalCounts.get(k) ?? 0) + 1)
}

const refusalCounts = new Map<string, number>()

/** Refusals and clamps since the process started, keyed `<limit>|<via>`. For the monitor (29.5). */
export function limitRefusalCounts(): Record<string, number> { return Object.fromEntries(refusalCounts) }

/** Tests only. */
export function resetLimitRefusalCounters(): void { refusalCounts.clear() }

/**
 * The refusal, THROWN rather than returned. A Response returned from
 * onRequest leaves the chain before onAfterResponse, so the access log would
 * never see the 413; an error goes through handleError, where the Gateway's
 * finish writes the line and middleware/error.ts shapes the envelope.
 */
function tooLarge(cap: number): RequestError {
  return new RequestError('PAYLOAD_TOO_LARGE', `Request body exceeds the maximum allowed size of ${formatBytes(cap)}`, 413)
}

export interface GatewayRequestLimitsOptions {
  /** Read per request, so a refreshed project list is seen. */
  projects: () => WorkspaceProject[]
  lookupDomain: DomainLookup
}

/**
 * The policy a request meets before auth has run: the workspace's when one
 * resolves, the operator's deployment ceiling when none does.
 */
function policyFor(projects: WorkspaceProject[], workspaceId: string | null): ResolvedGatewayPolicy {
  const project = workspaceId ? projects.find((p) => p.workspaceId === workspaceId) : undefined
  if (project) return effectiveGatewayPolicy(project)
  // The operator's gateway ceiling is the same object on every loaded project; any carrier will do.
  return deploymentGatewayPolicy(projects.find((p) => p.deploymentGateway) ?? projects[0])
}

/**
 * The hook. One `onRequest`, registered after the CORS layer so a preflight
 * has already been answered, and before anything that parses.
 * @param opts - Project list, domain lookup and the test seams.
 * @returns An Elysia plugin.
 */
export const gatewayRequestLimits = (opts: GatewayRequestLimitsOptions) => (app: Elysia) =>
  app.onRequest(async (c: any) => {
    // Timed (29.4): the hook's own work only - the bounded reader's cost
    // belongs to the parse, not to the Gateway.
    const t0 = performance.now()
    try {
      await measure(opts, c)
    } finally {
      recordGatewayTime(gatewayContextOf(c), t0)
    }
  })

async function measure(opts: GatewayRequestLimitsOptions, c: any): Promise<void> {
    const request: Request = c.request
    const declaredLength = request.headers.get('content-length')
    if (!request.body && declaredLength === null) return      // nothing to measure

    const ctx = gatewayContextOf(c)
    const route = resolveRoutePolicy(request.method, new URL(request.url).pathname)
    const projects = opts.projects()
    const workspaceId = await resolveRequestWorkspace(request, projects, opts.lookupDomain)
    const limits = narrowByRoute(policyFor(projects, workspaceId).requestLimits, route)
    const capKey = bodyCapFor(route)
    const cap = limits[capKey]

    // Declared first: over the cap means not one byte is read.
    const declared = declaredLength === null ? NaN : Number(declaredLength)
    if (Number.isFinite(declared) && declared > cap) {
      recordLimitRefusal(ctx, { limit: capKey, allowed: cap, observed: declared, via: 'content-length' })
      throw tooLarge(cap)
    }
    if (!request.body) return

    // Streamed: the parser reads through a reader that stops at the cap. The
    // original stays on the context for whoever needs the socket
    // (lib/client-ip.ts reads it), because a re-wrapped Request is not the
    // one the server can look up.
    c.rawRequest = request
    c.request = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: boundedBody(request.body, cap, (seen) => {
        recordLimitRefusal(ctx, { limit: capKey, allowed: cap, observed: seen, via: 'stream' })
      }),
      duplex: 'half',
    } as RequestInit)
}
