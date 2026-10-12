/**
 * File Name: search-analytics.ts
 * Purpose: C3 — aggregates raw query-log rows into the Settings → Search
 *   dashboard (top searches, zero-result searches, daily volume trend, totals).
 *   Pure: the route fetches recent rows and calls summarizeSearchLogs, so this
 *   unit-tests without a DB. (Rows are already retention-bounded; no PII.)
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface SearchLogRow {
  term: string
  resultCount: number
  createdAt: string | Date
  audience: 'internal' | 'public'
}

export interface TermCount {
  term: string
  count: number
}

export interface SearchAnalyticsSummary {
  total: number
  uniqueTerms: number
  /** Fraction of searches that returned nothing (0..1). */
  zeroResultRate: number
  topSearches: TermCount[]
  zeroResultSearches: TermCount[]
  /** Daily volume, ascending by date (YYYY-MM-DD). */
  trend: { date: string; count: number }[]
}

function rankByCount(counts: Map<string, number>, limit: number): TermCount[] {
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit)
}

/** Build the dashboard summary from raw log rows. */
export function summarizeSearchLogs(
  rows: SearchLogRow[],
  opts: { audience?: 'internal' | 'public'; topN?: number } = {},
): SearchAnalyticsSummary {
  const topN = opts.topN ?? 10
  const scoped = opts.audience ? rows.filter((r) => r.audience === opts.audience) : rows

  const termCounts = new Map<string, number>()
  const zeroCounts = new Map<string, number>()
  const dayCounts = new Map<string, number>()
  let zeroTotal = 0

  for (const r of scoped) {
    termCounts.set(r.term, (termCounts.get(r.term) ?? 0) + 1)
    if (r.resultCount <= 0) {
      zeroCounts.set(r.term, (zeroCounts.get(r.term) ?? 0) + 1)
      zeroTotal++
    }
    const day = (r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)).slice(0, 10)
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
  }

  const total = scoped.length
  return {
    total,
    uniqueTerms: termCounts.size,
    zeroResultRate: total === 0 ? 0 : zeroTotal / total,
    topSearches: rankByCount(termCounts, topN),
    zeroResultSearches: rankByCount(zeroCounts, topN),
    trend: [...dayCounts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}
