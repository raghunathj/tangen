/**
 * File Name: health.ts
 * Purpose: GET /api/health - liveness by default, readiness on ?deep=1.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The default answer touches NOTHING - some ops setups
 *   probe every few seconds and a health check that queries the database on
 *   each probe is its own outage. `?deep=1` is the opt-in readiness form: it
 *   pings Postgres and, when REDIS_URL is configured, Redis, and answers 503
 *   when either is down - so a load balancer can be pointed at the deep form
 *   and stop routing traffic into a process that cannot serve a request
 *   (finding #10: the old handler answered a static `ok` with a hardcoded
 *   version even while the database was unreachable).
 */
import { readFileSync } from 'node:fs'
import { getLogger } from '@tangen/logging'
import { detailMode, requestIdFor, type ErrorDetailMode } from '../../lib/internal-error'
import { fileURLToPath } from 'node:url'
import { redisDisabled } from '../../plugins/redis'

/**
 * The API's real published version - the one thing a health endpoint gets
 * scraped for; the old handler said '0.0.1' forever. Read at module init
 * (not a JSON import: the repo tsconfig has no resolveJsonModule).
 */
const VERSION: string = (() => {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')
    return String(JSON.parse(raw).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
})()

export interface HealthDeps {
  db: unknown
  redis: unknown
  /** What a failing probe may say: driver text on a developer machine, `unavailable` on a production-like deployment (the log gets the text). */
  mode?: ErrorDetailMode
  /** Overridable so tests control it; defaults to the plugin's env-derived flag. */
  redisDisabled?: boolean
}

interface CheckResult { ok: boolean; error?: string }

const log = getLogger(['tangen', 'api', 'health'])

async function checkPostgres(db: any): Promise<CheckResult> {
  try {
    const raw = db?.$rawClient ?? db?.session?.client
    if (!raw?.unsafe) return { ok: false, error: 'no database client' }
    await raw.unsafe('select 1')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function checkRedis(redis: any): Promise<CheckResult> {
  try {
    await redis.ping()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Builds the health response. Exported for tests; the route wires ctx into it.
 * @returns `{ status: 503? }` semantics are the CALLER's to apply from `ok`.
 */
export async function healthResponse(
  deep: boolean,
  deps: HealthDeps,
): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  if (!deep) {
    return { ok: true, body: { status: 'ok', version: VERSION } }
  }
  const checks: Record<string, CheckResult> = {
    postgres: await checkPostgres(deps.db),
  }
  // Redis is only a dependency when it is configured - an intentionally
  // Redis-less install (Postgres fallbacks) must not read as degraded.
  // Named apart from the imported predicate: a `const redisDisabled` here
  // shadowed it and threw "Cannot access 'redisDisabled' before
  // initialization" on every deep probe of a Redis-less install.
  const redisOff = deps.redisDisabled ?? redisDisabled()
  if (!redisOff) checks.redis = await checkRedis(deps.redis)
  // The health endpoint is public: on a production-like deployment a probe
  // failure names itself, not the driver's message (which can carry a host,
  // a database name or a credential). The message goes to the log instead.
  if ((deps.mode ?? detailMode()) === 'redact') {
    for (const [name, check] of Object.entries(checks)) {
      if (check.ok || !check.error) continue
      log.error(`health probe ${name} failed: ${check.error}`, { probe: name, requestId: requestIdFor(undefined) })
      check.error = 'unavailable'
    }
  }

  const ok = Object.values(checks).every((c) => c.ok)
  return {
    ok,
    body: { status: ok ? 'ok' : 'degraded', version: VERSION, checks },
  }
}
