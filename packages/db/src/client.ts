/**
 * File Name: client.ts
 * Purpose: Creates and returns a typed Drizzle ORM database client backed by a
 *          postgres.js connection pool, with an `end()` helper for clean shutdown.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses drizzle-orm/postgres-js adapter. NOTICE-level messages
 *                     from PostgreSQL are suppressed; higher-severity messages are
 *                     forwarded to console.warn.
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { instrumentSql } from './instrument'
import { applyPreparePolicy } from './prepare-policy'

/** Connection pool tuning options for createDb. */
export interface DbPoolOptions {
  /** Maximum pool connections (postgres.js default: 10). */
  max?: number
  /** Seconds an idle connection is kept before being closed. */
  idleTimeout?: number
  /** Seconds to wait when establishing a connection. */
  connectTimeout?: number
  /**
   * Prepared execution for ordinary parameterized queries. Defaults to TRUE.
   * Set false only for a proxy or pooler that cannot carry named statements -
   * see `resolvePrepare` for the deployment contract.
   */
  prepare?: boolean
}

/** Where the effective preparation setting came from. */
export type PrepareSource = 'option' | 'env' | 'default'

/**
 * The preparation policy, and why. Tangen owns this contract rather than
 * inheriting postgres.js's default, so an unset variable has one documented
 * meaning instead of whatever the driver happens to do.
 *
 * Precedence, unchanged by the default flip: an explicit `poolOptions.prepare`
 * from a caller wins, then `TANGEN_DB_PREPARE`, then the default.
 *
 * The default is TRUE. Prepared execution removes one PostgreSQL protocol
 * round trip from every repeated parameterized statement, which on a remote
 * database is a large share of every read and write. Direct PostgreSQL and
 * PgBouncer session pooling support it; so does PgBouncer 1.21+ in transaction
 * pooling with `max_prepared_statements` above zero. A pooler or proxy that
 * cannot carry named statements needs `TANGEN_DB_PREPARE=false`, which is a
 * supported and permanent escape hatch, never overridden.
 *
 * Only the exact strings `true` and `false` are recognised; anything else is
 * treated as unset, and `tangen doctor` reports the effective value with its
 * source so a typo is visible rather than silent.
 *
 * @param opts - Explicit caller options.
 * @param env - Environment map (injectable for tests).
 * @returns The effective value and where it came from.
 */
export function resolvePrepare(
  opts: Pick<DbPoolOptions, 'prepare'> = {},
  env: Record<string, string | undefined> = process.env,
): { prepare: boolean; source: PrepareSource } {
  if (opts.prepare !== undefined) return { prepare: opts.prepare, source: 'option' }
  if (env.TANGEN_DB_PREPARE === 'false') return { prepare: false, source: 'env' }
  if (env.TANGEN_DB_PREPARE === 'true') return { prepare: true, source: 'env' }
  return { prepare: true, source: 'default' }
}

/**
 * Resolves postgres.js pool options from explicit options with env-var fallbacks
 * (TANGEN_DB_POOL_MAX, TANGEN_DB_IDLE_TIMEOUT, TANGEN_DB_CONNECT_TIMEOUT,
 * TANGEN_DB_PREPARE). Unset SIZE values are omitted so postgres.js defaults
 * apply; `prepare` is always set, because Tangen decides that one.
 * @param opts - Explicit pool options; win over environment variables.
 * @param env - Environment map (injectable for tests; defaults to process.env).
 * @returns Options object in postgres.js naming (max, idle_timeout, ...).
 */
export function resolvePoolOptions(
  opts: DbPoolOptions,
  env: Record<string, string | undefined> = process.env,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}

  const num = (explicit: number | undefined, envKey: string): number | undefined => {
    if (explicit !== undefined) return explicit
    const raw = env[envKey]
    if (raw === undefined) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }

  const max = num(opts.max, 'TANGEN_DB_POOL_MAX')
  if (max !== undefined) out.max = max
  const idle = num(opts.idleTimeout, 'TANGEN_DB_IDLE_TIMEOUT')
  if (idle !== undefined) out.idle_timeout = idle
  const connect = num(opts.connectTimeout, 'TANGEN_DB_CONNECT_TIMEOUT')
  if (connect !== undefined) out.connect_timeout = connect

  out.prepare = resolvePrepare(opts, env).prepare

  return out
}

/**
 * Creates a Drizzle database client wrapping a postgres.js connection pool.
 * @param databaseUrl - PostgreSQL connection string
 * @param poolOptions - Optional pool tuning; env vars used as fallback
 * @returns A Drizzle client extended with an `end()` method to close the pool
 */
export function createDb(databaseUrl: string, poolOptions: DbPoolOptions = {}) {
  const resolved = resolvePoolOptions(poolOptions)
  const client = postgres(databaseUrl, {
    ...resolved,
    onnotice: (n) => {
      if (n.severity !== 'NOTICE') console.warn(`[db] ${n.severity}: ${n.message}`)
    },
  })
  // Query Monitor tap: in-place, identity-preserving, inert until a hook is
  // installed via setQueryHook (one ref read per query when off).
  instrumentSql(client)
  // Preparation policy: postgres.js executes every drizzle query unprepared
  // whatever the pool says, so asking for it has to be threaded through by
  // hand. Engages ONLY on an explicit `true`, so an unset TANGEN_DB_PREPARE
  // keeps the behaviour it has today. See prepare-policy.ts.
  applyPreparePolicy(client, resolved.prepare === true)
  const db = drizzle(client, { schema })
  // $rawClient: the underlying postgres.js client — for features that need
  // parameterized raw SQL (e.g. @tangen/knowledge pgvector ops) without
  // reaching into drizzle internals.
  return Object.assign(db, { end: () => client.end(), $rawClient: client })
}

export type DbClient = ReturnType<typeof createDb>
