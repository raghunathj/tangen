/**
 * File Name: search-governor.ts
 * Purpose: Search runs inside a budget it cannot exceed - concurrency, time,
 *   result count and page depth - and reports what it did.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This exists because search was measured misbehaving, not
 *   because it might. On a million-document corpus a term matching 5% of it
 *   took 2.3 seconds, and ONE client running such queries took the database
 *   cache-hit rate from 99.9% to 51% and halved OLTP throughput. Four heavy
 *   searchers in one workspace pushed an unrelated workspace's p99 from 2.8 ms
 *   to 105 ms.
 *
 *   So the defaults are deliberately mean. A search that cannot finish inside
 *   its statement timeout is cancelled by PostgreSQL rather than allowed to
 *   hold a pooled connection, and the caller is told the truth - a partial
 *   result with `truncated`, never a silent empty one.
 *
 *   The concurrency cap is the pool-isolation mechanism (constraint 10): it
 *   bounds how many of the shared connections search can occupy WITHOUT
 *   changing the pool size, which is the smallest safe thing that works.
 */
import { getLogger } from '@tangen/logging'

const logger = getLogger(['tangen', 'api', 'search'])

export interface SearchGovernanceConfig {
  /** Concurrent search queries per process. Caps the share of the DB pool. */
  maxConcurrent: number
  /** Additional queries allowed to wait; beyond this, search is refused. */
  maxQueued: number
  /** PostgreSQL statement_timeout for a search query, milliseconds. */
  statementTimeoutMs: number
  /** Hard ceiling on rows a single search may return, whatever was asked. */
  maxResults: number
  /** Deepest offset a caller may page to. */
  maxOffset: number
  /** Shortest query accepted; below this the engine is never asked. */
  minQueryLength: number
  /** Longest query accepted; beyond this it is truncated. */
  maxQueryLength: number
  /** Per-workspace concurrent searches. Shared infrastructure needs this. */
  maxConcurrentPerWorkspace: number
}

/**
 * Defaults sized for a shared deployment. `maxConcurrent` of 4 against a pool
 * of 10 leaves six connections for ordinary work under any search load, which
 * is the measured difference between a 10x foreground p95 and none.
 */
export const DEFAULT_SEARCH_GOVERNANCE: SearchGovernanceConfig = {
  maxConcurrent: 4,
  maxQueued: 16,
  statementTimeoutMs: 2_000,
  maxResults: 100,
  maxOffset: 1_000,
  minQueryLength: 2,
  maxQueryLength: 256,
  maxConcurrentPerWorkspace: 2,
}

