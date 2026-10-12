/**
 * File Name: perf-verdict.ts
 * Purpose: Per-section verdicts for the Performance Monitor (Good / Needs
 *          attention / Poor). Page follows the web-vitals CWV ratings; Server
 *          grades the warm MEDIAN db time plus duplicate queries and chronic
 *          pool queueing (a single cold request after a dev-server restart
 *          must never flip the grade); Console grades error/warn counts.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { QmPing } from './query-monitor-client'
import type { CwvRating, VitalName } from './perf-vitals'

export type Verdict = 'good' | 'warn' | 'bad'

const ORDER: Record<Verdict, number> = { good: 0, warn: 1, bad: 2 }

/** Median db time at which the server section reads Poor / Needs attention. */
export const SERVER_BAD_MS = 100
export const SERVER_WARN_MS = 50
/** Queueing counts as chronic when at least half the requests waited this long. */
const CHRONIC_WAIT_MS = 20

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function pageVerdict(vitals: Partial<Record<VitalName, { value: number; rating: CwvRating }>>): Verdict {
  const ratings = Object.values(vitals).map((v) => v!.rating)
  if (ratings.includes('poor')) return 'bad'
  if (ratings.includes('needs-improvement')) return 'warn'
  return 'good'
}

export function serverVerdict(pings: QmPing[]): Verdict {
  if (pings.length === 0) return 'good'
  const med = median(pings.map((p) => p.dbMs))
  if (med >= SERVER_BAD_MS) return 'bad'
  const anyDup = pings.some((p) => p.dup > 0)
  const chronicQueue = pings.filter((p) => p.waitMs >= CHRONIC_WAIT_MS).length >= Math.ceil(pings.length / 2)
  if (med >= SERVER_WARN_MS || anyDup || chronicQueue) return 'warn'
  return 'good'
}

export function consoleVerdict(errorCount: number, warnCount: number): Verdict {
  if (errorCount > 0) return 'bad'
  if (warnCount > 0) return 'warn'
  return 'good'
}

export function worstVerdict(vs: Verdict[]): Verdict {
  return vs.reduce((worst, v) => (ORDER[v] > ORDER[worst] ? v : worst), 'good' as Verdict)
}

export function verdictLabel(v: Verdict): string {
  return v === 'good' ? 'Good' : v === 'warn' ? 'Needs attention' : 'Poor'
}
