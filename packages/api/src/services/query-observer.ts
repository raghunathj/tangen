/**
 * File Name: query-observer.ts
 * Purpose: The seam a later Telemetry can listen on without reopening the
 *          query compiler (closure plan Phase 6A, Unit 9; audit finding
 *          Q10, "query cost is not observable per request in production").
 *          One structured fact per content read - what was asked for, how
 *          long it took, how much came back, whether a cache answered - and
 *          nothing else: no product, no storage, no timer, no route.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: WHAT IT IS NOT. It persists nothing and reaches no
 *          network: emitting with no observer registered is a length check.
 *          An observer that throws is contained, because a listener must
 *          never be able to fail a read. It carries no content, no filter
 *          VALUES, no SQL, no credentials and no request body - only the
 *          shape facts listed below, so a consumer cannot accidentally
 *          become a content log. The Query Monitor (lib/query-monitor.ts)
 *          keeps its own request-level ring; this is per query and always
 *          available, and the two coexist - `statements` is read from the
 *          monitor when it happens to be running.
 */

/** What one content read cost. Shape facts only - never a value from the data. */
export interface QueryFacts {
  /** The request this read belongs to (`X-Tangen-Request-Id`), when there is one. */
  requestId: string | null
  workspaceId: string
  /** The content type read. */
  type: string
  /** Which read surface: a list query, a single object, a slug lookup. */
  operation: 'query' | 'get' | 'by-slug'
  /** Wall-clock milliseconds, rounded to a tenth. */
  durationMs: number
  /** Rows in the response. */
  rows: number
  /** The exact total when the query asked for one. */
  total: number | null
  /** Expansion depth the read ran at, after any clamp. */
  depth: number
  /** How a cache answered, when one was consulted. */
  cache: 'hit' | 'stale' | 'miss' | null
  /** SQL statements, when something is counting them (the Query Monitor). */
  statements: number | null
  /** Did the read succeed? */
  ok: boolean
  /** The error's stable code when it did not - never the message. */
  errorCode: string | null
}

export type QueryObserver = (facts: QueryFacts) => void

const observers = new Set<QueryObserver>()

/**
 * Registers an observer and returns the function that removes it. A
 * consumer that registers twice is one observer; one that throws is
 * ignored, not propagated.
 */
export function observeQueries(fn: QueryObserver): () => void {
  observers.add(fn)
  return () => { observers.delete(fn) }
}

/** How many observers are listening. Diagnostics and tests. */
export function queryObserverCount(): number {
  return observers.size
}

/** Removes every observer. For a test that registered one. */
export function resetQueryObservers(): void {
  observers.clear()
}

/**
 * Hands the facts to every observer. Costs a `size` check when nobody is
 * listening, which is the deployed case until Telemetry exists.
 */
export function emitQueryFacts(facts: QueryFacts): void {
  if (observers.size === 0) return
  for (const observer of observers) {
    try { observer(facts) } catch { /* an observer must never fail a read */ }
  }
}
