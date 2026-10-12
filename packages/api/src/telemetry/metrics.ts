/**
 * File Name: metrics.ts
 * Purpose: The aggregate an operator reads (closure plan Phase 9C, Units 20,
 *          37 and 38): counters and bounded duration histograms per workspace
 *          x environment, with cardinality-safe labels and percentiles from
 *          bucket boundaries rather than from stored samples.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is NOT a time-series database. There is one live
 *          window per scope; nothing is retained over time, nothing is written
 *          anywhere, and a restart starts it over. Historical trends are a
 *          different product and Tangen does not need to become one to say
 *          "your p95 is 400ms and your error rate is 2%".
 */
import { scopeKey } from './ring'
import type { TelemetryEvent } from './contract'

/**
 * Fixed bucket boundaries in milliseconds. A percentile is reported as the
 * boundary of the bucket it falls in - approximate BY CONSTRUCTION, and
 * labelled as such, because the alternative is keeping every duration
 * forever to be exact about a number nobody needs to three decimal places.
 */
export const DURATION_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const

/**
 * The ONLY labels a metric may carry, per event. Everything cardinality-unsafe
 * - an id, a path, a message - lives on EVENTS in the ring and never here.
 */
export const METRIC_LABELS: Record<string, readonly string[]> = {
  'http.request.completed': ['method', 'statusClass'],
  'db.query.completed': ['operation', 'cache'],
  'cache.lookup.completed': ['result'],
  'job.run.completed': ['result'],
  'flow.execution.completed': ['result'],
  'flow.node.retry_scheduled': [],
  'release.apply.completed': ['result'],
  'extension.lifecycle.completed': ['operation', 'result'],
  'extension.http.completed': ['result'],
  'telemetry.events.dropped': ['reason'],
}

/** How many distinct label combinations one event may have before the rest
 *  collapse into `other`. A hard stop on accidental cardinality. */
export const MAX_SERIES_PER_EVENT = 24

interface Series {
  count: number
  failed: number
  /** One counter per bucket, plus an overflow slot. */
  buckets: number[]
  durationSum: number
  durationCount: number
  min: number
  max: number
}

interface ScopeMetrics {
  series: Map<string, Series>
  since: number
}

const scopes = new Map<string, ScopeMetrics>()

const newSeries = (): Series => ({
  count: 0, failed: 0,
  buckets: new Array(DURATION_BUCKETS_MS.length + 1).fill(0),
  durationSum: 0, durationCount: 0,
  min: Number.POSITIVE_INFINITY, max: 0,
})

/** `name{label=value,...}` - built only from allow-listed labels. */
function seriesKey(event: TelemetryEvent): string {
  const labels = METRIC_LABELS[event.name] ?? []
  const parts: string[] = []
  for (const label of labels) {
    const value = event.attributes?.[label]
    if (value === undefined) continue
    // A label value is a short scalar or it is not a label at all.
    const text = String(value)
    parts.push(`${label}=${text.length > 32 ? 'other' : text}`)
  }
  return parts.length ? `${event.name}{${parts.join(',')}}` : event.name
}

export function recordMetric(event: TelemetryEvent): void {
  const key = scopeKey(event.workspaceId)
  let scope = scopes.get(key)
  if (!scope) { scope = { series: new Map(), since: Date.now() }; scopes.set(key, scope) }

  let id = seriesKey(event)
  if (!scope.series.has(id) && scope.series.size >= MAX_SERIES_PER_EVENT) {
    // Cardinality stop: everything past the bound aggregates into one series
    // per event rather than growing without limit.
    id = `${event.name}{other}`
  }
  let series = scope.series.get(id)
  if (!series) { series = newSeries(); scope.series.set(id, series) }

  series.count++
  if (event.status === 'failed' || event.severity === 'error') series.failed++
  if (event.durationMs !== undefined) {
    const ms = event.durationMs
    let bucket: number = DURATION_BUCKETS_MS.length
    for (let i = 0; i < DURATION_BUCKETS_MS.length; i++) {
      if (ms <= DURATION_BUCKETS_MS[i]!) { bucket = i; break }
    }
    series.buckets[bucket]!++
    series.durationSum += ms
    series.durationCount++
    series.min = Math.min(series.min, ms)
    series.max = Math.max(series.max, ms)
  }
}

export interface SeriesSnapshot {
  series: string
  count: number
  failed: number
  /** Approximate: the boundary of the bucket the percentile falls in. */
  p50Ms: number | null
  p95Ms: number | null
  avgMs: number | null
  maxMs: number | null
}

export interface MetricsSnapshot {
  since: number
  series: SeriesSnapshot[]
}

/** The boundary of the bucket holding the requested quantile. */
function quantile(series: Series, q: number): number | null {
  if (series.durationCount === 0) return null
  const target = Math.ceil(series.durationCount * q)
  let seen = 0
  for (let i = 0; i < series.buckets.length; i++) {
    seen += series.buckets[i]!
    if (seen >= target) return i < DURATION_BUCKETS_MS.length ? DURATION_BUCKETS_MS[i]! : series.max
  }
  return series.max
}

export function metricsSnapshot(query: { workspaceId?: string } = {}): MetricsSnapshot {
  const scope = scopes.get(scopeKey(query.workspaceId))
  if (!scope) return { since: Date.now(), series: [] }
  return {
    since: scope.since,
    series: [...scope.series.entries()]
      .map(([id, s]) => ({
        series: id,
        count: s.count,
        failed: s.failed,
        p50Ms: quantile(s, 0.5),
        p95Ms: quantile(s, 0.95),
        avgMs: s.durationCount ? Math.round((s.durationSum / s.durationCount) * 10) / 10 : null,
        maxMs: s.durationCount ? s.max : null,
      }))
      .sort((a, b) => b.count - a.count),
  }
}

export function resetMetrics(query: { workspaceId?: string } = {}): void {
  if (query.workspaceId === undefined) { scopes.clear(); return }
  scopes.delete(scopeKey(query.workspaceId))
}
