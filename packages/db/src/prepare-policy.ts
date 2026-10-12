/**
 * File Name: prepare-policy.ts
 * Purpose: Make `TANGEN_DB_PREPARE=true` mean what it says for ordinary
 *   Drizzle queries, which postgres.js otherwise executes unprepared however
 *   the connection is configured.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is a compatibility shim, not a feature. postgres.js
 *   3.4 builds every `unsafe()` query with a per-query `prepare: false`:
 *
 *     // postgres/src/index.js
 *     function unsafe(string, args = [], options = {}) {
 *       const query = new Query([string], args, handler, cancel, {
 *         prepare: false, ...options, simple: ...
 *       })
 *
 *   and the connection resolves the two levels with the per-query value
 *   winning outright:
 *
 *     // postgres/src/connection.js
 *     q.prepare = options.prepare && ('prepare' in q.options ? q.options.prepare : true)
 *
 *   drizzle-orm 0.45's postgres-js session issues EVERY query as
 *   `client.unsafe(sql, params)` with no third argument, so no Drizzle query is
 *   ever prepared and each one pays Parse + Describe + Flush before
 *   Bind + Execute - two network round trips instead of one. Measured against a
 *   cloud database 23 ms away that is 47.7 ms per statement instead of 23.4 ms.
 *
 *   Upstream: drizzle-orm issue #6096, open as of 2026-08-28; 1.0.0-rc.4 does
 *   not address ordinary-query preparation for this driver.
 *
 *   REMOVAL CONDITION: when the installed drizzle-orm passes a preparation
 *   option through to `client.unsafe`, delete this file and its call in
 *   `createDb`. `prepare-policy.test.ts` fails loudly if that ever happens
 *   silently, because it asserts the third argument this shim adds.
 *
 *   Three properties are deliberate:
 *   1. It engages ONLY when preparation was explicitly asked for. Unset means
 *      today's behaviour, unchanged.
 *   2. It cannot force preparation on. postgres.js ANDs the connection-level
 *      flag first, so `prepare: false` on the pool stays genuinely unprepared
 *      even with this wrapper installed. Proven by test.
 *   3. It touches only parameterized queries. BEGIN/COMMIT/ROLLBACK carry no
 *      parameters, take the simple-query path, and are left byte-identical.
 */

/** Marks a client this policy has already wrapped; wrapping twice is a no-op. */
const APPLIED = '__tangenPreparePolicy'

/** postgres.js `unsafe(string, args?, options?)` in its three calling shapes. */
type UnsafeFn = (query: string, args?: unknown, opts?: unknown) => unknown

/**
 * Threads an explicit preparation policy through a postgres.js client, and
 * through the scoped clients `begin`/`savepoint`/`reserve` hand out, so
 * transaction-scoped Drizzle queries follow the same policy as ordinary ones.
 *
 * Composes with instrumentSql in either order: both wrap `unsafe` and both
 * recurse into the scoped clients, so Query Monitor capture is unaffected.
 *
 * @param sql - A postgres.js client, or a transaction/reserved scope of one.
 * @param prepare - True to ask for prepared execution. Anything else returns
 *   the client untouched, so the unprepared path keeps its exact behaviour.
 * @returns The same client instance, mutated in place (identity preserved).
 */
export function applyPreparePolicy<T extends object>(sql: T, prepare: boolean): T {
  if (!prepare) return sql
  const s = sql as unknown as Record<string, unknown>
  if (s[APPLIED]) return sql
  s[APPLIED] = true

  const origUnsafe = s.unsafe as UnsafeFn | undefined
  if (typeof origUnsafe === 'function') {
    s.unsafe = function (this: unknown, query: string, args?: unknown, opts?: unknown) {
      // `unsafe(string, options)` is a supported two-argument shape: a
      // non-array second argument IS the options object. Passing a third
      // argument would stop postgres.js collapsing it, so collapse it here.
      const twoArgOptions = args !== undefined && !Array.isArray(args)
      const params = twoArgOptions ? [] : ((args as unknown[] | undefined) ?? [])
      const given = (twoArgOptions ? args : opts) as Record<string, unknown> | undefined

      // Only parameterized statements are affected. A statement with no
      // parameters takes the simple-query path, which is already one round
      // trip and which transaction control depends on.
      if (params.length === 0) return origUnsafe.call(this, query, params, given ?? {})

      // An explicit per-call option always wins: this fills a gap, it does not
      // overrule a caller who has decided.
      const merged = given && 'prepare' in given ? given : { ...given, prepare: true }
      return origUnsafe.call(this, query, params, merged)
    } as UnsafeFn
  }

  // The scoped clients begin/savepoint/reserve hand out are fresh instances
  // with their own unsafe closures. Without recursion, every statement inside
  // a transaction would keep the old behaviour - which is most of a write.
  for (const key of ['begin', 'savepoint'] as const) {
    const orig = s[key] as ((a: unknown, b?: unknown) => unknown) | undefined
    if (typeof orig !== 'function') continue
    s[key] = function (this: unknown, first: unknown, second?: unknown) {
      const wrap = (f: (scoped: object) => unknown) => (scoped: object) => f(applyPreparePolicy(scoped, true))
      return typeof first === 'function'
        ? orig.call(this, wrap(first as (scoped: object) => unknown))
        : orig.call(this, first, wrap(second as (scoped: object) => unknown))
    }
  }

  const origReserve = s.reserve as (() => Promise<object>) | undefined
  if (typeof origReserve === 'function') {
    s.reserve = async function (this: unknown) {
      return applyPreparePolicy(await origReserve.call(this), true)
    }
  }

  return sql
}
