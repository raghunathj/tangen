/**
 * File Name: preview-token-store.ts
 * Purpose: Storage for live-preview tokens — Redis when configured, the
 *   cache_entries Postgres table otherwise, and an actionable 503 when
 *   neither can take the write.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Preview used to call `redis.set` unconditionally, so a
 *   workspace without REDIS_URL got `500 Connection is closed` from the
 *   deliberately-dead stub client — a message naming neither Redis nor
 *   preview (finding #15). Tokens are short-lived rows, which is exactly what
 *   the cache_entries fallback already holds for the route cache, so Postgres
 *   keeps the "Redis is optional" promise here too.
 *
 *   This is NOT the cache driver, on purpose: the cache driver swallows write
 *   failures (right for a cache — a miss just recomputes). A swallowed token
 *   write would mint a token that validates as invalid, which is strictly
 *   worse than failing at mint time. Token writes throw.
 */
import { RequestError } from '../lib/errors'

interface StoreDeps {
  /** The request's redis client (may be the dead stub when REDIS_URL is unset). */
  redis: unknown
  /** The request's db — used for the Postgres fallback via cache_entries. */
  db: unknown
  /** True when no REDIS_URL is configured (plugins/redis.ts redisDisabled()). */
  redisDisabled: boolean
}

export interface PreviewTokenStore {
  put(key: string, json: string, ttlSeconds: number): Promise<void>
  get(key: string): Promise<string | null>
}

/** postgres.js raw executor off a drizzle db, or null when unavailable. */
function pgExec(db: any): ((text: string, params?: unknown[]) => Promise<any[]>) | null {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) return null
  return (text: string, params?: unknown[]) => raw.unsafe(text, (params ?? []) as never)
}

const UNAVAILABLE = new RequestError(
  'PREVIEW_STORE_UNAVAILABLE',
  'live preview needs a token store and none is available - set REDIS_URL in .env '
  + '(or ensure the database is reachable for the Postgres fallback)',
  503,
)

export function makePreviewTokenStore({ redis, db, redisDisabled }: StoreDeps): PreviewTokenStore {
  // No REDIS_URL: Postgres carries the tokens, same table as the route cache.
  if (redisDisabled) {
    const exec = pgExec(db)
    return {
      async put(key, json, ttlSeconds) {
        if (!exec) throw UNAVAILABLE
        await exec(
          `INSERT INTO cache_entries (key, value, tags, stored_at, expires_at)
           VALUES ($1, $2, '{}', now(), now() + ($3 || ' seconds')::interval)
           ON CONFLICT (key) DO UPDATE SET value = $2, stored_at = now(),
             expires_at = now() + ($3 || ' seconds')::interval`,
          [key, json, String(Math.max(1, Math.floor(ttlSeconds)))],
        ).catch(() => { throw UNAVAILABLE })
      },
      async get(key) {
        if (!exec) return null
        const rows = await exec(
          `SELECT value FROM cache_entries WHERE key = $1 AND expires_at > now()`,
          [key],
        ).catch(() => [])
        return rows[0] ? String(rows[0].value) : null
      },
    }
  }

  // REDIS_URL is set: use it, and if it is unreachable say SO - a token write
  // must never fail as a bare driver error or, worse, appear to succeed.
  const client = redis as { set: Function; get: Function }
  const down = (cause: unknown) => new RequestError(
    'PREVIEW_STORE_UNAVAILABLE',
    `live preview could not reach Redis (REDIS_URL is set but the server did not answer: `
    + `${cause instanceof Error ? cause.message : String(cause)}) - start Redis or unset `
    + `REDIS_URL to use the Postgres fallback`,
    503,
  )
  return {
    async put(key, json, ttlSeconds) {
      try {
        await client.set(key, json, 'EX', ttlSeconds)
      } catch (e) {
        throw down(e)
      }
    },
    async get(key) {
      try {
        return ((await client.get(key)) as string | null) ?? null
      } catch (e) {
        throw down(e)
      }
    },
  }
}
