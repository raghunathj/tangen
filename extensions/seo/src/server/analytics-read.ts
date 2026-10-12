/**
 * File Name: analytics-read.ts
 * Purpose: What the Analytics page and the Dashboard read
 *          (plan-seo-manager-v2 V4): the stored daily rows, summarised over
 *          the asked window with the window before it, the top pages and
 *          queries, and the sync's own state. Reads the store and nothing
 *          else - no request to Google happens on a render.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { searchConsoleConnection, type SearchConsoleStatus } from './search-console'
import {
  DAY_PREFIX, limitsOf, summarize, SYNC_STATE_KEY, topRows,
  type DailyRow, type Summary, type SyncState, type TopRow,
} from '../lib/analytics'

/** The most day rows a read will load: the hard retention ceiling plus room. */
const MAX_DAY_ROWS = 600
export const TOP_ROWS_SHOWN = 10

export interface AnalyticsView {
  days: number
  /** null until a sync has written a day. */
  summary: Summary | null
  pages: TopRow[]
  queries: TopRow[]
  sync: SyncState & { intervalHours: number }
  connection: SearchConsoleStatus
  limits: { retentionDays: number; rowLimit: number }
}

export async function readAnalytics(ctx: ExtensionServerCtx, opts: { days?: number; now?: Date } = {}): Promise<AnalyticsView> {
  const now = opts.now ?? new Date()
  const days = Math.max(1, Math.min(Math.floor(opts.days ?? 28), 365))
  const rows = (await ctx.store.list(DAY_PREFIX, { limit: MAX_DAY_ROWS })).map((r) => r.data as unknown as DailyRow)
  const summary = rows.length ? summarize(rows, { now, days }) : null
  const sync = ((await ctx.store.get(SYNC_STATE_KEY)) ?? {}) as SyncState
  const settings = (await ctx.settings?.get().catch(() => ({}))) ?? {}
  const { status } = await searchConsoleConnection(ctx)
  return {
    days,
    summary: summary && summary.days ? summary : summary,
    pages: rows.length ? topRows(rows, 'pages', { now, days, limit: TOP_ROWS_SHOWN }) : [],
    queries: rows.length ? topRows(rows, 'queries', { now, days, limit: TOP_ROWS_SHOWN }) : [],
    sync: { ...sync, intervalHours: 24 },
    connection: status,
    limits: limitsOf(settings as Record<string, unknown>),
  }
}
