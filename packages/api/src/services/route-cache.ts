/**
 * File Name: route-cache.ts
 * Purpose: Provides Redis-backed caching helpers for API routes, with fault-tolerant
 *          get/set/delete wrappers that swallow errors so a Redis outage never blocks requests.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires an ioredis-compatible Redis client passed at call-site;
 *                     imports CacheOptions from @tangen/types.
 */
import { getLogger } from '@tangen/logging'
import type { CacheOptions, CacheStrategy, SchemaDefinition } from '@tangen/types'

import { qmRecordCache } from '../lib/query-monitor'
import { resolveCacheDriver } from './cache-driver'
import { contentSchemaFingerprint } from '@tangen/schema'

export type { CacheStrategy }

const logger = getLogger(['tangen', 'cache'])

/**
 * Builds the namespaced Redis key for a route-cache entry.
 * @param workspaceId - The workspace identifier.
 * @param key - The caller-supplied cache key segment.
 * @returns A fully-qualified Redis key string under the `tangen:cr:` namespace.
 */
export function buildCacheKey(workspaceId: string, key: string): string {
  return `tangen:cr:${workspaceId}:${key}`
}

async function redisGet(redis: any, key: string): Promise<string | null | undefined> {
  return resolveCacheDriver(redis).get(key)
}

async function redisSet(redis: any, key: string, value: string, ttl: number): Promise<void> {
  return resolveCacheDriver(redis).set(key, value, ttl)
}

async function redisDel(redis: any, key: string): Promise<void> {
  return resolveCacheDriver(redis).del(key)
}

/**
 * Wraps an async function with Redis caching for API route responses.
 * @param redis - The ioredis client instance.
 * @param workspaceId - The workspace identifier used to namespace the cache key.
 * @param options - Cache options including the key segment and TTL in seconds.
 * @param fn - The async function whose result should be cached.
 * @returns The cached result on hit, or the fresh result on miss (null results are never cached).
 */
export async function withRouteCache<T>(
  redis: any,
  workspaceId: string,
  options: CacheOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const fullKey = buildCacheKey(workspaceId, options.key)

  const raw = await redisGet(redis, fullKey)
  if (raw !== null && raw !== undefined) {
    return JSON.parse(raw) as T
  }

  const result = await fn()

  // Null results are not cached — lets callers re-try until the resource exists
  if (result !== null) {
    await redisSet(redis, fullKey, JSON.stringify(result), options.ttl)
  }

  return result
}

/**
 * Deletes a single route-cache entry from Redis.
 * @param redis - The ioredis client instance.
 * @param workspaceId - The workspace identifier used to locate the cache key.
 * @param key - The caller-supplied key segment that identifies the entry to remove.
 */
export async function clearRouteCache(
  redis: any,
  workspaceId: string,
  key: string,
): Promise<void> {
  const fullKey = buildCacheKey(workspaceId, key)
  await redisDel(redis, fullKey)
}

// ─── Query Cache (tangen:qc namespace, with SWR support) ──────────────────────

type QueryCacheEntry<T> = { data: T; storedAt: number }

export function buildQueryCacheKey(
  workspaceId: string,
  typeName: string,
  queryKey: string,
): string {
  return `tangen:qc:${workspaceId}:${typeName}:${queryKey}`
}

const fingerprintMemo = new WeakMap<object, string>()

/**
 * The schema's fingerprint, memoized per schema OBJECT (the schema cache hands
 * out the same instance until it changes, so this hashes once per schema
 * generation, not once per request).
 */
export function cachedSchemaFingerprint(schema: SchemaDefinition): string {
  const cached = fingerprintMemo.get(schema as unknown as object)
  if (cached) return cached
  const fp = contentSchemaFingerprint(schema)
  fingerprintMemo.set(schema as unknown as object, fp)
  return fp
}

/**
 * The cache key of one query, including the SCHEMA it was answered under
 * (closure plan Phase 6B, Unit 4; audit finding C2). A cached result carries
 * the shape of the schema that produced it - a dropped field's values, a
 * renamed column's old name - so a schema push must not be able to serve it.
 * Folding the fingerprint into the key means a push makes every entry of the
 * old schema UNREACHABLE rather than requiring a flush to be delivered: it
 * works for the Redis and the Postgres backend, across processes, with no
 * notification to lose, and a push that failed changes no fingerprint and so
 * invalidates nothing. The unreachable entries expire on their own TTL.
 */
export function queryCacheKeyFor(schema: SchemaDefinition, queryKey: string): string {
  return `${cachedSchemaFingerprint(schema)}.${queryKey}`
}

/** Redis set holding the cache keys of every query whose result touches `typeName`. */
export function buildQueryTagKey(workspaceId: string, typeName: string): string {
  return `tangen:qtag:${workspaceId}:${typeName}`
}

/**
 * Options for withQueryCache beyond the client-supplied CacheStrategy.
 */
export interface QueryCacheOptions {
  /** Every content type the result can include (base + expansion targets); defaults to [typeName]. */
  tags?: string[]
  /** Skip the cache read (Cache-Control: no-cache) — the fresh result is still stored. */
  noCacheRead?: boolean
}

/**
 * Walks the schema to find every content type a query on `typeName` can touch:
 * the base type, relation targets to `depth` levels (transitively), object-field
 * include types, and 'media' when any visited type has media fields. These become
 * the entry's invalidation tags, so a write to ANY of them busts the cached query —
 * fixing stale populated relations.
 */
