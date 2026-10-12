/**
 * File Name: surface-exposure.ts
 * Purpose: The surface scope's `access` floor, adopted - a category a
 *   workspace or environment switched off (`gateway.apiExposure[category]:
 *   false`) refuses every route in it with one uniform answer, and a public
 *   row that belongs to such a workspace is refused at boot by name.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Plan 22.3, the two rows left open since M4: route-scope
 *   `access` narrowing adopted by a surface scope, and the boot error for a
 *   public route under an environment that forbids its surface. The resolver
 *   has carried `apiExposure` (restrictive-wins) since M1 and `narrowAccess`
 *   since M3; until now nothing read either as a DECISION. Now the resolved
 *   policy carries an access floor per category (`closed` for a switched-off
 *   surface), every row narrows to it through narrowAccess, and `closed` is
 *   refused here and in the auth derive.
 *
 *   Why the answer is one uniform 404. Section 43: the Gateway must not be a
 *   new oracle. A refusal that said "this surface exists but is off" would
 *   tell an anonymous caller which workspaces run GraphQL, and a refusal that
 *   differed between a caller with a credential and one without would tell
 *   them whether theirs was valid. So every refusal is the same NOT_FOUND the
 *   delivery route already answers for an unknown workspace, it carries no
 *   category, and it is decided BEFORE a credential is read wherever the
 *   workspace can be known before one - which is the M4/M6 pre-auth
 *   resolution: the X-Tangen-Workspace header, ?workspace=, the Host domain,
 *   or the sole loaded workspace. The one case that cannot answer pre-auth
 *   is a multi-workspace install with no routing identifier on the request,
 *   where only the credential names the workspace; the auth derive refuses
 *   that with the same 404 once it knows, and an anonymous caller there gets
 *   the 401 it would have got anyway.
 *
 *   Which rows a workspace's exposure reaches. A row that needs no workspace
 *   (`workspace: 'none'`: the health probe, the docs bundle, static media
 *   bytes) is the DEPLOYMENT'S surface, not the tenant's, and no workspace
 *   may close it - a sole-workspace install that switched `management` off
 *   must still answer its liveness probe. Every other row is closed when the
 *   request resolves to a workspace that switched its category off.
 *
 *   The boot error. A public row (`access: 'public'`) that REQUIRES a
 *   workspace is unambiguously that workspace's public surface - published
 *   delivery bytes, a developer's own public custom route. A workspace that
 *   switches such a category off has authored a contradiction between two
 *   things it controls, and 22.2 says an authored contradiction is refused
 *   at boot by name rather than discovered as a 404 in production. A public
 *   row whose workspace is OPTIONAL (the GraphiQL shell, the form embed, a
 *   media transform) is served with or without a workspace, so it is not the
 *   tenant's alone; it closes at request time when the request resolves to
 *   the tenant that switched it off, which is what lets a workspace that does
 *   not use GraphQL turn the surface off - the plan's own example in 21.2.
 */
import { Elysia } from 'elysia'
import { getLogger } from '@tangen/logging'
import type { RoutePolicy, SurfaceAccess, WorkspaceProject } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { gatewayContextOf, recordGatewayTime } from './request-context'
import { resolveRoutePolicy, ROUTE_POLICIES } from './route-policy'
import { dynamicRoutePolicies } from './dynamic-policies'
import { effectiveGatewayPolicy } from './effective-policy'
import { narrowAccess, type ResolvedGatewayPolicy } from './resolve-config'
import { resolveRequestWorkspace, type DomainLookup } from './cors'

const logger = getLogger(['tangen', 'api', 'gateway', 'exposure'])

/**
 * The access a route resolves to under a surface scope: its own, narrowed by
 * the floor the resolved policy carries for its category. A row that needs
 * no workspace is outside every tenant's reach and keeps its own access.
 * @param route - The matched row.
 * @param resolved - The policy for the workspace and environment in play.
 * @returns The effective access, `closed` when the surface is switched off.
 */
export function surfaceAccessFor(route: RoutePolicy, resolved: Pick<ResolvedGatewayPolicy, 'access'>): SurfaceAccess {
  if (route.workspace === 'none') return route.access
  const floor = resolved.access[route.category]
  if (floor === undefined) return route.access
  return narrowAccess(floor, route.access)
}

const counts = new Map<string, number>()

/** Refusals since the process started, keyed `<category>|<workspaceId>`. For the monitor. */
export function exposureRefusalCounts(): Record<string, number> { return Object.fromEntries(counts) }

/** Tests only. */
export function resetExposureRefusalCounters(): void { counts.clear() }

/** Log on the 1st, 10th, 100th... occurrence - the policy observer's cadence. */
function shouldEmit(n: number): boolean {
  if (n === 1) return true
  return Number.isInteger(Math.log10(n))
}

