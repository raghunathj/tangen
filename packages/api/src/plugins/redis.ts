/**
 * File Name: redis.ts
 * Purpose: Creates the ioredis client with lazy-connect and a one-retry strategy,
 *          and exposes it as an Elysia plugin so route handlers receive a `redis`
 *          context property.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Redis is optional — the client silences connection errors and
 *                     logs only the first warning so that the API starts cleanly when
 *                     Redis is unavailable. Caching features degrade gracefully.
 */
import { resolveProcessDatabaseUrl } from '../lib/process-database'
import Elysia from 'elysia'
import { Redis } from 'ioredis'
import { getLogger } from '@tangen/logging'
import { projectRedisPrefix } from '@tangen/db'
import { envSecretProvider } from '@tangen/types'

const logger = getLogger(['tangen', 'api', 'plugins'])

/**
 * Cache keys (schema, features, stats) are env-id scoped, and env ids are
 * global slugs (env_development) — two DIFFERENT projects sharing one Redis
 * would serve each other's cached schemas. Namespace every key by a
 * fingerprint of this project's database so a shared Redis stays isolated.
 */
// The same resolution plugins/db.ts uses, so the prefix names the database
// the process actually holds. A process that refuses to start (no URL on a
// deployed process) refuses in db.ts; here that is simply 'local'.
const dbUrl = ((): string => {
  try { return resolveProcessDatabaseUrl(process.env) } catch { return 'local' }
})()
// projectRedisPrefix (@tangen/db) is the SINGLE source of this prefix — the CLI's
// push invalidation derives it the same way so a DEL actually hits the API's key.
const keyPrefix = projectRedisPrefix(dbUrl)

// No REDIS_URL → still constructs a client (callers expect one), but pointed
// at a port that answers nothing so every command fails fast into the
// Postgres fallback. Silently borrowing whatever runs on localhost:6379 is
// how one project ends up reading another project's cache.
/**
 * True when no REDIS_URL is configured. Exported so features WITHOUT a
 * Postgres fallback can say "set REDIS_URL" instead of letting a command die
 * against the dead stub client below as "Connection is closed" (finding #15).
 */
/**
 * The process's Redis binding, set by boot from the resolved deployment
 * (plan-config-resolver section 12, amendment G). Before boot configures
 * it - a unit test mounting one plugin - the deployment's secret provider
 * answers REDIS_URL directly, which is the same source boot resolves.
 */
export type RedisState = 'enabled' | 'unset' | 'disabled'
let configured: { enabled: boolean; url: string | undefined } | null = null

export function configureRedis(binding: { enabled: boolean; url: string | undefined }): void {
  configured = binding
}

/** Tests only: forget the boot binding, so the provider answers again. */
export function resetRedisBinding(): void {
  configured = null
}

function binding(): { enabled: boolean; url: string | undefined } {
  return configured ?? { enabled: true, url: envSecretProvider().read('REDIS_URL') }
}

/** `disabled` was chosen (redis.enabled false); `unset` is enabled but no URL (reported, fallbacks serve); `enabled` has a URL. */
export function redisState(): RedisState {
  const b = binding()
  if (!b.enabled) return 'disabled'
  return b.url ? 'enabled' : 'unset'
}

/** True when no client should be used: switched off, or no URL. Callers with a PostgreSQL fallback check this first. */
export function redisDisabled(): boolean {
  return redisState() !== 'enabled'
}

/** The bound Redis URL, or undefined when Redis is unset or disabled. */
export function redisUrl(): string | undefined {
  return redisState() === 'enabled' ? binding().url : undefined
}

/**
 * The BullMQ connection every queue and worker uses. Unset or disabled Redis
 * points at a port that answers nothing, so a queue constructed by mistake
 * fails fast instead of borrowing whatever runs on localhost:6379.
 */
export function redisConnection(): { url: string; enableReadyCheck: false; maxRetriesPerRequest: number } {
  return { url: redisUrl() ?? 'redis://127.0.0.1:1', enableReadyCheck: false, maxRetriesPerRequest: null as unknown as number }
}

/**
 * The BullMQ options every queue and worker uses: the connection, and a key
 * prefix carrying the database fingerprint - the same dimension every other
 * Redis key of this process carries (projectRedisPrefix). Two deployments
 * on one Redis (a laptop and staging, say) therefore never consume each
 * other's jobs: a queue is DEPLOYMENT-scoped state, and its key says so.
 */
export function queueOptions(): { connection: ReturnType<typeof redisConnection>; prefix: string } {
  return { connection: redisConnection(), prefix: `${keyPrefix}bull` }
}

let _client: Redis | null = null
let _warned = false

/** Has the client been constructed yet? Diagnostics and the import-side-effect test. */
export function isRedisConstructed(): boolean {
  return _client !== null
}

/**
 * The process Redis client, constructed on first use - never at import
 * (closure plan Phase 3, Unit 2). `lazyConnect`, so no socket opens until
 * the first command either. Without REDIS_URL the client points at a port
 * nothing listens on and fails fast, which is what the Postgres fallbacks
 * key off; callers that can avoid it entirely check redisDisabled() first.
 */
export function getRedis(): Redis {
  if (_client) return _client
  // Unset or switched off is a configuration the fallbacks are built for, not
  // a fault: say so once as information. Only a BOUND Redis that cannot be
  // reached is worth a warning.
  if (redisState() !== 'enabled' && !_warned) {
    _warned = true
    logger.info(redisState() === 'disabled' ? 'Redis is switched off (REDIS_ENABLED=false): PostgreSQL serves the cache, queue and locks' : 'Redis is not configured: PostgreSQL serves the cache, queue and locks (set REDIS_URL to add it)')
  }
  _client = new Redis(binding().url ?? 'redis://127.0.0.1:1', {
    lazyConnect: true,
    connectTimeout: 3000,        // give up connecting after 3s (default is 10s)
    maxRetriesPerRequest: 0,     // reject commands immediately if not connected
    enableReadyCheck: false,
    keyPrefix,
    retryStrategy: (times) => {
      if (times > 1) return null // one retry, then give up permanently
      return 500
    },
  })
  _client.on('error', () => {
    if (!_warned) {
      logger.warn('Redis is bound (REDIS_URL) but not reachable - the cache, queue and locks fall back to PostgreSQL until it is')
      _warned = true
    }
  })
  return _client
}

/** The client's connection state: `none` before construction, then ioredis's own (`wait` = lazy, never connected). */
export function redisConnectionStatus(): string {
  return _client?.status ?? 'none'
}

/** Closes the client if one was constructed; a later getRedis() constructs a fresh one. */
export async function disposeRedis(): Promise<void> {
  const c = _client
  _client = null
  if (!c) return
  try { await c.quit() } catch { c.disconnect() }
}

/** Decorates every request with the client; built at compose time, not import. */
export const redisPlugin = () => new Elysia({ name: 'redis' })
  .decorate('redis', getRedis())
