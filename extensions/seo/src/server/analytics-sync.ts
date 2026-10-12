/**
 * File Name: analytics-sync.ts
 * Purpose: Brings Search Console numbers into the extension's own store
 *          (plan-seo-manager-v2 V4): one row per day with that day's totals
 *          and its top pages and queries, bounded by the operator's row
 *          limit, pruned by the operator's retention. Runs as a platform
 *          task (daily, re-armed the way Flows arms a schedule) and on
 *          demand from the Analytics page; the page itself only ever reads
 *          the store, so a render never calls Google.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { searchConsoleConnection, type SearchAnalyticsRow } from './search-console'
import {
  boundedRows, dayKey, DAY_PREFIX, expiredDayKeys, limitsOf, window,
  SYNC_STATE_KEY, type DailyRow, type DimensionRow, type SyncState, type SyncErrorKind,
} from '../lib/analytics'

export const SYNC_TASK = 'ext:seo:sync-search-console'
/** Once a day; Google finalises a day's numbers within about three. */
export const SYNC_INTERVAL_SECONDS = 86_400
/** A routine sync re-reads this many days, so late data lands. */
export const SYNC_REFRESH_DAYS = 7
/** A manual sync may not run more often than this. */
export const MANUAL_SYNC_COOLDOWN_SECONDS = 600
/** One request's row cap, whatever the operator's per-day limit multiplies out to. */
const REQUEST_ROW_CAP = 5_000

export type SyncOutcome =
  | { ok: true; days: number; property: string; from: string; to: string }
  | { ok: false; reason: string; retryAfterSeconds?: number }

const state = async (ctx: ExtensionServerCtx): Promise<SyncState> => ((await ctx.store.get(SYNC_STATE_KEY)) ?? {}) as SyncState

/** Google's `['date', <dimension>]` rows, grouped by day and cut to the per-day limit. */
function byDay(rows: readonly SearchAnalyticsRow[], limit: number): Map<string, DimensionRow[]> {
  const out = new Map<string, DimensionRow[]>()
  for (const r of rows) {
    const [date, key] = r.keys
    if (!date || !key) continue
    const list = out.get(date) ?? []
    list.push({ key, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })
    out.set(date, list)
  }
  for (const [date, list] of out) out.set(date, boundedRows(list, limit))
  return out
}

/**
 * Reads the window and writes it. Never throws for an expected condition (no
 * grant, no connection, no property, Google refusing): the reason is recorded
 * on the sync state and returned, so the page can say it.
 */
export async function syncSearchConsole(ctx: ExtensionServerCtx, opts: { days?: number; now?: Date } = {}): Promise<SyncOutcome> {
  const now = opts.now ?? new Date()
  // Every recorded failure says WHY, so the page can tell whether the cause
  // still holds (the user, 2026-09-20: the property was set, and the page
  // still read "no property chosen" from the run before).
  const fail = async (reason: string, kind: SyncErrorKind): Promise<SyncOutcome> => {
    await ctx.store.put(SYNC_STATE_KEY, {
      ...(await state(ctx)), lastError: reason, lastErrorKind: kind, lastErrorAt: now.toISOString(),
    } as never)
    return { ok: false, reason }
  }

  const { status, reader } = await searchConsoleConnection(ctx)
  if (!status.connected || !reader) {
    return fail(status.connected ? 'The Search Console connection is not usable.' : status.reason, 'connection')
  }
  if (!status.property) {
    return fail(
      'No Search Console property chosen: pick it on the SEO Manager\'s Settings tab, under Search Console.',
      'property',
    )
  }
  const settings = (await ctx.settings?.get().catch(() => ({}))) ?? {}
  const { retentionDays, rowLimit } = limitsOf(settings as Record<string, unknown>)
  // A first sync fills the retention window; a routine one re-reads the last few days.
  const existing = await ctx.store.list(DAY_PREFIX, { limit: 1 })
  const days = Math.min(opts.days ?? (existing.length ? SYNC_REFRESH_DAYS : retentionDays), retentionDays)
  const { startDate, endDate } = window(now, days)
  const query = { siteUrl: status.property, startDate, endDate }
  const perRequest = Math.min(rowLimit * days, REQUEST_ROW_CAP)

  let totals: SearchAnalyticsRow[]
  let pages: SearchAnalyticsRow[]
  let queries: SearchAnalyticsRow[]
  try {
    totals = await reader.query({ ...query, dimensions: ['date'], rowLimit: days })
    pages = await reader.query({ ...query, dimensions: ['date', 'page'], rowLimit: perRequest })
    queries = await reader.query({ ...query, dimensions: ['date', 'query'], rowLimit: perRequest })
  } catch (e) {
    return fail((e as Error).message, 'provider')
  }

  const pageRows = byDay(pages, rowLimit)
  const queryRows = byDay(queries, rowLimit)
  let written = 0
  for (const row of totals) {
    const date = row.keys[0]
    if (!date) continue
    const day: DailyRow = {
      date, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position,
      pages: pageRows.get(date) ?? [], queries: queryRows.get(date) ?? [],
    }
    await ctx.store.put(dayKey(date), day as never)
    written += 1
  }
  // Retention, over the keys that exist rather than a date walk.
  const keys = (await ctx.store.list(DAY_PREFIX, { limit: MAX_DAY_ROWS })).map((r) => r.key)
  for (const key of expiredDayKeys(keys, now, retentionDays)) await ctx.store.remove(key)

  await ctx.store.put(SYNC_STATE_KEY, {
    ...(await state(ctx)), lastSyncedAt: now.toISOString(),
    lastError: null, lastErrorKind: undefined, lastErrorAt: undefined,
    property: status.property, days: written,
  } as never)
  return { ok: true, days: written, property: status.property, from: startDate, to: endDate }
}

