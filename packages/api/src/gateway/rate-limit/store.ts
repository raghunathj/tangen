/**
 * File Name: store.ts
 * Purpose: Where rate-limit counters live - memory, Redis or Postgres -
 *          resolved the way the cache driver is, so "no Redis" is a supported
 *          configuration rather than a degraded one.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Plan section 28. A rate-limit store is a BACKEND and
 *          belongs in core: it must work with no Redis, on one process, on many,
 *          and on a serverless deployment where memory does not persist. The
 *          resolution order mirrors resolveCacheDriver exactly - explicit
 *          config, then Redis when configured, then Postgres when a db exists,
 *          then a bounded in-process Map.
 *
 *          Fixed window throughout. The existing service documented itself as
 *          sliding and was not (section 15); this one says what it is. A
 *          window is the same shape in every store: a counter and the instant
 *          it resets, and a hit past that instant starts a new one.
 *
 *          Fail-open on store ERROR is kept (D-5) - a cache outage must not
 *          become a service outage - but it is never silent: every occurrence
 *          is a warn and a counter, because silent fail-open is how a limit
 *          turns out to have been off for a month.
 */
import { getLogger } from '@tangen/logging'

export type RateLimitStoreKind = 'memory' | 'redis' | 'postgres'

export interface WindowState {
  /** Hits in the current window, this one included. */
  count: number
  /** Unix milliseconds when the window resets. */
  resetAt: number
}

export interface RateLimitStore {
  /** Atomically counts one hit and returns the window state. */
  hit(key: string, windowSec: number): Promise<WindowState>
  /**
   * A GAUGE rather than a window: adds `delta` (which may be negative or
   * zero) to a counter that never goes below zero and is forgotten `ttlSec`
   * after its last change, and returns the new value. Open realtime
   * connections are counted this way (R5): +1 on attach, -1 on close, 0 to
   * read. The TTL is leak insurance - a process that dies with sockets open
   * never sends its -1s, and a key nobody touches for that long starts over.
   */
  adjust(key: string, delta: number, ttlSec: number): Promise<number>
  /** Drops one counter, window or gauge. A success that ends a lockout, or a test. */
  forget(key: string): Promise<void>
  readonly kind: RateLimitStoreKind
  /** False when the store cannot be shared across processes. */
  readonly distributed: boolean
}

const logger = getLogger(['tangen', 'api', 'gateway', 'rate-limit'])

/** How many counters the memory store keeps before it drops the oldest. */
const MEMORY_MAX_KEYS = 10_000

/**
 * A fixed-window Map with the same crude eviction the env-role cache uses:
 * past the cap, the oldest entry goes. Correct on one process; a second
 * process does not see it, which `distributed: false` says out loud.
 */
export function memoryStore(now: () => number = Date.now, maxKeys = MEMORY_MAX_KEYS): RateLimitStore {
  const windows = new Map<string, WindowState>()
  return {
    kind: 'memory',
    distributed: false,
    async hit(key, windowSec) {
      const t = now()
      const current = windows.get(key)
      if (current && current.resetAt > t) {
        current.count += 1
        return { ...current }
      }
      const fresh = { count: 1, resetAt: t + windowSec * 1000 }
      windows.delete(key)
      windows.set(key, fresh)
      if (windows.size > maxKeys) {
        const oldest = windows.keys().next().value
        if (oldest !== undefined) windows.delete(oldest)
      }
      return { ...fresh }
    },
    async adjust(key, delta, ttlSec) {
      const t = now()
      const current = windows.get(key)
      const base = current && current.resetAt > t ? current.count : 0
      const next = Math.max(0, base + delta)
      windows.delete(key)
      windows.set(key, { count: next, resetAt: t + ttlSec * 1000 })
      return next
    },
    async forget(key) { windows.delete(key) },
  }
}

/**
 * The Redis window: INCR, EXPIRE on the first hit, TTL for the reset. The same
 * three commands services/rate-limiter.ts issues, so the ten hand-placed call
 * sites and the Gateway count in the same way.
 */
export function redisStore(redis: any): RateLimitStore {
  return {
    kind: 'redis',
    distributed: true,
    async hit(key, windowSec) {
      const count: number = await redis.incr(key)
      if (count === 1) await redis.expire(key, windowSec)
      const ttl: number = await redis.ttl(key)
      return { count, resetAt: Date.now() + Math.max(0, ttl) * 1000 }
    },
    async adjust(key, delta, ttlSec) {
      // INCRBY then clamp: a -1 that races a -1 must not leave the gauge
      // negative, and a negative gauge would admit one connection too many.
      let value: number = await redis.incrby(key, delta)
      if (value < 0) { await redis.set(key, 0); value = 0 }
      await redis.expire(key, ttlSec)
      return value
    },
    async forget(key) { await redis.del(key) },
  }
}

type Exec = (text: string, params?: unknown[]) => Promise<any[]>

function pgExec(db: any): Exec | null {
  const raw = db?.$rawClient ?? db?.session?.client
  if (!raw?.unsafe) return null
  return (text, params) => raw.unsafe(text, (params ?? []) as never)
}

/**
 * The Postgres window: one INSERT ... ON CONFLICT ... RETURNING per hit. The
 * CASE on `reset_at` is what makes it a window rather than a lifetime count,
 * and the single statement is what makes two processes agree.
 */