export function resolveSearchGovernance(
  env: Record<string, string | undefined> = process.env,
): SearchGovernanceConfig {
  const num = (key: string, fallback: number) => {
    const n = Number(env[key])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const d = DEFAULT_SEARCH_GOVERNANCE
  return {
    maxConcurrent: num('TANGEN_SEARCH_MAX_CONCURRENT', d.maxConcurrent),
    maxQueued: num('TANGEN_SEARCH_MAX_QUEUED', d.maxQueued),
    statementTimeoutMs: num('TANGEN_SEARCH_TIMEOUT_MS', d.statementTimeoutMs),
    maxResults: num('TANGEN_SEARCH_MAX_RESULTS', d.maxResults),
    maxOffset: num('TANGEN_SEARCH_MAX_OFFSET', d.maxOffset),
    minQueryLength: d.minQueryLength,
    maxQueryLength: d.maxQueryLength,
    maxConcurrentPerWorkspace: num('TANGEN_SEARCH_MAX_PER_WORKSPACE', d.maxConcurrentPerWorkspace),
  }
}

/** Raised when a search is refused before it reaches the database. */
export class SearchRejected extends Error {
  constructor(readonly reason: 'overloaded' | 'query-too-short', message: string) {
    super(message)
    this.name = 'SearchRejected'
  }
  /** 422 for a query we will not run, 429 for capacity - never a 500. */
  get status(): number { return this.reason === 'overloaded' ? 429 : 422 }
  get code(): string { return this.reason === 'overloaded' ? 'SEARCH_BUSY' : 'VALIDATION_ERROR' }
}

/**
 * Turn a refusal into the RequestError a route should surface. A refusal is an
 * answer, not a fault: a caller must be able to tell "too short" from "try
 * again" from "the search failed", and none of them is a 500.
 */
export function asRequestError(err: unknown): { code: string; message: string; status: number } | null {
  if (!(err instanceof SearchRejected)) return null
  return { code: err.code, message: err.message, status: err.status }
}

/** What the governor has seen since the process started (constraint 19). */
export interface SearchMetrics {
  started: number
  completed: number
  timedOut: number
  rejectedOverloaded: number
  rejectedShort: number
  truncated: number
  active: number
  queued: number
  /** Latency samples, bounded; percentiles are computed on read. */
  durationsMs: number[]
  /** Searches per workspace, for shared-infrastructure visibility. */
  byWorkspace: Map<string, number>
  dbMsTotal: number
}

const MAX_SAMPLES = 1_000

/**
 * Admission control plus metrics. One instance per process; the engine asks it
 * for permission and reports what happened.
 */
export class SearchGovernor {
  private active = 0
  private queued = 0
  private perWorkspace = new Map<string, number>()
  private waiters: Array<{ resolve: () => void; reject: (e: Error) => void; workspaceId: string }> = []
  readonly metrics: SearchMetrics = {
    started: 0, completed: 0, timedOut: 0, rejectedOverloaded: 0, rejectedShort: 0,
    truncated: 0, active: 0, queued: 0, durationsMs: [], byWorkspace: new Map(), dbMsTotal: 0,
  }

  constructor(readonly config: SearchGovernanceConfig = resolveSearchGovernance()) {}

  /** Clamp a caller's request to what the deployment will actually allow. */
  clamp(limit: number, offset = 0): { limit: number; offset: number; clamped: boolean } {
    const l = Math.max(1, Math.min(Math.floor(limit) || 1, this.config.maxResults))
    const o = Math.max(0, Math.min(Math.floor(offset) || 0, this.config.maxOffset))
    return { limit: l, offset: o, clamped: l !== limit || o !== offset }
  }

  /** Normalise a query, or refuse it outright. */
  normalizeQuery(raw: string): string {
    const q = (raw ?? '').trim().slice(0, this.config.maxQueryLength)
    if (q.length < this.config.minQueryLength) {
      this.metrics.rejectedShort++
      throw new SearchRejected('query-too-short', `Search needs at least ${this.config.minQueryLength} characters`)
    }
    return q
  }

  /**
   * Hand the freed slot to the first waiter whose workspace is under its own
   * limit - not simply the first waiter. Otherwise one busy tenant sitting at
   * the head of the queue blocks every other tenant behind it, which is the
   * multi-tenant failure this class exists to prevent.
   */
  private release(): void {
    this.active--
    const i = this.waiters.findIndex(
      (w) => (this.perWorkspace.get(w.workspaceId) ?? 0) < this.config.maxConcurrentPerWorkspace,
    )
    if (i === -1) return
    const [next] = this.waiters.splice(i, 1)
    this.queued--
    this.active++
    this.perWorkspace.set(next!.workspaceId, (this.perWorkspace.get(next!.workspaceId) ?? 0) + 1)
    next!.resolve()
  }

  /**
   * Run `fn` inside the budget. Refuses rather than queues without bound, and
   * always releases its slot.
   */
  async run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const perWs = this.perWorkspace.get(workspaceId) ?? 0
    const admitNow = this.active < this.config.maxConcurrent && perWs < this.config.maxConcurrentPerWorkspace
    if (!admitNow) {
      if (this.queued >= this.config.maxQueued) {
        this.metrics.rejectedOverloaded++
        throw new SearchRejected('overloaded', 'Search is busy; try again shortly')
      }
      this.queued++
      this.metrics.queued = this.queued
      await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject, workspaceId }))
    } else {
      this.active++
      this.perWorkspace.set(workspaceId, perWs + 1)
    }

    this.metrics.started++
    this.metrics.active = this.active
    this.metrics.byWorkspace.set(workspaceId, (this.metrics.byWorkspace.get(workspaceId) ?? 0) + 1)
    const t0 = performance.now()
    try {
      const out = await fn()
      return out
    } finally {
      const ms = performance.now() - t0
      this.metrics.completed++
      this.metrics.dbMsTotal += ms
      if (this.metrics.durationsMs.length >= MAX_SAMPLES) this.metrics.durationsMs.shift()
      this.metrics.durationsMs.push(ms)
      const held = (this.perWorkspace.get(workspaceId) ?? 1) - 1
      if (held <= 0) this.perWorkspace.delete(workspaceId)
      else this.perWorkspace.set(workspaceId, held)
      this.release()
      this.metrics.active = this.active
      this.metrics.queued = this.queued
    }
  }

  /** Called by an engine when PostgreSQL cancelled the statement. */
  noteTimeout(query: string, workspaceId: string): void {
    this.metrics.timedOut++
    logger.warn(`search timed out after ${this.config.statementTimeoutMs}ms in ${workspaceId}: ${query.slice(0, 60)}`)
  }

  noteTruncated(): void { this.metrics.truncated++ }

  /** Snapshot for the observability surface. */
  snapshot(): Record<string, unknown> {
    const d = [...this.metrics.durationsMs].sort((a, b) => a - b)
    const p = (q: number) => (d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * q))]!.toFixed(1) : 0)
    return {
      started: this.metrics.started,
      completed: this.metrics.completed,
      timedOut: this.metrics.timedOut,
      rejected: { overloaded: this.metrics.rejectedOverloaded, tooShort: this.metrics.rejectedShort },
      truncated: this.metrics.truncated,
      active: this.metrics.active,
      queued: this.metrics.queued,
      latencyMs: { p50: p(0.5), p95: p(0.95), p99: p(0.99), samples: d.length },
      dbMsTotal: Math.round(this.metrics.dbMsTotal),
      limits: this.config,
      topWorkspaces: [...this.metrics.byWorkspace.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ workspaceId: id, searches: n })),
    }
  }
}

/** The process-wide governor. */
export const searchGovernor = new SearchGovernor()
