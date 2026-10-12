/**
 * File Name: observe.ts
 * Purpose: Request observation for the SDK - lets tooling (the Tangen
 *          Toolbar, custom telemetry) watch every SDK request's timing plus
 *          the server's own numbers from the Server-Timing / X-Tangen-Qm
 *          response headers, without touching the request path.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Observers are fire-and-forget and individually
 *          try/catch'd - observability must never break a fetch. The server
 *          headers are emitted only while the API's Performance Monitor
 *          capture is on (dev by default), so serverTiming is undefined in
 *          production. SSR-safe: no browser globals.
 */

export interface ObservedServerTiming {
  /** Real query execution time on the server, ms. */
  dbMs: number
  /** Time queries spent waiting for a pooled connection, ms. */
  queueMs: number
  /** Number of SQL queries the request ran (X-Tangen-Qm only). */
  queries?: number
  /** Duplicate same-shape queries within the request (X-Tangen-Qm only). */
  dup?: number
}

export interface ObservedRequest {
  path: string
  method: string
  status: number
  /** Client-side wall time for this attempt, ms. */
  wallMs: number
  /** Present only when the API emitted timing headers (dev capture on). */
  serverTiming?: ObservedServerTiming
  /** Performance Monitor entry id from X-Tangen-Qm - the handle the toolbar
   *  uses to drill into per-query detail (qmDetail / the detail fetcher). */
  qmId?: string
}

export type RequestObserver = (info: ObservedRequest) => void

const observers = new Set<RequestObserver>()

/** +1 when a logical SDK request begins, -1 when it settles (success OR failure). */
export type InFlightObserver = (delta: 1 | -1) => void

const inFlightObservers = new Set<InFlightObserver>()

/**
 * Registers a process-wide observer for every SDK request (all clients).
 * Returns an unsubscribe function.
 */
export function observeRequests(cb: RequestObserver): () => void {
  observers.add(cb)
  return () => { observers.delete(cb) }
}

/**
 * Watches how many logical SDK requests are in flight (retries count as one).
 * Lets tooling like the SSR timings relay wait for a render's fetches to
 * settle instead of guessing with timeouts. Returns an unsubscribe function.
 */
export function observeInFlight(cb: InFlightObserver): () => void {
  inFlightObservers.add(cb)
  return () => { inFlightObservers.delete(cb) }
}

/** Internal - called by the http client around each logical request. */
export function notifyInFlight(delta: 1 | -1): void {
  for (const cb of inFlightObservers) {
    try { cb(delta) } catch { /* observers must never break requests */ }
  }
}

/** Internal - called by the http client once per received response. */
export function notifyObservers(info: ObservedRequest, configObserver?: RequestObserver): void {
  if (configObserver) {
    try { configObserver(info) } catch { /* observers must never break requests */ }
  }
  for (const cb of observers) {
    try { cb(info) } catch { /* observers must never break requests */ }
  }
}

/**
 * Parses the API's timing headers into a compact shape. Prefers X-Tangen-Qm
 * (`<id>;q=N;db=X;dup=D[;wait=W]`), falling back to Server-Timing
 * (`db;dur=X[, qwait;dur=Y]`). Returns undefined when neither is present.
 */
export function parseServerTiming(headers: Headers): ObservedServerTiming | undefined {
  const qm = headers.get('x-tangen-qm')
  if (qm) {
    const kv: Record<string, number> = {}
    for (const part of qm.split(';').slice(1)) {
      const [k, v] = part.split('=')
      const n = Number(v)
      if (k && Number.isFinite(n)) kv[k] = n
    }
    if (kv.q != null || kv.db != null) {
      return {
        dbMs: kv.db ?? 0,
        queueMs: kv.wait ?? 0,
        ...(kv.q != null ? { queries: kv.q } : {}),
        ...(kv.dup != null ? { dup: kv.dup } : {}),
      }
    }
  }
  const st = headers.get('server-timing')
  if (st) {
    const db = st.match(/(?:^|,)\s*db;dur=([\d.]+)/)?.[1]
    const qwait = st.match(/(?:^|,)\s*qwait;dur=([\d.]+)/)?.[1]
    if (db != null) return { dbMs: Number(db), queueMs: qwait != null ? Number(qwait) : 0 }
  }
  return undefined
}

/**
 * Extracts the Performance Monitor entry id from the X-Tangen-Qm header
 * (`<id>;q=N;db=X;dup=D[;wait=W]`). Undefined when the header is absent.
 */
export function parseQmId(headers: Headers): string | undefined {
  const id = headers.get('x-tangen-qm')?.split(';')[0]?.trim()
  return id || undefined
}

// ── Toolbar drill-down (key-scoped Performance Monitor detail) ───────────────

/** One query inside a captured request - redacted shape only, never raw SQL. */
export interface QmQueryDetail {
  /** Normalized statement shape with literal values stripped. */
  shape: string
  durationMs: number
  /** Time spent waiting for a pooled connection (present when > 0). */
  waitMs?: number
  error?: boolean
}

/** Per-request detail from GET /toolbar/qm/:entryId. */
export interface QmRequestDetail {
  id: string
  method: string
  path: string
  status?: number
  ts: string
  totalMs?: number
  dbMs: number
  waitMs: number
  queryCount: number
  droppedQueries: number
  dupCount: number
  queries: QmQueryDetail[]
}

/** Resolves a request's drill-down detail, or null when unavailable (404). */
export type QmDetailFetcher = (entryId: string) => Promise<QmRequestDetail | null>

let qmDetailFetcher: QmDetailFetcher | null = null

/**
 * Registers the process-wide detail fetcher the Tangen Toolbar uses to expand
 * a request row. createClient wires this automatically when the config sets
 * `toolbarDetail: true` - a key is never used for this silently. Pass null to
 * clear. Last registration wins (one site, one toolbar-enabled key).
 */
export function registerQmDetailFetcher(fetcher: QmDetailFetcher | null): void {
  qmDetailFetcher = fetcher
}

/** The currently registered drill-down fetcher (null when none opted in). */
export function getQmDetailFetcher(): QmDetailFetcher | null {
  return qmDetailFetcher
}
