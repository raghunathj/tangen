/**
 * File Name: cache-driver.ts
 * Purpose: The cache backend shim — redis when available, Postgres
 *          (cache_entries) as the fallback so caching keeps working (and
 *          keeps saving recomputation) without redis, no-op only when
 *          neither exists. route-cache keeps its public signatures; only
 *          its internals route through this driver.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: PG tags are stored scoped ('ws:env:tag') on the row
 *          (GIN indexed); tag-busting is one DELETE. Expired rows are
 *          pruned by the queue worker's housekeeping plus a light
 *          probabilistic prune on write.
 */

export interface CacheTagScope {
  workspaceId: string
  tags: string[]
}

export interface CacheDriver {
  name: 'redis' | 'postgres' | 'none'
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number, tagScope?: CacheTagScope): Promise<void>
  del(key: string): Promise<void>
  /** Deletes every entry tagged with (workspaceId, tag). */
  bustTag(workspaceId: string, tag: string): Promise<void>
  /** Redis-only legacy prefix bust (pg handles everything via tags). */
  bustPrefix?(pattern: string): Promise<void>
}

let _pgDb: any = null

/** Boot-time wiring — enables the Postgres fallback. */
export function configurePgCache(db: any): void {
  _pgDb = db
}

/** Test hook. */
export function resetPgCache(): void {
  _pgDb = null
}

const scopedTag = (ws: string, tag: string) => `${ws}:${tag}`

function pgExec(db: any) {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) return null
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}

function pgDriver(db: any): CacheDriver {
  const exec = pgExec(db)!
  return {
    name: 'postgres',
    async get(key) {
      const rows = await exec(
        `SELECT value FROM cache_entries WHERE key = $1 AND expires_at > now()`, [key],
      ).catch(() => [])
      return rows[0] ? String(rows[0].value) : null
    },
    async set(key, value, ttlSeconds, tagScope) {
      const tags = tagScope ? tagScope.tags.map((t) => scopedTag(tagScope.workspaceId, t)) : []
      await exec(
        `INSERT INTO cache_entries (key, value, tags, stored_at, expires_at)
         VALUES ($1, $2, $3, now(), now() + ($4 || ' seconds')::interval)
         ON CONFLICT (key) DO UPDATE SET value = $2, tags = $3, stored_at = now(),
           expires_at = now() + ($4 || ' seconds')::interval`,
        [key, value, tags, String(Math.max(1, Math.floor(ttlSeconds)))],
      ).catch(() => {})
      // Light probabilistic prune so expired rows never pile up unbounded
      if (Math.random() < 0.01) {
        await exec(`DELETE FROM cache_entries WHERE expires_at < now()`).catch(() => {})
      }
    },
    async del(key) {
      await exec(`DELETE FROM cache_entries WHERE key = $1`, [key]).catch(() => {})
    },
    async bustTag(workspaceId, tag) {
      await exec(
        `DELETE FROM cache_entries WHERE $1 = ANY(tags)`,
        [scopedTag(workspaceId, tag)],
      ).catch(() => {})
    },
  }
}

function redisDriver(redis: any): CacheDriver {
  return {
    name: 'redis',
    async get(key) {
      try { return (await redis.get(key)) ?? null } catch { return null }
    },
    async set(key, value, ttlSeconds, tagScope) {
      try {
        await redis.set(key, value, 'EX', ttlSeconds)
        if (tagScope) {
          for (const tag of tagScope.tags) {
            const tagKey = `tangen:qtag:${tagScope.workspaceId}:${tag}`
            await redis.sadd(tagKey, key)
            await redis.expire(tagKey, ttlSeconds + 60, 'GT').catch?.(() => {})
          }
        }
      } catch { /* cache write failure never blocks */ }
    },
    async del(key) {
      try { await redis.del(key) } catch { /* ignore */ }
    },
    async bustTag(workspaceId, tag) {
      try {
        const tagKey = `tangen:qtag:${workspaceId}:${tag}`
        const tagged: string[] = await redis.smembers(tagKey)
        if (tagged.length > 0) await redis.del(...tagged, tagKey)
        else await redis.del(tagKey)
      } catch { /* ignore */ }
    },
    async bustPrefix(pattern) {
      try {
        const keys: string[] = []
        let cursor = '0'
        do {
          const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
          cursor = String(next)
          keys.push(...(batch as string[]))
        } while (cursor !== '0')
        if (keys.length > 0) await redis.del(...keys)
      } catch { /* ignore */ }
    },
  }
}

const NONE: CacheDriver = {
  name: 'none',
  async get() { return null },
  async set() {},
  async del() {},
  async bustTag() {},
}

/**
 * Resolves the driver for a request: redis client when present, the
 * boot-configured Postgres fallback otherwise, no-op as the last resort.
 */
export function resolveCacheDriver(redis: any): CacheDriver {
  if (redis) return redisDriver(redis)
  if (_pgDb && pgExec(_pgDb)) return pgDriver(_pgDb)
  return NONE
}

/** Housekeeping hook for the queue worker. */
export async function pruneExpiredCacheEntries(db: any): Promise<void> {
  const exec = pgExec(db)
  if (!exec) return
  await exec(`DELETE FROM cache_entries WHERE expires_at < now()`).catch(() => {})
}
