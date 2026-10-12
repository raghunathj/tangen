/**
 * File Name: graphql-depth.ts
 * Purpose: The Gateway's GraphQL depth ceiling - the resolved
 *   `requestLimits.maxGraphqlDepth` held ABOVE the CF-2 validation rule, so a
 *   tenant's `graphql.maxDepth` can tighten the limit and never loosen it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: M6 of tasks/plan-gateway.md, second half. Two limits
 *   with two owners. `graphql.maxDepth` (packages/graphql, CF-2) is the
 *   workspace's own setting and answers the GraphQL way: a validation error
 *   in `errors` at HTTP 200. `requestLimits.maxGraphqlDepth` resolves through
 *   the hierarchy (operator -> workspace -> environment -> route, narrow-min)
 *   and is the ceiling the operator put on the machine; a query over it is a
 *   request the platform refuses, so it answers the Gateway way: 400
 *   QUERY_TOO_DEEP, with the outcome on the request context for the access
 *   log, exactly as a 413 is recorded.
 *
 *   Why measure before validation rather than read the rule's error. The
 *   ceiling exists to bound work, and the measurement needs only the parsed
 *   document - no schema build, no resolver. Refusing on the measurement
 *   keeps the over-deep query from ever reaching buildContentSchema on a
 *   cold cache. The second parse inside executeGraphql is the price, and a
 *   parse is the cheapest thing on that path.
 *
 *   What the rule receives. `effectiveGraphqlDepth` hands the CF-2 rule the
 *   smaller of the two numbers, so a workspace that sets maxDepth above the
 *   ceiling is clamped silently rather than rejected at boot: a ceiling bug
 *   must never take a workspace's GraphQL down, it may only tighten it.
 */
import type { GatewayRequestContext, WorkspaceProject } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { effectiveRequestLimits, recordLimitRefusal } from './request-limits'
import { resolveRoutePolicy } from './route-policy'

/** The row the ceiling resolves against: the mount itself, so its own narrowing applies. */
const GRAPHQL_ROUTE = () => resolveRoutePolicy('POST', '/api/v1/graphql')

/**
 * The ceiling for one workspace and environment.
 * @param project - The workspace, when known.
 * @param envSlug - The environment slug, when known.
 * @returns The deepest selection-set nesting the Gateway lets through.
 */
export function graphqlDepthCeiling(project: WorkspaceProject | undefined): number {
  return effectiveRequestLimits(project, GRAPHQL_ROUTE()).maxGraphqlDepth
}

/**
 * What the CF-2 rule is given: the tenant's number when it is tighter, the
 * ceiling otherwise. A maxDepth below 1 means "no rule" in @tangen/graphql,
 * and that is not an option under a ceiling.
 * @param configured - The resolved `graphql.maxDepth`.
 * @param ceiling - The resolved `requestLimits.maxGraphqlDepth`.
 * @returns The depth to validate against.
 */
export function effectiveGraphqlDepth(configured: number, ceiling: number): number {
  if (!Number.isFinite(configured) || configured < 1) return ceiling
  return Math.min(configured, ceiling)
}

/**
 * Refuses a measured depth over the ceiling and records the outcome.
 * @param ctx - The Gateway context, when one is open.
 * @param depth - The document's measured depth.
 * @param ceiling - The resolved ceiling.
 * @throws RequestError 400 QUERY_TOO_DEEP when depth exceeds the ceiling.
 */
export function assertGraphqlDepth(ctx: GatewayRequestContext | undefined, depth: number, ceiling: number): void {
  if (depth <= ceiling) return
  recordLimitRefusal(ctx, { limit: 'maxGraphqlDepth', allowed: ceiling, observed: depth, via: 'graphql' })
  throw new RequestError(
    'QUERY_TOO_DEEP',
    `Query is too deep: ${depth} levels of nesting exceeds the maximum of ${ceiling} for this environment`,
    400,
  )
}
