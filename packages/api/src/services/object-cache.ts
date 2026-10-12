/**
 * File Name: object-cache.ts
 * Purpose: Provides Redis-backed per-object caching for content rows, with TTL resolution
 *          that respects workspace- and env-level cache configuration overrides.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The objectCacheKey helper is re-exported from
 *                     subscribers/cache-invalidation so that cache writes and invalidations
 *                     always use the same key format. Redis calls have a 500 ms timeout.
 */
import type { CacheConfig } from '@tangen/types'
import type { Redis } from 'ioredis'
import { objectCacheKey } from '../subscribers/cache-invalidation'

export { objectCacheKey }

const DEFAULT_TTL = 60

/**
 * Resolves the effective cache TTL for an object type.
 *
 * Resolution order (most specific wins):
 *   1. env.types[typeName]  — env type-level
 *   2. env.ttl              — env default (0 = disable all for this env)
 *   3. workspace.types[typeName] — workspace type-level
 *   4. workspace.ttl        — workspace default
 *   5. 60s built-in default
 *
 * Returns null if caching should be bypassed entirely for this type+env.
 */
export function resolveTypeCacheTtl(
  typeName: string,
  envCache: CacheConfig | undefined,
  workspaceCache: CacheConfig | undefined,
): number | null {
  // 1. env type-level (most specific — always wins)
  const envType = envCache?.types?.[typeName]
  if (envType !== undefined) {
    if (envType.cache === false) return null
    if (envType.ttl !== undefined) return envType.ttl > 0 ? envType.ttl : null
  }

  // 2. env default (0 means "no caching in this env")
  if (envCache?.ttl !== undefined) {
    return envCache.ttl > 0 ? envCache.ttl : null
  }

  // 3. workspace type-level
  const wsType = workspaceCache?.types?.[typeName]
  if (wsType !== undefined) {
    if (wsType.cache === false) return null
    if (wsType.ttl !== undefined) return wsType.ttl > 0 ? wsType.ttl : null
  }

  // 4. workspace default
  if (workspaceCache?.ttl !== undefined) {
    return workspaceCache.ttl > 0 ? workspaceCache.ttl : null
  }

  // 5. built-in default
  return DEFAULT_TTL
}

/**
 * Reads a cached raw object row from Redis.
 * Returns null on miss, Redis unavailability, or timeout.
 */
export async function readObjectCache(
  redis: Redis,
  key: string,
): Promise<Record<string, unknown> | null> {
  try {
    const cached = await Promise.race([
      redis.get(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ])
    if (!cached) return null
    return JSON.parse(cached) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Writes a raw object row to Redis with the given TTL.
 * Silently ignores Redis errors.
 */
export async function writeObjectCache(
  redis: Redis,
  key: string,
  row: Record<string, unknown>,
  ttl: number,
): Promise<void> {
  await redis.set(key, JSON.stringify(row), 'EX', ttl).catch(() => {})
}

/** The workspace's CacheConfig, as the loaded project carries it. */
export function resolveCacheConfig(
  project: import('@tangen/types').WorkspaceProject | undefined,
): CacheConfig | undefined {
  return (project?.config as { cache?: unknown } | undefined)?.cache as never
}