/**
 * The one refusal. Uniform on purpose: no category, no scope, no hint that a
 * workspace exists - the same NOT_FOUND delivery answers for an unknown one.
 */
function closedSurfaceError(): RequestError {
  return new RequestError('NOT_FOUND', 'Not found', 404)
}

/**
 * Refuses the request when the route's surface is switched off for the
 * workspace and environment it resolved to. The evidence goes to the log and
 * the counters; the caller gets the uniform answer.
 * @param route - The matched row.
 * @param resolved - The policy for the workspace and environment.
 * @param scope - Who the refusal is about, for the log line only.
 * @throws RequestError 404 when the surface is closed.
 */
export function refuseClosedSurface(
  route: RoutePolicy,
  resolved: Pick<ResolvedGatewayPolicy, 'access'>,
  scope: { workspaceId: string },
): void {
  if (surfaceAccessFor(route, resolved) !== 'closed') return
  const k = `${route.category}|${scope.workspaceId}`
  const n = (counts.get(k) ?? 0) + 1
  counts.set(k, n)
  if (shouldEmit(n)) {
    logger.warn(
      `gateway.exposure refused ${route.id} (${route.category}) for workspace ${scope.workspaceId}` +
      `: the surface is switched off by gateway.apiExposure x${n}`,
      { event: 'gateway.exposure.refused', route: route.id, category: route.category, workspaceId: scope.workspaceId, occurrences: n },
    )
  }
  throw closedSurfaceError()
}

export interface GatewaySurfaceExposureOptions {
  /** Read per request, so a refreshed project list is seen. */
  projects: () => WorkspaceProject[]
  lookupDomain: DomainLookup
}

/**
 * The hook. `onRequest`, before routing and before any credential is read,
 * because a refusal that waited for auth would answer an anonymous caller
 * 401 and a credentialed one 404 - the oracle section 43 forbids. The
 * workspace comes from routing identifiers alone (resolveRequestWorkspace);
 * a request that names none passes here and meets the auth derive's check.
 */
export const gatewaySurfaceExposure = (opts: GatewaySurfaceExposureOptions) => (app: Elysia) =>
  app.onRequest(async (c: any) => {
    const t0 = performance.now()
    try {
      const request: Request = c.request
      const route = resolveRoutePolicy(request.method, new URL(request.url).pathname)
      if (route.workspace === 'none') return
      const projects = opts.projects()
      const workspaceId = await resolveRequestWorkspace(request, projects, opts.lookupDomain)
      if (!workspaceId) return
      const project = projects.find((p) => p.workspaceId === workspaceId)
      if (!project) return
      refuseClosedSurface(route, effectiveGatewayPolicy(project), { workspaceId })
    } finally {
      recordGatewayTime(gatewayContextOf(c), t0)
    }
  })

/**
 * The auth derive's half: once the credential has named the workspace and
 * environment, the same check with the same answer. Idempotent with the hook
 * above - a request the hook already refused never reaches the derive.
 * @param opts - The loaded projects and what the credential resolved.
 * @throws RequestError 404 when the surface is closed.
 */
export function refuseClosedSurfaceForCredential(opts: {
  projects: WorkspaceProject[]
  route: RoutePolicy
  workspaceId: string | null | undefined
}): void {
  if (!opts.workspaceId || opts.route.workspace === 'none') return
  const project = opts.projects.find((p) => p.workspaceId === opts.workspaceId)
  if (!project) return
  refuseClosedSurface(opts.route, effectiveGatewayPolicy(project), { workspaceId: opts.workspaceId })
}

/**
 * The boot check (22.2, authored source: REJECT). For every workspace and
 * every environment it declares, a public row that requires a workspace and
 * sits in a category that scope switched off is a contradiction the author
 * can fix, so it is refused before the server answers anything.
 * @param projects - The loaded workspaces.
 * @param rows - The rows to check; the static table plus the dynamic
 *               registrations by default, so a developer's public custom
 *               route is held to the same rule as delivery.
 * @throws Error naming the route, the category and the scope.
 */
export function assertPublicRowsExposed(
  projects: WorkspaceProject[],
  rows: RoutePolicy[] = [...dynamicRoutePolicies(), ...ROUTE_POLICIES],
): void {
  const publicRows = rows.filter((row) => row.access === 'public' && row.workspace === 'required')
  if (publicRows.length === 0) return
  for (const project of projects) {
    const resolved = effectiveGatewayPolicy(project)
    {
      for (const row of publicRows) {
        if (resolved.access[row.category] !== 'closed') continue
        const scope = `workspace '${project.workspaceId}'`
        throw new Error(
          `gateway: route policy '${row.id}' is public in category '${row.category}', ` +
          `which ${scope} switches off with gateway.apiExposure.${row.category}: false. ` +
          'A public surface a workspace has switched off is a contradiction: remove the exposure line, ' +
          'or stop publishing on that surface.',
        )
      }
    }
  }
}
