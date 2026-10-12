/**
 * File Name: read-limits.ts
 * Purpose: The two REST read ceilings - `maxQueryLimit` on the rows one read
 *   may ask for and `maxRelationDepth` on how far it may expand relations -
 *   applied as a CLAMP the response admits to, never as a refusal.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: M6 of tasks/plan-gateway.md, second half; plan section
 *   32 lists both as "clamped, not rejected". Why a clamp and not a 400. A
 *   body over its cap is a request the platform will not serve at any size;
 *   a read asking for 500 rows is a read the platform serves at 100, and
 *   the caller who asked was, until now, silently handed 100 by the
 *   compiler's own constant. Refusing it would turn a working integration
 *   into a broken one on the day an operator lowers a number. So the read
 *   runs at the ceiling, and two things say so: the response meta
 *   (`meta.clamped`, on the routes that have a meta) and the request
 *   context's `limits` field, written with `via: 'clamp'` so the access log
 *   can count clamps the way it counts refusals.
 *
 *   Where it runs: in the handler, after auth, because the ceilings are per
 *   workspace and environment and both are only known once the auth derive
 *   has attached them. `readLimitsFor` reads them off the Elysia context the
 *   way the rate-limit hook does.
 *
 *   What it does not touch: the local client (services/local-client.ts),
 *   which is code calling code - flows, GraphQL resolvers, extensions - and
 *   not a caller over the wire. GraphQL has its own depth ceiling
 *   (graphql-depth.ts).
 *
 *   A value that is not a finite non-negative number is passed through
 *   untouched: the routes already validate their own parameters, and a
 *   clamp that silently repaired a bad one would hide a 422 the caller
 *   should see.
 */
import type { GatewayRequestContext, WorkspaceProject } from '@tangen/types'
import { effectiveRequestLimits, recordLimitRefusal, type ResolvedRequestLimits } from './request-limits'
import { gatewayContextOf } from './request-context'
import { resolveRoutePolicy } from './route-policy'

/** The read parameters the ceilings apply to. */
export interface ReadParams {
  limit?: number
  depth?: number
}

/** What a clamp changed, for the response meta. Only the keys that moved. */
export interface ReadClamp {
  limit?: { requested: number; applied: number }
  depth?: { requested: number; applied: number }
}

export interface ClampedRead extends ReadParams {
  /** Null when nothing was clamped, so a meta can spread it conditionally. */
  clamped: ReadClamp | null
}

const clampable = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/**
 * Clamps a read's `limit` and `depth` to the resolved ceilings.
 * @param ctx - The Gateway context, when one is open; the clamp is recorded on it.
 * @param limits - The resolved request limits for this workspace, environment and route.
 * @param params - What the caller asked for.
 * @returns The values to run with, and what changed.
 */
export function clampRead(
  ctx: GatewayRequestContext | undefined,
  limits: Pick<ResolvedRequestLimits, 'maxQueryLimit' | 'maxRelationDepth'>,
  params: ReadParams,
): ClampedRead {
  let clamped: ReadClamp | null = null
  let { limit, depth } = params
  if (clampable(limit) && limit > limits.maxQueryLimit) {
    clamped = { ...(clamped ?? {}), limit: { requested: limit, applied: limits.maxQueryLimit } }
    recordLimitRefusal(ctx, { limit: 'maxQueryLimit', allowed: limits.maxQueryLimit, observed: limit, via: 'clamp' })
    limit = limits.maxQueryLimit
  }
  if (clampable(depth) && depth > limits.maxRelationDepth) {
    clamped = { ...(clamped ?? {}), depth: { requested: depth, applied: limits.maxRelationDepth } }
    recordLimitRefusal(ctx, { limit: 'maxRelationDepth', allowed: limits.maxRelationDepth, observed: depth, via: 'clamp' })
    depth = limits.maxRelationDepth
  }
  return { limit, depth, clamped }
}

/**
 * The resolved request limits for the request on an Elysia context, read
 * from what the auth derive attached (workspaceId, workspaceProjects)
 * and the route row the request matched.
 * @param c - The Elysia context inside a handler.
 * @returns The effective limits.
 */
export function readLimitsFor(c: any): ResolvedRequestLimits {
  const projects = (c?.workspaceProjects ?? []) as WorkspaceProject[]
  const workspaceId = (c?.workspaceId ?? gatewayContextOf(c)?.workspaceId ?? null) as string | null
  const project = workspaceId ? projects.find((p) => p.workspaceId === workspaceId) : undefined
  const request: Request | undefined = c?.request
  const route = request
    ? resolveRoutePolicy(request.method, new URL(request.url).pathname)
    : resolveRoutePolicy('POST', '/api/v1/objects/query')
  return effectiveRequestLimits(project, route)
}
