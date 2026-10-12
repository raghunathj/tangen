/**
 * File Name: response.ts
 * Purpose: Provides standard response envelope helpers (ok, created, paginated, noContent) to produce consistent JSON shapes across all API routes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

/**
 * Standard 200 success envelope.
 *
 * @example
 * return ok(user)
 * return ok(users, { total: 100 })
 */
export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return meta ? { data, meta } : { data }
}

/**
 * Standard 201 created envelope. Set ctx response status separately if needed.
 *
 * @example
 * set.status = 201
 * return created(user)
 */
export function created<T>(data: T) {
  return { data }
}

/**
 * Paginated list envelope — pairs with `paginate()`.
 *
 * @example
 * const { page, limit, offset } = paginate(ctx)
 * const users = await fetchUsers(offset, limit)
 * return paginated(users, total, { page, limit })
 */
export function paginated<T>(
  data: T[],
  total: number,
  pagination: { page: number; limit: number },
) {
  const { page, limit } = pagination
  return {
    data,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  }
}

/**
 * Empty 204 response placeholder. Caller must set status = 204.
 *
 * @example
 * set.status = 204
 * return noContent()
 */
export function noContent() {
  return null
}