export function collectQueryTags(schema: SchemaDefinition, typeName: string, depth: number): string[] {
  const tags = new Set<string>([typeName])
  let frontier = [typeName]
  let hasMedia = false

  const visit = (name: string) => schema.types.find(t => t.name === name)

  const base = visit(typeName)
  if (base?.fields.some(f => f.fieldType === 'media')) hasMedia = true

  for (let level = 0; level < Math.max(0, depth); level++) {
    const next: string[] = []
    for (const name of frontier) {
      const typeDef = visit(name)
      if (!typeDef) continue
      for (const f of typeDef.fields) {
        const cfg = f.config as Record<string, unknown> | undefined
        const targets: string[] = []
        if (f.fieldType === 'relation' && typeof cfg?.targetType === 'string') targets.push(cfg.targetType)
        if (f.fieldType === 'object' && Array.isArray(cfg?.include)) targets.push(...(cfg.include as string[]))
        if (f.fieldType === 'media') hasMedia = true
        for (const t of targets) {
          if (!tags.has(t)) {
            tags.add(t)
            next.push(t)
          }
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  if (hasMedia) tags.add('media')
  return Array.from(tags)
}

/** Annotates a QueryResult-shaped value with how the cache served it. */
function markCacheStatus<T>(value: T, status: 'hit' | 'stale' | 'miss'): T {
  if (value && typeof value === 'object' && 'meta' in (value as Record<string, unknown>)) {
    const meta = (value as Record<string, unknown>).meta
    if (meta && typeof meta === 'object') {
      return { ...(value as Record<string, unknown>), meta: { ...meta, cache: status } } as T
    }
  }
  return value
}


/**
 * Cache wrapper for read queries with optional stale-while-revalidate support.
 *
 * On hit within TTL      → serves cached data, no fn() call.
 * On hit in SWR window   → returns stale data immediately, fires fn() in background.
 * On miss / past SWR     → calls fn(), stores result with storedAt timestamp.
 * Redis unavailable       → falls through to fn(), no error thrown.
 * Null results           → never cached.
 */
export async function withQueryCache<T>(
  redis: any,
  workspaceId: string,
  typeName: string,
  queryKey: string,
  strategy: CacheStrategy,
  fn: () => Promise<T>,
  opts?: QueryCacheOptions,
): Promise<T> {
  const fullKey = buildQueryCacheKey(workspaceId, typeName, queryKey)
  const { ttl, swr = 0 } = strategy
  const tags = opts?.tags && opts.tags.length > 0 ? opts.tags : [typeName]
  const now = Date.now()

  let entry: QueryCacheEntry<T> | null = null
  if (!opts?.noCacheRead) {
    try {
      const raw = await resolveCacheDriver(redis).get(fullKey)
      if (raw) {
        entry = JSON.parse(raw) as QueryCacheEntry<T>
      }
    } catch {
      // Redis unavailable — skip cache, fall through to DB
    }
  }

  if (entry) {
    const ageMs = now - entry.storedAt
    const ttlMs = ttl * 1000
    const swrMs = swr * 1000

    if (ageMs <= ttlMs) {
      qmRecordCache('hit', typeName)
      return markCacheStatus(entry.data, 'hit')
    }

    if (swr > 0 && ageMs <= ttlMs + swrMs) {
      // SWR window — return stale immediately, revalidate in background
      fn()
        .then(async freshData => {
          if (freshData !== null) {
            const newEntry: QueryCacheEntry<unknown> = { data: freshData, storedAt: Date.now() }
            await resolveCacheDriver(redis)
              .set(fullKey, JSON.stringify(newEntry), ttl + swr, { workspaceId, tags })
              .catch(() => { /* background revalidation failure is silent */ })
          }
        })
        .catch(() => {})
      qmRecordCache('stale', typeName)
      return markCacheStatus(entry.data, 'stale')
    }
    // Fully expired — fall through
  }

  const result = await fn()
  if (result !== null) {
    const newEntry: QueryCacheEntry<T> = { data: result, storedAt: Date.now() }
    await resolveCacheDriver(redis)
      .set(fullKey, JSON.stringify(newEntry), ttl + swr + 1, { workspaceId, tags })
      .catch(() => { /* SET failure - still return result */ })
  }
  qmRecordCache('miss', typeName)
  return markCacheStatus(result, 'miss')
}


/**
 * Clears all cached queries touching a given type.
 * Called on every write (create / update / delete / publish / unpublish / bulkUpdate).
 * Primary mechanism is the type's tag set — it also holds queries on OTHER types
 * that populated this one (fixes stale populated relations). The legacy same-type
 * prefix SCAN remains as a safety net for entries written without tags.
 */
export async function clearTypeQueryCache(
  redis: any,
  workspaceId: string,
  typeName: string,
): Promise<void> {
  const driver = resolveCacheDriver(redis)
  // Tag-based (cross-type) bust — pg deletes by scoped tag, redis by tag set
  await driver.bustTag(workspaceId, typeName)
  // Legacy same-type prefix bust (redis only; pg entries always carry tags)
  await driver.bustPrefix?.(`tangen:qc:${workspaceId}:${typeName}:*`)
}
