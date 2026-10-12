/**
 * File Name: query-monitor.ts
 * Purpose: Query Monitor capture service - per-request query attribution via
 *   AsyncLocalStorage, an in-memory ring buffer of recent requests, SQL
 *   normalization for duplicate/N+1 grouping, and the enablement logic
 *   (runtime override > TANGEN_QUERY_MONITOR env > schemaWritable/dev).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Dev tool - nothing persists (per-process memory only,
 *   hard-bounded: ring of 200, 500 queries / 256KB SQL per entry, 2KB per
 *   statement). Parameter values are never captured (SQL is $1-parameterized
 *   text). The db-side tap is @tangen/db's setQueryHook (two-phase - see
 *   packages/db/src/instrument.ts); applyQmHookState() installs/clears it so
 *   "off" truly means zero per-query work.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { setQueryHook, type QueryEvent } from '@tangen/db'
import type { GatewayRequestContext } from '@tangen/types'
import { getSchemaWritable } from './schema-writable'

export const QM_RING_SIZE = 200
export const QM_MAX_QUERIES = 500
export const QM_MAX_SQL_CHARS = 2048
export const QM_MAX_SQL_BYTES = 262_144

export interface CapturedQuery {
  sql: string
  /** Execution time (socket write → settle); pool-queue wait is separate. */
  durationMs: number
  /** Time this query waited for a free pooled connection. */
  waitMs?: number
  error?: boolean
}

export interface CacheEvent {
  status: 'hit' | 'stale' | 'miss'
  typeName?: string
}

/** One filter transform that ran during the request (Extension Kernel K4.3). */
export interface FilterSpan {
  point: string
  extensionId: string
  /** The scope key the chain was compiled for (`contentType=post|locale=`). */
  scope: string
  ms: number
  outcome: 'applied' | 'unchanged' | 'skipped' | 'stopped' | 'rejected' | 'failed'
}

export interface RequestEntry {
  id: string
  method: string
  path: string
  /** Admin SPA route that fired the request (x-tangen-page header). */
  page?: string
  ts: string
  status?: number
  totalMs?: number
  workspaceId?: string
  memberId?: string
  /** API key that made the request (toolbar drill-down scoping). */
  apiKeyId?: string
  queries: CapturedQuery[]
  droppedQueries: number
  sqlChars: number
  cacheEvents: CacheEvent[]
  /** Filter transforms that ran (K4.3); bounded like queries. */
  filters?: FilterSpan[]
  dupGroups?: Array<{ normalized: string; count: number; totalMs: number }>
  finalized: boolean
  startedAt: number
  /**
   * Whether Query Monitor should actually capture this request. The Gateway
   * opens an entry for EVERY request so there is one AsyncLocalStorage and one
   * lifecycle rather than two - but "off" must still mean zero recording, so a
   * non-capturing entry takes no queries, sets no headers and never reaches the
   * ring. Entries opened by qmBegin default to true, which is what the Query
   * Monitor plugin on its own has always meant.
   */
  capture: boolean
  /** The Gateway's view of the same request (M1). Absent when unopened. */
  gateway?: GatewayRequestContext
  /**
   * The client connection that issued this write (X-Tangen-Origin), so the
   * events it causes can name it and the tab that made the change can tell
   * its own echo from a colleague's. See lib/write-origin.ts.
   */
  writeOrigin?: string | null
}

export const qmAls = new AsyncLocalStorage<RequestEntry>()

// ── Ring buffer (per-process) ─────────────────────────────────────────────────

let ring: RequestEntry[] = []

/** Finished requests, newest first. */
export function qmList(): RequestEntry[] {
  return [...ring].reverse()
}

export function qmGet(id: string): RequestEntry | undefined {
  return ring.find((e) => e.id === id)
}

export function qmClear(): void {
  ring = []
}

// ── Enablement ────────────────────────────────────────────────────────────────

let override: boolean | null = null

/** override (admin toggle) > TANGEN_QUERY_MONITOR env > dev (schemaWritable). */
export function qmEnabled(): boolean {
  if (override !== null) return override
  const env = process.env.TANGEN_QUERY_MONITOR
  if (env === '1') return true
  if (env === '0') return false
  return getSchemaWritable()
}

export function setQmOverride(v: boolean | null): void {
  override = v
  applyQmHookState()
}

// ── Capture ───────────────────────────────────────────────────────────────────

export function qmBegin(meta: { method: string; path: string; page?: string }): RequestEntry {
  return {
    id: randomUUID(),
    method: meta.method,
    path: meta.path,
    ...(meta.page ? { page: meta.page } : {}),
    ts: new Date().toISOString(),
    queries: [],
    droppedQueries: 0,
    sqlChars: 0,
    cacheEvents: [],
    finalized: false,
    startedAt: performance.now(),
    capture: true,
  }
}

/**
 * Is this a path the monitor watches? Excluded: everything outside /api/v1,
 * and the monitor's own surfaces (watching the watcher is noise).
 * @param path - Request pathname.
 * @returns Whether a capture should be opened for it.
 */
export function qmPathEligible(path: string): boolean {
  if (!path.startsWith('/api/v1/')) return false
  if (path.startsWith('/api/v1/admin/query-monitor')) return false
  if (path.startsWith('/api/v1/toolbar/qm')) return false
  return true
}

/**
 * The two-phase hook installed into @tangen/db: called at query-issue time
 * (the request's async context - ALS is correct HERE, not at settle time).
 * Returns the recorder for this query, or null to skip.
 */
