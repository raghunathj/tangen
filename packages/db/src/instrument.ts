/**
 * File Name: instrument.ts
 * Purpose: Query Monitor capture layer - wraps a postgres.js client so every
 *   query (drizzle funnels through client.unsafe(); raw call sites use it
 *   directly) reports { sql, durationMs } to a hook. Near-zero overhead when
 *   no hook is set (one ref read per query).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Three load-bearing details, all verified against
 *   drizzle-orm 0.45 postgres-js driver + postgres.js 3.4 sources:
 *   1. postgres.js Query is a LAZY Promise subclass - execution starts on the
 *      first .then/.execute. Drizzle mutates the query (.values()) before
 *      awaiting, so the wrapper must NEVER call .then itself; it patches the
 *      instance's handle/resolve/reject (own properties) for timing instead.
 *   2. resolve/reject fire in the connection socket's async context, where
 *      AsyncLocalStorage would misattribute. Hence the TWO-PHASE hook: the
 *      hook factory runs at unsafe()-call time (inside the caller's async
 *      chain, where ALS is correct) and returns a recorder that is invoked
 *      later at settle time.
 *   3. begin()/savepoint()/reserve() hand out FRESH scoped Sql instances with
 *      their own unsafe closures - they are instrumented recursively or
 *      transaction/reserved-connection queries would be invisible.
 */

export interface QueryEvent {
  /** Parameterized SQL text ($1 placeholders) - parameter VALUES are never captured. */
  sql: string
  /** Execution time: socket write → settle (excludes pool-queue wait). */
  durationMs: number
  /** Time spent queued waiting for a free pooled connection, when measurable. */
  waitMs?: number
  error?: boolean
}

/**
 * Two-phase hook: called at query-issue time (correct async context); returns
 * the recorder to invoke at settle time, or null to skip this query.
 */
export type QueryHook = () => ((e: QueryEvent) => void) | null

const hookRef: { current: QueryHook | null } = { current: null }

/** Install (or clear with null) the process-wide query hook. */
export function setQueryHook(hook: QueryHook | null): void {
  hookRef.current = hook
}

/** Patch one lazy Query instance for timing without forcing execution. */
function instrumentQuery(q: any, sqlText: string, record: (e: QueryEvent) => void): void {
  let start = performance.now()   // fallback if handle never fires (cached/errored early)
  let execStart: number | null = null
  const origHandle = q.handle
  q.handle = function (this: any, ...args: unknown[]) {
    if (!this.executed) start = performance.now()
    return origHandle.apply(this, args)
  }
  // q.active flips true exactly when a connection makes this query its
  // CURRENT one (verified postgres.js 3.4: connection.js:170 immediately on
  // an idle connection, :573 when the preceding pipelined query finishes;
  // resolve/reject set it back to false - falsy, ignored here). Trapping it
  // separates waiting (pool queue + pipeline) from real execution: with the
  // old creation→settle clock, a burst of concurrent requests counted all
  // that waiting as "db time" (8x inflation observed on a cold admin load).
  let activeVal = q.active
  Object.defineProperty(q, 'active', {
    configurable: true,
    get: () => activeVal,
    set: (v) => {
      if (execStart === null && v) execStart = performance.now()
      activeVal = v
    },
  })
  const origResolve = q.resolve
  const origReject = q.reject
  const settle = (error?: boolean) => {
    const now = performance.now()
    const waitMs = execStart !== null ? Math.max(0, execStart - start) : 0
    record({
      sql: sqlText,
      durationMs: now - (execStart ?? start),
      ...(waitMs >= 0.5 ? { waitMs } : {}),
      ...(error ? { error: true } : {}),
    })
  }
  q.resolve = (v: unknown) => { settle(); return origResolve(v) }
  q.reject = (e: unknown) => { settle(true); return origReject(e) }
}

/**
 * Instruments a postgres.js client (or a scoped tx/reserved instance) in
 * place - identity is preserved, so $rawClient consumers and duck-typed
 * checks ({ unsafe, release }) keep working. Idempotent.
 */
export function instrumentSql<T extends object>(sql: T): T {
  const s = sql as any
  if (s.__qmInstrumented) return sql
  s.__qmInstrumented = true

  const origUnsafe = s.unsafe
  if (typeof origUnsafe === 'function') {
    s.unsafe = function (this: any, query: string, args?: unknown, opts?: unknown) {
      const q = origUnsafe.call(this, query, args, opts)
      const record = hookRef.current?.()   // two-phase: capture recorder NOW
      if (record) instrumentQuery(q, query, record)
      return q
    }
  }

  if (typeof s.begin === 'function') {
    const origBegin = s.begin
    s.begin = function (this: any, options: any, fn?: any) {
      const wrap = (f: any) => (txSql: any) => f(instrumentSql(txSql))
      return typeof options === 'function'
        ? origBegin.call(this, wrap(options))
        : origBegin.call(this, options, wrap(fn))
    }
  }

  if (typeof s.savepoint === 'function') {
    const origSavepoint = s.savepoint
    s.savepoint = function (this: any, name: any, fn?: any) {
      const wrap = (f: any) => (spSql: any) => f(instrumentSql(spSql))
      return typeof name === 'function'
        ? origSavepoint.call(this, wrap(name))
        : origSavepoint.call(this, name, wrap(fn))
    }
  }

  if (typeof s.reserve === 'function') {
    const origReserve = s.reserve
    s.reserve = async function (this: any) {
      return instrumentSql(await origReserve.call(this))
    }
  }

  return sql
}