const MAX_DAY_ROWS = 600

/** A manual sync, refused by name while the cooldown holds. */
export async function syncOnDemand(ctx: ExtensionServerCtx, opts: { now?: Date } = {}): Promise<SyncOutcome> {
  const now = opts.now ?? new Date()
  const last = (await state(ctx)).lastSyncedAt
  if (last) {
    const elapsed = Math.round((now.getTime() - Date.parse(last)) / 1000)
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MANUAL_SYNC_COOLDOWN_SECONDS) {
      return { ok: false, reason: 'Search Console was synced a moment ago; the numbers update once a day.', retryAfterSeconds: MANUAL_SYNC_COOLDOWN_SECONDS - elapsed }
    }
  }
  return syncSearchConsole(ctx, { now })
}

/**
 * Arms the daily chain: a new generation retires any chain a previous boot
 * left behind, so a wake carrying an old generation exits (the Flows pattern).
 */
export async function armAnalyticsSync(ctx: ExtensionServerCtx, opts: { delaySeconds?: number } = {}): Promise<number> {
  const prev = await state(ctx)
  const gen = (prev.gen ?? 0) + 1
  await ctx.store.put(SYNC_STATE_KEY, { ...prev, gen } as never)
  await ctx.enqueue(SYNC_TASK, { gen }, { delaySeconds: opts.delaySeconds ?? SYNC_INTERVAL_SECONDS })
  return gen
}

/** One wake of the chain: sync when the generation is current, then re-arm. */
export async function runAnalyticsSyncTask(payload: unknown, ctx: ExtensionServerCtx): Promise<void> {
  const p = payload as { gen?: unknown; once?: unknown } | undefined
  // A ONE-OFF run: the settings changed and somebody is waiting to see
  // numbers. It syncs and stops - re-arming here would start a second daily
  // chain beside the one already running.
  if (p?.once === true) {
    await syncSearchConsole(ctx).catch(() => undefined)
    return
  }
  const gen = Number(p?.gen ?? 0)
  const current = await state(ctx)
  if ((current.gen ?? 0) !== gen) return
  await syncSearchConsole(ctx).catch(() => undefined)
  await ctx.enqueue(SYNC_TASK, { gen }, { delaySeconds: SYNC_INTERVAL_SECONDS })
}

/** The settings that decide WHAT is synced: a change to either is worth a run. */
export const SYNC_SETTING_KEYS = ['searchConsole', 'searchConsoleProperty'] as const

/**
 * An operator chose the connection or the property, so the numbers are one
 * sync away. Enqueued, never run inline: the Save button must not wait on
 * Google (and a settings hook that blocks is a settings page that hangs).
 */
export async function syncAfterSettingsChange(
  ctx: ExtensionServerCtx,
  changed: readonly string[],
): Promise<boolean> {
  if (!changed.some((k) => (SYNC_SETTING_KEYS as readonly string[]).includes(k))) return false
  await ctx.enqueue(SYNC_TASK, { once: true }).catch(() => undefined)
  return true
}