export function postgresStore(db: any): RateLimitStore {
  const exec = pgExec(db)
  if (!exec) throw new Error('postgresStore needs a raw SQL client')
  return {
    kind: 'postgres',
    distributed: true,
    async hit(key, windowSec) {
      const rows = await exec(
        `INSERT INTO rate_limit_counters (key, count, reset_at)
         VALUES ($1, 1, now() + ($2 || ' seconds')::interval)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limit_counters.reset_at <= now() THEN 1 ELSE rate_limit_counters.count + 1 END,
           reset_at = CASE WHEN rate_limit_counters.reset_at <= now() THEN now() + ($2 || ' seconds')::interval ELSE rate_limit_counters.reset_at END
         RETURNING count, reset_at`,
        [key, String(Math.max(1, Math.floor(windowSec)))],
      )
      const row = rows[0] ?? {}
      return { count: Number(row.count ?? 1), resetAt: new Date(row.reset_at ?? Date.now() + windowSec * 1000).getTime() }
    },
    async adjust(key, delta, ttlSec) {
      // The same table: `reset_at` is the gauge's expiry, refreshed on every
      // change, and an expired row starts from zero like a closed window.
      const rows = await exec(
        `INSERT INTO rate_limit_counters (key, count, reset_at)
         VALUES ($1, GREATEST(0, $2::integer), now() + ($3 || ' seconds')::interval)
         ON CONFLICT (key) DO UPDATE SET
           count = GREATEST(0, CASE WHEN rate_limit_counters.reset_at <= now() THEN 0 ELSE rate_limit_counters.count END + $2::integer),
           reset_at = now() + ($3 || ' seconds')::interval
         RETURNING count`,
        [key, String(Math.trunc(delta)), String(Math.max(1, Math.floor(ttlSec)))],
      )
      return Number(rows[0]?.count ?? 0)
    },
    async forget(key) { await exec(`DELETE FROM rate_limit_counters WHERE key = $1`, [key]) },
  }
}

/** Housekeeping for the queue worker: windows that have closed are dead rows. */
export async function pruneRateLimitCounters(db: any): Promise<void> {
  const exec = pgExec(db)
  if (!exec) return
  await exec(`DELETE FROM rate_limit_counters WHERE reset_at < now() - interval '1 hour'`).catch(() => {})
}

/**
 * Picks the store for this deployment (plan 28): explicit config, Redis when
 * configured, Postgres when a db is available, memory as the last resort.
 * `'auto'` is the default and means exactly that order.
 */
export function resolveRateLimitStore(
  opts: { redis?: any; db?: any; configured?: 'auto' | RateLimitStoreKind },
): RateLimitStore {
  const want = opts.configured ?? 'auto'
  if (want === 'memory') return memoryStore()
  if (want === 'redis' && opts.redis) return redisStore(opts.redis)
  if (want === 'postgres' && opts.db && pgExec(opts.db)) return postgresStore(opts.db)
  if (want !== 'auto') {
    logger.warn(`gateway.rateLimit.store asked for '${want}' which is not available here; falling back to the automatic order`)
  }
  if (opts.redis) return redisStore(opts.redis)
  if (opts.db && pgExec(opts.db)) return postgresStore(opts.db)
  return memoryStore()
}

let active: RateLimitStore | null = null

/**
 * The store this process counts in, for the callers that count outside the
 * Gateway hook (the setup and Porter attempt limiters): createServer sets it
 * to the store it resolved, so those budgets are shared across processes the
 * same way; before that, or in a test, a memory store.
 */
export function activeRateLimitStore(): RateLimitStore {
  if (!active) active = memoryStore()
  return active
}

/** Installs the process store; createServer calls it once per boot. */
export function setActiveRateLimitStore(store: RateLimitStore | null): void {
  active = store
}

let failures = 0

/** How many times a store error has let a request through. Exposed for tests and the monitor. */
export function storeFailureCount(): number { return failures }

/** Tests only. */
export function resetStoreFailureCount(): void { failures = 0 }

function noteFailure(store: RateLimitStore, what: string, err: unknown): void {
  failures += 1
  logger.warn(
    `rate-limit store (${store.kind}) failed on ${what}; allowing the request uncounted - this is fail-open, not a decision (x${failures})`,
    { event: 'gateway.ratelimit.store-failure', store: store.kind, error: err instanceof Error ? err.message : String(err), failures },
  )
}

/**
 * A hit that fails OPEN on a store error, loudly (D-5). The caller gets a
 * window state that allows the request and says nothing was counted.
 */
export async function hitOrOpen(store: RateLimitStore, key: string, windowSec: number): Promise<WindowState | null> {
  try {
    return await store.hit(key, windowSec)
  } catch (err) {
    noteFailure(store, 'hit', err)
    return null
  }
}

/** The gauge's fail-open twin: null means "unknown", never "zero". */
export async function adjustOrOpen(store: RateLimitStore, key: string, delta: number, ttlSec: number): Promise<number | null> {
  try {
    return await store.adjust(key, delta, ttlSec)
  } catch (err) {
    noteFailure(store, 'adjust', err)
    return null
  }
}
