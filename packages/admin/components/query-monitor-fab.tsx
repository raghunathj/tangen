/**
 * File Name: query-monitor-fab.tsx
 * Purpose: The floating Query Monitor - a draggable pill showing the CURRENT
 *          page's accumulated query cost (requests, queries, DB time; red
 *          when something is slow or duplicated). Expands to a per-request
 *          list; clicking a request opens its full query log INLINE (fetched
 *          on demand), with a link out to the full Devspace monitor.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Renders only when there is data (the X-Tangen-Qm
 *          header is emitted only while capture is on - dev by default) AND
 *          the member may access Devspace. Resets on route change; drag
 *          position persists in localStorage.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
// Leaf imports on purpose - the @/kit barrel would drag the whole editor
// surface (field controls, pickers, dnd-kit) into the entry chunk.
import { adminFetch } from '@/lib/api'
import { useCan } from '@/lib/use-can'
import { canAccessDevspace } from '@/lib/devspace'
import { useQmClientStore, isFabHidden, setFabHidden, FAB_VISIBILITY_EVENT, type QmPing } from '@/lib/query-monitor-client'
import { usePerfStore, ratingTone, initPerfMonitor, type VitalName } from '@/lib/perf-vitals'
import { useConsoleStore, initConsoleCapture } from '@/lib/console-capture'
import { pageVerdict, serverVerdict, consoleVerdict, worstVerdict, verdictLabel, type Verdict } from '@/lib/perf-verdict'
import { DynamicIcon } from '@/components/dynamic-icon'

const SLOW_MS = 100
const POS_KEY = 'tangen.qm.fab.pos'

interface InlineDetail {
  id: string
  queries: Array<{ sql: string; durationMs: number; waitMs?: number; error?: boolean }>
  dupGroups?: Array<{ normalized: string; count: number; totalMs: number }>
}

function loadPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
  } catch { /* corrupt - ignore */ }
  return null
}

