/**
 * File Name: list.ts
 * Purpose: Elysia route plugin for GET /api/v1/releases, listing workspace releases with optional
 *          filtering by source environment and status, ordered by creation date descending.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db releases table; member authentication is mandatory.
 */
import { Elysia } from 'elysia'
import { eq, and, desc } from 'drizzle-orm'
import { releases } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { RELEASE_STATUSES, isReleaseStatus } from '../../services/release-lifecycle'

export interface ReleaseListFilter {
  status: string | null
}

/**
 * Extracts the optional status filter from the request query params.
 * @param params - Parsed query params object
 * @returns ReleaseListFilter with a nullable status string
 */
export function buildReleaseListQuery(params: Record<string, unknown>): ReleaseListFilter {
  return {
    status: (params.status as string) ?? null,
  }
}

/**
 * Elysia plugin providing GET /api/v1/releases to list workspace releases, with optional env and status filters.
 * @returns Elysia plugin function
 */
export const releaseListRoute = (app: Elysia) =>
  app.get('/api/v1/releases', async (ctx: any) => {
    const { db, workspaceId, memberId, query } = ctx

    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)

    const filter = buildReleaseListQuery(query ?? {})
    if (filter.status && !isReleaseStatus(filter.status)) {
      throw new RequestError('VALIDATION_ERROR', `status must be one of ${RELEASE_STATUSES.join(', ')}`, 422)
    }

    const conditions = [eq(releases.workspaceId, workspaceId)]
    if (filter.status) {
      conditions.push(eq(releases.status, filter.status))
    }

    const rows = await db
      .select()
      .from(releases)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(releases.createdAt))

    return { data: rows }
  })
