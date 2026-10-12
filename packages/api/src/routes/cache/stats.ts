/**
 * File Name: stats.ts
 * Purpose: Admin route and pure helpers for reporting Redis memory usage and schema-cache
 *          hit/miss statistics for a given environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, ioredis, @tangen/services/schema-cache; admin permission required;
 *                     SCHEMA_HIT_KEY and SCHEMA_MISS_KEY are re-exported for test convenience
 */
import { Elysia } from 'elysia'
import type { Redis } from 'ioredis'
import { RequestError } from '../../lib/errors'
import { SCHEMA_CACHE_KEY, SCHEMA_HIT_KEY, SCHEMA_MISS_KEY, schemaProcessCacheStats } from '../../services/schema-cache'

// Re-export so tests can import from this file directly
export { SCHEMA_HIT_KEY, SCHEMA_MISS_KEY }

// ─── Pure helpers (testable without Redis) ────────────────────────────────────

export interface RedisMemoryInfo {
  usedMemory: number
  usedMemoryHuman: string
  maxMemory: number
  maxMemoryHuman: string
}

/**
 * Parses the raw string returned by Redis INFO memory into a typed RedisMemoryInfo object.
 * @param info - The raw multi-line string from the `redis.info('memory')` command
 * @returns Structured memory usage with numeric bytes and human-readable strings
 */
export function parseRedisMemoryInfo(info: string): RedisMemoryInfo {
  function extract(key: string): string | null {
    const match = info.match(new RegExp(`^${key}:(.+)$`, 'm'))
    return match ? match[1].trim() : null
  }

  return {
    usedMemory: parseInt(extract('used_memory') ?? '0', 10) || 0,
    usedMemoryHuman: extract('used_memory_human') ?? '-',
    maxMemory: parseInt(extract('maxmemory') ?? '0', 10) || 0,
    maxMemoryHuman: extract('maxmemory_human') ?? '-',
  }
}

export interface SchemaCacheStats {
  exists: boolean
  ttl: number
  hits: number
  misses: number
  hitRate: number
}

/**
 * Computes schema-cache statistics including hit rate from raw hit and miss counts.
 * @param input - Raw hit, miss, TTL, and existence data read from Redis
 * @returns A SchemaCacheStats object with a calculated hitRate percentage (0–100)
 */
export function buildCacheStats(input: {
  hits: number
  misses: number
  ttl: number
  exists: boolean
}): SchemaCacheStats {
  const total = input.hits + input.misses
  const hitRate = total === 0 ? 0 : Math.round((input.hits / total) * 100)
  return {
    exists: input.exists,
    ttl: input.ttl,
    hits: input.hits,
    misses: input.misses,
    hitRate,
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin that registers GET /api/v1/admin/cache/stats; returns Redis memory info and schema-cache hit/miss stats.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the cache stats route registered
 */
export const cacheStatsRoute = (app: Elysia) =>
  app.get('/api/v1/admin/cache/stats', async (ctx: any) => {
    const { redis, workspaceId, permissions }: { redis: Redis; workspaceId: string; permissions: any } = ctx

    if (permissions?.admin !== true) {
      throw new RequestError('FORBIDDEN', 'Admin permission required', 403)
    }

    // ── Redis memory ──────────────────────────────────────────────────────────
    let redisConnected = true
    let memoryInfo: RedisMemoryInfo = {
      usedMemory: 0,
      usedMemoryHuman: '-',
      maxMemory: 0,
      maxMemoryHuman: '-',
    }

    try {
      const rawInfo = await redis.info('memory')
      memoryInfo = parseRedisMemoryInfo(rawInfo)
    } catch {
      redisConnected = false
    }

    // ── Schema cache ──────────────────────────────────────────────────────────
    const schemaKey = SCHEMA_CACHE_KEY()
    const [ttlRaw, hitsRaw, missesRaw] = await Promise.all([
      redis.ttl(schemaKey).catch(() => -2),
      redis.get(SCHEMA_HIT_KEY()).catch(() => null),
      redis.get(SCHEMA_MISS_KEY()).catch(() => null),
    ])

    const schemaCacheStats = buildCacheStats({
      exists: ttlRaw > -2,
      ttl: Math.max(ttlRaw, 0),
      hits: parseInt(hitsRaw ?? '0', 10) || 0,
      misses: parseInt(missesRaw ?? '0', 10) || 0,
    })

    // ── Query cache (tangen:qc entries + tangen:qtag tag sets) ────────────────
    let queryCache = { entries: 0, tagSets: 0, taggedEntries: 0, tags: {} as Record<string, number> }
    try {
      const scanAll = async (pattern: string) => {
        const keys: string[] = []
        let cursor = '0'
        do {
          const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
          cursor = String(next)
          keys.push(...(batch as string[]))
        } while (cursor !== '0')
        return keys
      }
      const [entryKeys, tagKeys] = await Promise.all([
        scanAll(`tangen:qc:${workspaceId}:*`),
        scanAll(`tangen:qtag:${workspaceId}:*`),
      ])
      const tags: Record<string, number> = {}
      let taggedEntries = 0
      for (const tagKey of tagKeys) {
        const typeName = tagKey.split(':').pop() as string
        const count = await redis.scard(tagKey).catch(() => 0)
        tags[typeName] = count
        taggedEntries += count
      }
      queryCache = { entries: entryKeys.length, tagSets: tagKeys.length, taggedEntries, tags }
    } catch {
      // Redis unavailable — leave zeros
    }

    return {
      data: {
        redis: {
          connected: redisConnected,
          ...memoryInfo,
        },
        schemaCache: {
          key: schemaKey,
          ...schemaCacheStats,
          // The in-process layer in front of Redis: what this process answered
          // itself, what it had to load, and how often a push told it to forget.
          process: schemaProcessCacheStats(),
        },
        queryCache,
      },
    }
  })
