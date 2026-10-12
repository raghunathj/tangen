/**
 * File Name: analytics.ts
 * Purpose: The Search Console numbers the Analytics page reads
 *          (plan-seo-manager-v2 V4), pure. Daily aggregates only - one store
 *          row per day holding that day's totals and its top pages and
 *          queries, never a raw event - summarised over a window, with the
 *          previous window beside it so a change is a real comparison. Also
 *          the window arithmetic, the limits (defaults, operator-settable)
 *          and which day rows retention drops.
 *
 * Author: Raghunath J
 * License: MIT
 */

export const DAY_PREFIX = 'gsc:day:'
export const SYNC_STATE_KEY = 'gsc:state'

/** Defaults, not constants: `analyticsRetentionDays` and `analyticsRowLimit` are manifest settings. */
export const DEFAULT_RETENTION_DAYS = 90
export const DEFAULT_ROW_LIMIT = 200
const MAX_RETENTION_DAYS = 480
const MAX_ROW_LIMIT = 1000

/** One row of a dimension on one day, as Search Console reports it. */
export interface DimensionRow {
  key: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/** One day, the only shape stored. */
export interface DailyRow {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  pages: DimensionRow[]
  queries: DimensionRow[]
}

/**
 * WHY the last sync failed, as a cause rather than a sentence. The page
 * compares it with the live connection status to tell whether that cause
 * still holds: an operator who sets the property should not keep reading
 * "no property chosen" until tomorrow's run (the user, 2026-09-20).
 */
export type SyncErrorKind = 'connection' | 'property' | 'provider'

export interface SyncState {
  lastSyncedAt?: string
  lastError?: string | null
  lastErrorKind?: SyncErrorKind
  /** When the failure was recorded, so a stale one reads as history. */
  lastErrorAt?: string
  property?: string | null
  /** Days written by the last run. */
  days?: number
  /** The re-arm chain's generation, so a stale wake exits (the Flows pattern). */
  gen?: number
}

export const dayKey = (date: string): string => `${DAY_PREFIX}${date}`

/** An ISO date (UTC) n days before the given day. */
export function isoDay(from: Date, minusDays = 0): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - minusDays)
  return d.toISOString().slice(0, 10)
}

/** The window a sync asks Google for, and the one a page reads: `days` long, ending today. */
export function window(now: Date, days: number): { startDate: string; endDate: string } {
  const span = Math.max(1, Math.floor(days))
  return { startDate: isoDay(now, span - 1), endDate: isoDay(now, 0) }
}

/** What an operator's settings mean, bounded: nonsense falls back to the default. */
export function limitsOf(settings: Record<string, unknown> | undefined): { retentionDays: number; rowLimit: number } {
  const n = (v: unknown, fallback: number, max: number): number => {
    const x = Number(v)
    return Number.isFinite(x) && x >= 1 ? Math.min(Math.floor(x), max) : fallback
  }
  return {
    retentionDays: n(settings?.analyticsRetentionDays, DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS),
    rowLimit: n(settings?.analyticsRowLimit, DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT),
  }
}

/** The day rows retention drops: older than `retentionDays`, counted from today. */
export function expiredDayKeys(keys: readonly string[], now: Date, retentionDays: number): string[] {
  const oldest = isoDay(now, Math.max(1, Math.floor(retentionDays)) - 1)
  return keys.filter((k) => k.startsWith(DAY_PREFIX) && k.slice(DAY_PREFIX.length) < oldest)
}

export interface Totals {
  clicks: number
  impressions: number
  /** A ratio, computed from the totals rather than averaged over days. */
  ctr: number
  /** Impression-weighted, the only honest way to average a position. */
  position: number
}

export interface Summary extends Totals {
  days: number
  /** Clicks per day, oldest first, for a sparkline. */
  series: number[]
  /** The same window before this one; absent when there is no data for it. */
  previous?: Totals
}

const zero = (): Totals => ({ clicks: 0, impressions: 0, ctr: 0, position: 0 })

function totalsOf(rows: readonly { clicks: number; impressions: number; position: number }[]): Totals {
  const t = zero()
  let weighted = 0
  for (const r of rows) {
    t.clicks += r.clicks
    t.impressions += r.impressions
    weighted += r.position * r.impressions
  }
  t.ctr = t.impressions ? t.clicks / t.impressions : 0
  t.position = t.impressions ? weighted / t.impressions : 0
  return t
}