export function qmHookFactory(): ((e: QueryEvent) => void) | null {
  const entry = qmAls.getStore()
  if (!entry || entry.finalized) return null
  return (e: QueryEvent) => {
    if (entry.finalized) return
    if (entry.queries.length >= QM_MAX_QUERIES || entry.sqlChars >= QM_MAX_SQL_BYTES) {
      entry.droppedQueries++
      return
    }
    const sql = e.sql.length > QM_MAX_SQL_CHARS ? e.sql.slice(0, QM_MAX_SQL_CHARS) : e.sql
    entry.sqlChars += sql.length
    entry.queries.push({
      sql,
      durationMs: Math.round(e.durationMs * 100) / 100,
      ...(e.waitMs != null ? { waitMs: Math.round(e.waitMs * 100) / 100 } : {}),
      ...(e.error ? { error: true } : {}),
    })
  }
}

/** Install/clear the db hook to match enablement - off = zero per-query work. */
export function applyQmHookState(): void {
  setQueryHook(qmEnabled() ? qmHookFactory : null)
}

/** Cache hit/miss attribution (called from route-cache inside the request). */
/** Record one filter transform into the active request's entry (no-op outside a monitored request). */
export function qmRecordFilter(span: FilterSpan): void {
  const entry = qmAls.getStore()
  if (!entry || entry.finalized) return
  const list = (entry.filters ??= [])
  if (list.length < QM_MAX_QUERIES) list.push(span)
}

/** Total filter time of a request, tenths of a millisecond. */
export function qmFilterMs(entry: Pick<RequestEntry, 'filters'>): number {
  return Math.round((entry.filters ?? []).reduce((n, f) => n + f.ms, 0) * 10) / 10
}

/**
 * The Server-Timing header for one request: `db` first (the Toolbar matches
 * it), `qwait` when the pool queued, `gateway` (plan 29.4) and `filters`
 * (K4.3) appended so existing matches stay untouched.
 */
export function serverTimingFor(entry: Pick<RequestEntry, 'queries' | 'gateway' | 'filters'>): string {
  const dbMs = Math.round(entry.queries.reduce((n, q) => n + q.durationMs, 0))
  const waitMs = Math.round(entry.queries.reduce((n, q) => n + (q.waitMs ?? 0), 0))
  const gatewayMs = entry.gateway?.gatewayMs
  const filterMs = qmFilterMs(entry)
  const steps = entry.filters?.length ?? 0
  return `db;dur=${dbMs};desc="${entry.queries.length} queries"`
    + (waitMs > 0 ? `, qwait;dur=${waitMs};desc="pool queue"` : '')
    + (typeof gatewayMs === 'number' ? `, gateway;dur=${Math.round(gatewayMs * 10) / 10};desc="policy+cors+limits"` : '')
    + (steps > 0 ? `, filters;dur=${filterMs};desc="${steps} transform${steps === 1 ? '' : 's'}"` : '')
}

export function qmRecordCache(status: CacheEvent['status'], typeName?: string): void {
  const entry = qmAls.getStore()
  if (!entry || entry.finalized) return
  if (entry.cacheEvents.length < 100) entry.cacheEvents.push({ status, ...(typeName ? { typeName } : {}) })
}

/**
 * Normalized SQL shape for duplicate/N+1 grouping: lowercased, whitespace
 * collapsed, all $N placeholders unified - so `IN ($1,$2,$3)` and `IN ($1)`
 * group as the same statement shape.
 */
export function normalizeSql(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\$\d+/g, '$?')
    .replace(/\(\s*\$\?(?:\s*,\s*\$\?)*\s*\)/g, '($?)')
    .trim()
    .slice(0, 500)
}

/**
 * Redacted statement shape for surfaces outside the admin (the key-scoped
 * toolbar drill-down): normalizeSql PLUS literal stripping - quoted string
 * literals (including an unterminated tail left by SQL truncation) and bare
 * numeric literals become `?`, so no literal value can ride along even if a
 * query was built with inline values instead of $N parameters.
 */
export function redactSqlShape(sql: string): string {
  let s = sql.replace(/'(?:''|[^'])*'/g, '?')
  // Truncated capture can end mid-literal: drop everything from an unmatched quote.
  const cut = s.indexOf("'")
  if (cut >= 0) s = `${s.slice(0, cut)}?`
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, '?')
  return normalizeSql(s)
}

/** Idempotent: fills response metadata, computes dup groups, pushes to the ring. */
export function qmFinalize(
  entry: RequestEntry | undefined,
  info: { status?: number; workspaceId?: string; memberId?: string; apiKeyId?: string },
): void {
  if (!entry || entry.finalized) return
  entry.finalized = true
  entry.status = info.status
  // A Gateway-opened entry on a request the monitor is not watching still
  // wants its timing filled in for the access log, but must not reach the ring.
  if (!entry.capture) {
    entry.totalMs = Math.round((performance.now() - entry.startedAt) * 100) / 100
    return
  }
  entry.workspaceId = info.workspaceId
  entry.memberId = info.memberId
  entry.apiKeyId = info.apiKeyId
  entry.totalMs = Math.round((performance.now() - entry.startedAt) * 100) / 100

  const groups = new Map<string, { count: number; totalMs: number }>()
  for (const q of entry.queries) {
    const key = normalizeSql(q.sql)
    const g = groups.get(key) ?? { count: 0, totalMs: 0 }
    g.count++
    g.totalMs += q.durationMs
    groups.set(key, g)
  }
  entry.dupGroups = [...groups.entries()]
    .filter(([, g]) => g.count > 1)
    .map(([normalized, g]) => ({ normalized, count: g.count, totalMs: Math.round(g.totalMs * 100) / 100 }))
    .sort((a, b) => b.count - a.count)

  ring.push(entry)
  if (ring.length > QM_RING_SIZE) ring.shift()
}
