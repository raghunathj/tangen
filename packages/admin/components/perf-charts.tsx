/**
 * File Name: perf-charts.tsx
 * Purpose: Dependency-free SVG charts for the Performance Monitor page - a
 *          recent-requests timeline (db time per request, error/slow/dup
 *          coloring, queued-time overlay) and horizontal route bars
 *          (avg db time with a p95 marker). Native <title> tooltips.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No chart library on purpose - the admin ships none and
 *          these two shapes don't justify one. Scale helpers are pure and
 *          unit-tested.
 */

export interface TimelinePoint {
  id: string
  label: string
  dbMs: number
  waitMs?: number
  /** Full API handler time - the gap over db+wait renders as "app time". */
  totalMs?: number
  dup: number
  error?: boolean
  ts: string
}

export interface RouteBar {
  route: string
  count: number
  avgDbMs: number
  p95Ms: number
}

/** Linear scale into [minPx..maxPx] against the series max (0-safe). */
export function scaleHeights(values: number[], maxPx: number, minPx = 2): number[] {
  const max = Math.max(...values, 0)
  if (max <= 0) return values.map(() => minPx)
  return values.map((v) => Math.max(minPx, Math.round((v / max) * maxPx)))
}

/**
 * Splits one request bar into proportional pixel segments: db execution
 * (bottom), pool-queue wait (middle), app time (top - total minus db+wait).
 * db keeps at least 1px whenever it is nonzero.
 */
export function timelineSegments(
  p: { dbMs: number; waitMs?: number; totalMs?: number },
  barPx: number,
): { dbH: number; waitH: number; appH: number; value: number } {
  const wait = p.waitMs ?? 0
  const app = Math.max(0, (p.totalMs ?? 0) - p.dbMs - wait)
  const value = p.dbMs + wait + app
  if (value <= 0 || barPx <= 0) return { dbH: 0, waitH: 0, appH: 0, value: 0 }
  const dbH = p.dbMs > 0 ? Math.max(1, Math.round((p.dbMs / value) * barPx)) : 0
  const waitH = wait > 0 ? Math.max(1, Math.round((wait / value) * barPx)) : 0
  const appH = Math.max(0, barPx - dbH - waitH)
  return { dbH, waitH, appH, value }
}

/** Timeline bar tone: errors red, slow red, dups amber, healthy indigo. */
export function timelineTone(p: { dbMs: number; dup: number; error?: boolean }, slowMs = 100): string {
  if (p.error) return '#dc2626'
  if (p.dbMs >= slowMs) return '#ef4444'
  if (p.dup > 0) return '#f59e0b'
  return '#6366f1'
}

/**
 * Recent requests as a compact bar timeline, oldest left to newest right.
 * Height = full request time, stacked bottom-up as db execution (colored),
 * pool-queue wait (amber) and app time (gray) - so one glance answers WHERE
 * the time went, not just how much SQL ran.
 */
export function RequestTimeline({ points, height = 72, onPick }: {
  points: TimelinePoint[]
  height?: number
  onPick?: (id: string) => void
}) {
  if (points.length === 0) {
    return <p className="text-[11px] text-fg-subtle py-4 text-center">No requests captured yet.</p>
  }
  const barW = 8
  const gap = 2
  const width = points.length * (barW + gap)
  const values = points.map((p) => p.dbMs + (p.waitMs ?? 0) + Math.max(0, (p.totalMs ?? 0) - p.dbMs - (p.waitMs ?? 0)))
  const heights = scaleHeights(values, height - 4)
  const maxVal = Math.max(...values)
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Recent requests timeline" className="block">
        {points.map((p, i) => {
          const h = heights[i]
          const { dbH, waitH, appH } = timelineSegments(p, h)
          const x = i * (barW + gap)
          const appMs = Math.max(0, (p.totalMs ?? 0) - p.dbMs - (p.waitMs ?? 0))
          return (
            <g key={p.id} onClick={onPick ? () => onPick(p.id) : undefined} className={onPick ? 'cursor-pointer' : undefined}>
              <title>{`${p.label}\n${Math.round(p.dbMs)}ms db${p.waitMs ? ` · ${Math.round(p.waitMs)}ms queued` : ''}${appMs >= 1 ? ` · ${Math.round(appMs)}ms app` : ''}${p.totalMs ? ` · ${Math.round(p.totalMs)}ms total` : ''}${p.dup ? ` · ${p.dup} dup` : ''}${p.error ? ' · error' : ''}\n${new Date(p.ts).toLocaleTimeString()}`}</title>
              {/* hover/click target spanning the full column */}
              <rect x={x} y={0} width={barW} height={height} fill="transparent" />
              {/* bottom-up: db (colored) -> queue (amber) -> app (gray) */}
              {dbH > 0 && <rect x={x} y={height - dbH} width={barW} height={dbH} fill={timelineTone(p)} />}
              {waitH > 0 && <rect x={x} y={height - dbH - waitH} width={barW} height={waitH} fill="#fcd34d" />}
              {appH > 0 && <rect x={x} y={height - dbH - waitH - appH} width={barW} height={appH} rx={1.5} fill="#d1d5db" />}
            </g>
          )
        })}
      </svg>
      <div className="flex items-center gap-3 pt-1 text-[10px] text-fg-subtle">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: '#6366f1' }} /> db</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: '#ef4444' }} /> db slow / error</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: '#f59e0b' }} /> db with duplicates</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: '#fcd34d' }} /> queued</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: '#d1d5db' }} /> app</span>
        <span className="ml-auto tabular-nums">max {Math.round(maxVal)}ms</span>
      </div>
    </div>
  )
}