/** The window's totals, its click series, and the window before it. */
export function summarize(rows: readonly DailyRow[], opts: { now: Date; days: number }): Summary {
  const { startDate, endDate } = window(opts.now, opts.days)
  const inWindow = rows.filter((r) => r.date >= startDate && r.date <= endDate).sort((a, b) => a.date.localeCompare(b.date))
  const prevStart = isoDay(opts.now, opts.days * 2 - 1)
  const before = rows.filter((r) => r.date >= prevStart && r.date < startDate)
  return {
    ...totalsOf(inWindow),
    days: inWindow.length,
    series: inWindow.map((r) => r.clicks),
    ...(before.length ? { previous: totalsOf(before) } : {}),
  }
}

export interface TopRow extends DimensionRow {
  /** Clicks per day over the window, oldest first. */
  series: number[]
}

/** The window's top pages or queries: summed clicks and impressions, weighted position, each with its own series. */
export function topRows(rows: readonly DailyRow[], dimension: 'pages' | 'queries', opts: { now: Date; days: number; limit?: number }): TopRow[] {
  const { startDate, endDate } = window(opts.now, opts.days)
  const inWindow = rows.filter((r) => r.date >= startDate && r.date <= endDate).sort((a, b) => a.date.localeCompare(b.date))
  const acc = new Map<string, { clicks: number; impressions: number; weighted: number; byDay: Map<string, number> }>()
  for (const day of inWindow) {
    for (const row of day[dimension] ?? []) {
      const cur = acc.get(row.key) ?? { clicks: 0, impressions: 0, weighted: 0, byDay: new Map() }
      cur.clicks += row.clicks
      cur.impressions += row.impressions
      cur.weighted += row.position * row.impressions
      cur.byDay.set(day.date, (cur.byDay.get(day.date) ?? 0) + row.clicks)
      acc.set(row.key, cur)
    }
  }
  return [...acc.entries()]
    .map(([key, v]) => ({
      key,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions ? v.clicks / v.impressions : 0,
      position: v.impressions ? v.weighted / v.impressions : 0,
      series: inWindow.map((d) => v.byDay.get(d.date) ?? 0),
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, Math.floor(opts.limit ?? 10)))
}

/** The change between a window and the one before it: null when there is nothing to compare with. */
export function changeOf(summary: Summary, metric: keyof Totals): { delta: number; better: boolean } | null {
  if (!summary.previous) return null
  const before = summary.previous[metric]
  const now = summary[metric]
  if (!before) return null
  const delta = (now - before) / before
  // A lower average position is better; everything else rises to improve.
  return { delta, better: metric === 'position' ? now < before : now > before }
}

/** Google's per-day rows for one dimension, kept to the operator's row limit. */
export function boundedRows(rows: readonly DimensionRow[], limit: number): DimensionRow[] {
  return [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, Math.max(1, Math.floor(limit)))
}

/**
 * What the Analytics page says about syncing. Three answers, and the order is
 * the point: what blocks a sync NOW outranks what failed before, and a
 * recorded failure whose cause is gone is history with an action, not a
 * verdict.
 */
export interface SyncNotice {
  kind: 'blocked' | 'failed' | 'stale'
  title: string
  message: string
  /** When it failed, for the two recorded kinds. */
  at?: string
}

export function syncNotice(input: {
  sync: Pick<SyncState, 'lastError' | 'lastErrorKind' | 'lastErrorAt' | 'lastSyncedAt'>
  connection: { connected: boolean; reason?: string; property?: string | null }
}): SyncNotice | null {
  const { sync, connection } = input
  // The live state first: these are the two conditions an operator fixes.
  if (!connection.connected) {
    return { kind: 'blocked', title: 'Search Console is not connected', message: connection.reason ?? 'The connection is not usable.' }
  }
  if (!connection.property) {
    return {
      kind: 'blocked', title: 'No property chosen',
      message: 'The connection works. Pick the Search Console property under Settings, Extensions, SEO, exactly as Search Console lists it.',
    }
  }
  if (!sync.lastError) return null
  // The connection and the property are in place now, so a failure recorded
  // for either is spent: say what it was, and that a sync will clear it.
  if (sync.lastErrorKind === 'connection' || sync.lastErrorKind === 'property') {
    return {
      kind: 'stale', title: 'The last sync ran before this was set up',
      message: `It failed with: ${sync.lastError} That is resolved now - press Sync now, or wait for the daily run.`,
      ...(sync.lastErrorAt ? { at: sync.lastErrorAt } : {}),
    }
  }
  return {
    kind: 'failed', title: 'The last sync failed', message: sync.lastError,
    ...(sync.lastErrorAt ? { at: sync.lastErrorAt } : {}),
  }
}
