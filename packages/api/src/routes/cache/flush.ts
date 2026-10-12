/**
 * File Name: flush.ts
 * Purpose: Admin route and supporting helpers for flushing Redis cache entries by scope
 *          (env-wide schema cache, all object keys, or a specific content type).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, ioredis, @tangen/services/schema-cache; admin permission required on all calls
 */
import { Elysia } from 'elysia'
import type { Redis } from 'ioredis'
import { RequestError } from '../../lib/errors'
import { SCHEMA_CACHE_KEY } from '../../services/schema-cache'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FlushPayload {
  scope: 'all' | 'type' | 'objects'
  typeSlug?: string
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Validates and parses the flush request body, ensuring scope is one of the accepted enum values.
 * @param body - The raw, untyped request body from Elysia context
 * @returns A validated FlushPayload; includes typeSlug only when scope is "type"
 */
export function buildFlushPayload(body: unknown): FlushPayload {
  const b = body as Record<string, unknown>
  const scope = b?.scope as string | undefined

  if (!scope || (scope !== 'all' && scope !== 'type' && scope !== 'objects')) {
    throw new RequestError('VALIDATION_ERROR', 'scope must be "all", "type", or "objects"', 422)
  }

  if (scope === 'type') {
    const typeSlug = (b?.typeSlug as string | undefined)?.trim()
    if (!typeSlug) {
      throw new RequestError('VALIDATION_ERROR', 'typeSlug is required when scope is "type"', 422)
    }
    return { scope, typeSlug }
  }

  return { scope }
}

/**
 * Builds the Redis SCAN glob pattern for flushing cached objects of a specific content type.
 * @param workspaceId - The workspace identifier
 * @param typeSlug - The content-type slug to scope the flush
 * @returns A Redis key pattern string with a trailing wildcard
 */
export function objectTypeFlushPattern(
  workspaceId: string,
  typeSlug: string,
): string {
  return `tangen:object:${workspaceId}:${typeSlug}:*`
}

/**
 * Builds the Redis SCAN glob pattern for flushing all cached objects across all types in an environment.
 * @param workspaceId - The workspace identifier
 * @returns A Redis key pattern string with a trailing wildcard covering all object types
 */
export function allObjectsFlushPattern(workspaceId: string): string {
  return `tangen:object:${workspaceId}:*`
}

// ─── Redis scan-delete ────────────────────────────────────────────────────────

async function scanAndDelete(redis: Redis, pattern: string): Promise<number> {
  let cursor = '0'
  let deleted = 0
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = nextCursor
    if (keys.length > 0) {
      await redis.del(...keys)
      deleted += keys.length
    }
  } while (cursor !== '0')
  return deleted
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin that registers POST /api/v1/admin/cache/flush; requires admin permission and removes Redis cache entries by scope.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the cache flush route registered
 */
export const cacheFlushRoute = (app: Elysia) =>
  app.post('/api/v1/admin/cache/flush', async (ctx: any) => {
    const { body, redis, workspaceId, permissions, set } = ctx

    if (permissions?.admin !== true) {
      throw new RequestError('FORBIDDEN', 'Admin permission required', 403)
    }

    const payload = buildFlushPayload(body)
    let flushed = 0

    // Always flush the schema cache for this env
    const schemaKey = SCHEMA_CACHE_KEY()
    const schemaDel = await redis.del(schemaKey).catch(() => 0)
    flushed += schemaDel

    // Flush object cache keys based on scope
    if (payload.scope === 'objects') {
      const pattern = allObjectsFlushPattern(workspaceId)
      flushed += await scanAndDelete(redis, pattern).catch(() => 0)
    } else if (payload.scope === 'type' && payload.typeSlug) {
      const pattern = objectTypeFlushPattern(workspaceId, payload.typeSlug)
      flushed += await scanAndDelete(redis, pattern).catch(() => 0)
    }

    set.status = 200
    return { flushed, scope: payload.scope, typeSlug: payload.typeSlug ?? null }
  })