/** Where db cost ACCUMULATES per admin page - width is total db time. */
export function PageBars({ pages, max = 8, onPick }: {
  pages: Array<{ page: string; requests: number; totalDbMs: number; avgDbMsPerRequest: number }>
  max?: number
  onPick?: (page: string) => void
}) {
  const top = [...pages].sort((a, b) => b.totalDbMs - a.totalDbMs).slice(0, max)
  if (top.length === 0) {
    return <p className="text-[11px] text-fg-subtle py-4 text-center">Nothing aggregated yet.</p>
  }
  const scaleMax = Math.max(...top.map((p) => p.totalDbMs), 1)
  return (
    <div className="space-y-1.5">
      {top.map((p) => (
        <button
          key={p.page}
          type="button"
          onClick={onPick ? () => onPick(p.page) : undefined}
          className="w-full text-left group"
          title={`${p.page}\n${Math.round(p.totalDbMs)}ms total db · avg ${Math.round(p.avgDbMsPerRequest)}ms per request · ${p.requests} requests`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-mono truncate text-fg-muted group-hover:text-fg">{p.page}</span>
            <span className="tabular-nums text-fg-subtle shrink-0">{Math.round(p.totalDbMs)}ms total · avg {Math.round(p.avgDbMsPerRequest)}ms · ×{p.requests}</span>
          </div>
          <div className="relative h-2 rounded bg-surface-sunken overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded bg-violet-400" style={{ width: `${Math.max(1, Math.round((p.totalDbMs / scaleMax) * 100))}%` }} />
          </div>
        </button>
      ))}
    </div>
  )
}

/** Top routes by average db time - horizontal bars with a p95 tick. */
export function RouteBars({ routes, max = 8, onPick }: {
  routes: RouteBar[]
  max?: number
  onPick?: (route: string) => void
}) {
  const top = [...routes].sort((a, b) => b.avgDbMs - a.avgDbMs).slice(0, max)
  if (top.length === 0) {
    return <p className="text-[11px] text-fg-subtle py-4 text-center">Nothing aggregated yet.</p>
  }
  const scaleMax = Math.max(...top.map((r) => r.p95Ms), 1)
  return (
    <div className="space-y-1.5">
      {top.map((r) => {
        const avgPct = Math.max(1, Math.round((r.avgDbMs / scaleMax) * 100))
        const p95Pct = Math.min(100, Math.round((r.p95Ms / scaleMax) * 100))
        return (
          <button
            key={r.route}
            type="button"
            onClick={onPick ? () => onPick(r.route) : undefined}
            className="w-full text-left group"
            title={`${r.route}\navg ${Math.round(r.avgDbMs)}ms · p95 ${Math.round(r.p95Ms)}ms · ${r.count} requests`}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono truncate text-fg-muted group-hover:text-fg">{r.route}</span>
              <span className="tabular-nums text-fg-subtle shrink-0">avg {Math.round(r.avgDbMs)}ms · p95 {Math.round(r.p95Ms)}ms · ×{r.count}</span>
            </div>
            <div className="relative h-2 rounded bg-surface-sunken overflow-hidden">
              <div className={`absolute inset-y-0 left-0 rounded ${r.avgDbMs >= 100 ? 'bg-red-400' : r.avgDbMs >= 50 ? 'bg-warning' : 'bg-indigo-400'}`} style={{ width: `${avgPct}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-fg-subtle/60" style={{ left: `${p95Pct}%` }} title="p95" />
            </div>
          </button>
        )
      })}
    </div>
  )
}
