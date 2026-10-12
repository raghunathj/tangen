/**
 * File Name: request.ts
 * Purpose: Provides typed helpers for extracting and validating incoming request data — pagination, path params, query params, and auth tokens.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types for RouteContext and RouteError.
 */
import { RouteError } from '@tangen/types'
import type { RouteContext } from '@tangen/types'

/**
 * Parsed pagination parameters derived from ?page= and ?limit= query strings.
 */
export interface PaginationResult {
  page: number
  limit: number
  offset: number
}

/**
 * Extract page/limit from query params with safe defaults.
 * Respects ?page= and ?limit= — clamps limit to maxLimit (default 100).
 *
 * @example
 * const { page, limit, offset } = paginate(ctx)
 * const { page, limit, offset } = paginate(ctx, { defaultLimit: 10, maxLimit: 50 })
 */
export function paginate(
  ctx: RouteContext,
  options?: { defaultLimit?: number; maxLimit?: number },
): PaginationResult {
  const defaultLimit = options?.defaultLimit ?? 20
  const maxLimit = options?.maxLimit ?? 100
  const page = Math.max(1, parseInt(ctx.query.page ?? '1', 10) || 1)
  const limit = Math.min(maxLimit, Math.max(1, parseInt(ctx.query.limit ?? String(defaultLimit), 10) || defaultLimit))
  return { page, limit, offset: (page - 1) * limit }
}

/**
 * Get a required path param, throwing 400 if missing.
 *
 * @example
 * const id = requireParam(ctx, 'id')
 */
export function requireParam(ctx: RouteContext, name: string): string {
  const val = ctx.params[name]
  if (!val) throw new RouteError(400, `Missing required path parameter: ${name}`)
  return val
}

/**
 * Get a required query param, throwing 400 if missing.
 *
 * @example
 * const token = requireQuery(ctx, 'token')
 */
export function requireQuery(ctx: RouteContext, name: string): string {
  const val = ctx.query[name]
  if (!val) throw new RouteError(400, `Missing required query parameter: ${name}`)
  return val
}

/**
 * Get a Bearer token from the Authorization header, or null if absent.
 *
 * @example
 * const token = bearerToken(ctx)
 */
export function bearerToken(ctx: RouteContext): string | null {
  const auth = ctx.headers['authorization']
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7) || null
}