const VITAL_ORDER: VitalName[] = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP']
const TONE_CHIP: Record<string, string> = {
  good: 'border-success/40 bg-success-muted text-success-fg',
  warn: 'border-warning/40 bg-warning-muted text-warning-fg',
  bad: 'border-danger/40 bg-danger-muted text-danger-fg',
  muted: 'border-border bg-surface text-fg-muted',
}
const VERDICT_CHIP: Record<Verdict, string> = {
  good: 'border-success/40 bg-success-muted text-success-fg',
  warn: 'border-warning/40 bg-warning-muted text-warning-fg',
  bad: 'border-danger/40 bg-danger-muted text-danger-fg',
}
function VerdictChip({ v }: { v: Verdict }) {
  return <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${VERDICT_CHIP[v]}`}>{verdictLabel(v)}</span>
}

function fmtVital(name: VitalName, value: number): string {
  return name === 'CLS' ? value.toFixed(3) : `${Math.round(value)}ms`
}

export function QueryMonitorFab() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { me, ready } = useCan()
  const role = me?.effectiveRole ?? me?.role
  const pings = useQmClientStore((s) => s.pings)
  const vitals = usePerfStore((s) => s.vitals)
  const loadMs = usePerfStore((s) => s.loadMs)
  const routeMs = usePerfStore((s) => s.routeMs)
  const routePath = usePerfStore((s) => s.routePath)
  const consoleEntries = useConsoleStore((s) => s.entries)
  const errorCount = useConsoleStore((s) => s.errorCount)
  const reset = useQmClientStore((s) => s.reset)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'page' | 'requests' | 'console'>('requests')
  const [hidden, setHidden] = useState(isFabHidden)

  // The Devspace page re-enables the pill; keep in sync without a remount.
  useEffect(() => {
    const onVisibility = (e: Event) => setHidden(Boolean((e as CustomEvent).detail?.hidden))
    window.addEventListener(FAB_VISIBILITY_EVENT, onVisibility)
    return () => window.removeEventListener(FAB_VISIBILITY_EVENT, onVisibility)
  }, [])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, InlineDetail | 'loading' | 'gone'>>({})
  // null = default bottom-right anchoring; set = absolute position while dragged
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadPos)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null)

  const devspaceOk = ready && canAccessDevspace(role)
  useEffect(() => {
    if (devspaceOk) { initPerfMonitor(); initConsoleCapture() }
  }, [devspaceOk])

  // "This page" semantics: clear on navigation.
  useEffect(() => {
    reset()
    setOpen(false)
    setExpandedId(null)
    setDetails({})
  }, [location.pathname, reset])

  if (hidden || !devspaceOk || pings.length === 0) return null

  const totalQueries = pings.reduce((n, p) => n + p.queries, 0)
  const totalDb = Math.round(pings.reduce((n, p) => n + p.dbMs, 0))
  const totalDup = pings.reduce((n, p) => n + p.dup, 0)
  const vPage = pageVerdict(vitals)
  const vServer = serverVerdict(pings)
  const vConsole = consoleVerdict(errorCount, useConsoleStore.getState().warnCount)
  const overall = worstVerdict([vPage, vServer, vConsole])
  const base = `/${workspaceId}/devspace/query-monitor`

  const toggleDetail = (p: QmPing) => {
    if (expandedId === p.id) { setExpandedId(null); return }
    setExpandedId(p.id)
    if (!details[p.id]) {
      setDetails((d) => ({ ...d, [p.id]: 'loading' }))
      adminFetch<{ data: InlineDetail }>(`/admin/query-monitor/requests/${p.id}`)
        .then((res) => setDetails((d) => ({ ...d, [p.id]: res.data })))
        .catch(() => setDetails((d) => ({ ...d, [p.id]: 'gone' })))
    }
  }

  // Drag: pointer events on the pill; a real drag (moved > 4px) suppresses the click-toggle.
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) {
      const x = Math.min(Math.max(8, d.baseX + dx), window.innerWidth - 120)
      const y = Math.min(Math.max(8, d.baseY + dy), window.innerHeight - 40)
      setPos({ x, y })
    }
  }
  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* private mode */ }
    } else {
      setOpen((o) => !o)
    }
  }

  const style = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' as const }
    : undefined
  // Open the panel toward the roomy side so it never pushes the pill or
  // overflows the viewport - up when the pill sits in the lower half.
  const openUp = pos ? pos.y > window.innerHeight / 2 : true
  const alignLeft = pos ? pos.x < 440 : false

  return (
    <div className="fixed bottom-4 right-4 z-40" style={style}>
      {open && (
        <div
          className={`absolute ${openUp ? 'bottom-full mb-2' : 'top-full mt-2'} ${alignLeft ? 'left-0' : 'right-0'} w-[430px] max-h-[min(24rem,70vh)] overflow-y-auto rounded-xl border border-border bg-surface shadow-xl`}
        >
          <div className="sticky top-0 bg-surface px-3 py-2 border-b border-border flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-fg">This page</span>
            <div className="flex items-center gap-2">
              <button type="button" className="text-xs text-accent-fg hover:underline" onClick={() => navigate(base)}>
                Open Performance Monitor →
              </button>
              <button
                type="button"
                title="Hide the floating pill - re-enable it from Devspace, Performance Monitor"
                className="text-xs text-fg-subtle hover:text-fg"
                onClick={() => { setFabHidden(true); setOpen(false) }}
              >
                Hide
              </button>
              <button type="button" aria-label="Close" className="text-fg-subtle hover:text-fg text-sm leading-none px-1" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="flex gap-1 px-2 py-1.5 border-b border-border">
            {([['page', vPage, null], ['requests', vServer, pings.length], ['console', vConsole, errorCount || null]] as const).map(([t, v, count]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                  tab === t ? 'bg-surface-sunken text-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {t}
                <span className={`size-1.5 rounded-full ${v === 'bad' ? 'bg-danger' : v === 'warn' ? 'bg-warning' : 'bg-success'}`} />
                {count != null && count > 0 && (
                  <span className={`font-normal tabular-nums ${t === 'console' ? 'text-danger-fg font-semibold' : ''}`}>{count}</span>
                )}
              </button>
            ))}
          </div>
          {tab === 'page' && (
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <VerdictChip v={vPage} />
              <span className="text-[11px] tabular-nums text-fg-muted">
                {routeMs != null && routePath === location.pathname ? `route ${routeMs}ms` : ''}
                {loadMs != null ? `${routeMs != null && routePath === location.pathname ? ' · ' : ''}load ${loadMs}ms` : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {VITAL_ORDER.filter((n) => vitals[n]).map((n) => (
                <span key={n} title={`${n} (Core Web Vitals rating: ${vitals[n]!.rating})`}
                  className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${TONE_CHIP[ratingTone(vitals[n]!.rating)]}`}>
                  {n} {fmtVital(n, vitals[n]!.value)}
                </span>
              ))}
              {VITAL_ORDER.every((n) => !vitals[n]) && (
                <span className="text-[11px] text-fg-subtle">Collecting page vitals...</span>
              )}
            </div>
          </div>
          )}
          {tab === 'requests' && (
          <div className="divide-y divide-border">
            {[...pings].reverse().map((p) => {
              const det = details[p.id]
              const expanded = expandedId === p.id
              return (
                <div key={`${p.id}-${p.ts}`}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-sunken/60"
                    title={expanded ? 'Collapse' : 'Show this request\'s queries'}
                    onClick={() => toggleDetail(p)}
                  >
                    <DynamicIcon name="IconChevronRight" className={`size-3 shrink-0 text-fg-subtle transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    <span className="text-[10px] font-mono font-semibold text-fg-subtle w-9 shrink-0">{p.method}</span>
                    <span className="text-xs font-mono text-fg truncate flex-1">{p.path}</span>
                    {p.dup > 0 && <span className="text-[10px] font-semibold text-warning-fg shrink-0">×{p.dup} dup</span>}
                    {p.waitMs >= 10 && <span className="text-[10px] text-warning-fg shrink-0" title="Time queries spent waiting for a pooled connection (burst/cold load), not executing">+{Math.round(p.waitMs)}ms queued</span>}
                    <span className={`text-xs tabular-nums shrink-0 ${p.dbMs >= SLOW_MS ? 'text-danger-fg font-semibold' : 'text-fg-muted'}`}>
                      {p.queries}q · {Math.round(p.dbMs)}ms
                    </span>
                  </button>
                  {expanded && (
                    <div className="px-3 pb-2 bg-surface-sunken/40">
                      {det === 'loading' && <p className="text-xs text-fg-subtle py-1">Loading…</p>}
                      {det === 'gone' && <p className="text-xs text-fg-subtle py-1">Evicted from the buffer.</p>}
                      {det && det !== 'loading' && det !== 'gone' && (
                        <div className="space-y-1 py-1">
                          {(det.dupGroups ?? []).length > 0 && (
                            <p className="text-[11px] text-warning-fg">
                              {det.dupGroups!.map((g) => `×${g.count} ${g.normalized.slice(0, 60)}`).join(' · ')}
                            </p>
                          )}
                          {det.queries.map((q, i) => (
                            <div key={i} className={`rounded border px-2 py-1 ${q.error ? 'border-l-2 border-l-danger' : q.durationMs >= SLOW_MS ? 'border-l-2 border-l-warning' : 'border-border bg-surface'}`}>
                              <div className="flex justify-between gap-2">
                                <span className="text-[10px] text-fg-subtle">#{i + 1}</span>
                                <span className={`text-[11px] tabular-nums ${q.durationMs >= SLOW_MS ? 'text-danger-fg font-semibold' : 'text-fg-muted'}`}>
                                  {(q.waitMs ?? 0) >= 10 && <span className="text-warning-fg" title="Waited for a pooled connection">+{Math.round(q.waitMs!)}ms queued · </span>}
                                  {q.durationMs} ms
                                </span>
                              </div>
                              <pre className="text-[11px] font-mono text-fg-muted whitespace-pre-wrap break-all max-h-24 overflow-y-auto">{q.sql}</pre>
                            </div>
                          ))}
                          <button type="button" className="text-[11px] text-accent-fg hover:underline" onClick={() => navigate(`${base}?id=${p.id}`)}>
                            Open in Performance Monitor →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
          {tab === 'requests' && pings.length === 0 && (
            <p className="px-3 py-3 text-[11px] text-fg-subtle">No requests captured on this page yet.</p>
          )}
          {tab === 'console' && (consoleEntries.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-fg-subtle">No errors or warnings captured.</p>
          ) : (
            <div className="px-3 pb-2 space-y-1 max-h-40 overflow-y-auto">
              {[...consoleEntries].reverse().slice(0, 20).map((e, i) => (
                <div key={`${e.at}-${i}`} className={`rounded border px-2 py-1 ${e.level === 'error' ? 'border-l-2 border-l-danger' : 'border-l-2 border-l-warning'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-semibold ${e.level === 'error' ? 'text-danger-fg' : 'text-warning-fg'}`}>{e.level}</span>
                    {e.page && <span className="text-[10px] text-fg-subtle truncate">{e.page}</span>}
                  </div>
                  <pre className="text-[11px] font-mono text-fg-muted whitespace-pre-wrap break-all max-h-16 overflow-y-auto">{e.text}</pre>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Performance Monitor - this page's cost at a glance (drag to move, click to expand)"
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg transition-colors cursor-grab active:cursor-grabbing touch-none select-none ${
          overall === 'bad'
            ? 'border-danger/40 bg-danger-muted text-danger-fg hover:bg-danger-muted'
            : overall === 'warn'
              ? 'border-warning/40 bg-warning-muted text-warning-fg hover:bg-warning-muted'
              : 'border-border bg-surface text-fg-muted hover:bg-surface-sunken'
        }`}
      >
        <DynamicIcon name="IconBarChart" className="size-3.5" />
        <span className="tabular-nums">{pings.length} req · {totalQueries}q · {totalDb}ms</span>
        {totalDup > 0 && <span className="font-semibold">· {totalDup} dup</span>}
        {errorCount > 0 && <span className="font-semibold text-danger-fg">· {errorCount} err</span>}
      </button>
    </div>
  )
}
