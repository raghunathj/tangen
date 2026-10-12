/**
 * File Name: page.tsx
 * Purpose: Devspace → Query Monitor - per-request SQL visibility for the
 *          admin API (WordPress Query Monitor, Tangen-shaped): a live
 *          requests table (total/db time, query + duplicate counts, cache
 *          hits), a per-request Sheet with every timed query, and an
 *          Analysis tab (slowest routes, heaviest statements, N+1s).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Owner/admin only (Devspace rule, guarded here AND on
 *          the API routes). Data is the API process's in-memory ring buffer
 *          (last 200 requests) - a dev tool, nothing persists.
 */
import { useCallback, useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, useCan,
  Button, Badge, Text, DataList, NoPermission, toast,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle,
  type DataListColumn,
} from '@/kit'
import { canAccessDevspace } from '@/lib/devspace'
import { RequestTimeline, RouteBars, PageBars, type TimelinePoint } from '@/components/perf-charts'
import { isFabHidden, setFabHidden } from '@/lib/query-monitor-client'
import { DynamicIcon } from '@/components/dynamic-icon'

const SLOW_MS = 100

interface RequestSummary {
  id: string
  method: string
  path: string
  page?: string
  status?: number
  ts: string
  totalMs?: number
  dbMs: number
  queryCount: number
  droppedQueries: number
  dupCount: number
  cacheHits: number
  cacheMisses: number
  /** Filter transforms that ran (extension kernel); absent on an older API. */
  filterMs?: number
  filterSteps?: number
}

interface RequestDetail extends RequestSummary {
  queries: Array<{ sql: string; durationMs: number; waitMs?: number; error?: boolean }>
  dupGroups?: Array<{ normalized: string; count: number; totalMs: number }>
  cacheEvents: Array<{ status: string; typeName?: string }>
  filters?: Array<{ point: string; extensionId: string; scope: string; ms: number; outcome: string }>
}

interface Aggregates {
  routes: Array<{ route: string; count: number; avgMs: number; p95Ms: number; maxMs: number; avgQueries: number; avgDbMs: number; dupTotal: number }>
  pages: Array<{ page: string; requests: number; totalDbMs: number; avgDbMsPerRequest: number; queryCount: number; dupTotal: number; apiPaths: number }>
  slowStatements: Array<{ normalized: string; count: number; totalMs: number; maxMs: number }>
  nPlusOne: Array<{ route: string; normalized: string; maxCountInOneRequest: number; occurrences: number }>
  sampled: number
}

/** The Gateway's counters since the API process started (plan-gateway 29.5). */
interface GatewaySnapshot {
  rateLimit: {
    totals: { denied: number; wouldDeny: number; nearMiss: number }
    byPolicy: Record<string, number>
    byDimension: Record<string, number>
    storeFailures: number
  }
  policyMismatches: Record<string, number>
  cors: Record<string, number>
  requestLimits: Record<string, number>
  exposure: Record<string, number>
  realtime: {
    opened: number
    closed: number
    open: number
    byCode: Record<string, number>
    /** Open right now, `workspace|environment` (this workspace's unless every workspace was asked for). */
    openByScope: Record<string, number>
    /** Open right now, per transport (ws, sse). */
    openByTransport: Record<string, number>
    /** The last closes this process saw, newest first: codes and ids, never a person. */
    lastCloses: Array<{ at: number; code: number | null; reason: string | null; workspaceId: string; environment: string; transport: 'ws' | 'sse' | null; authMode: string }>
  }
}

const ms = (n?: number) => (n == null ? '-' : `${n} ms`)
const msTone = (n?: number) => ((n ?? 0) >= SLOW_MS ? 'text-danger-fg font-semibold' : 'text-fg-muted')

function MethodBadge({ method }: { method: string }) {
  return <span className="text-[11px] font-mono font-semibold text-fg-muted">{method}</span>
}

export default function QueryMonitorPage() {
  const { me, ready } = useCan()
  const role = me?.effectiveRole ?? me?.role
  const allowed = !ready || canAccessDevspace(role)

  const [tab, setTab] = useState<'requests' | 'analysis'>('requests')
  const [rows, setRows] = useState<RequestSummary[]>([])
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [slowOnly, setSlowOnly] = useState(false)
  const [dupsOnly, setDupsOnly] = useState(false)
  const [pathQuery, setPathQuery] = useState('')
  const [pageFilter, setPageFilter] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<RequestDetail | null>(null)
  const [searchParams] = useSearchParams()
  const [aggregates, setAggregates] = useState<Aggregates | null>(null)
  const [gateway, setGateway] = useState<GatewaySnapshot | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [fabShown, setFabShown] = useState(() => !isFabHidden())
  const PAGE = 25

  const reload = useCallback(() => {
    if (!allowed || !ready) return
    const params: Record<string, string> = { limit: String(PAGE), offset: String((page - 1) * PAGE) }
    if (slowOnly) params.slow = '1'
    if (dupsOnly) params.dups = '1'
    if (pathQuery) params.path = pathQuery
    if (pageFilter) params.page = pageFilter
    adminFetch<{ data: RequestSummary[]; meta: { total: number; enabled: boolean } }>('/admin/query-monitor/requests', undefined, params)
      .then((r) => { setRows(r.data); setTotal(r.meta.total); setEnabled(r.meta.enabled) })
      .catch(() => {})
      .finally(() => setLoading(false))
    // Timeline: latest 60 regardless of table filters/paging - a stable
    // "recent activity" strip.
    adminFetch<{ data: RequestSummary[] }>('/admin/query-monitor/requests', undefined, { limit: '60', offset: '0' })
      .then((r) => setTimeline([...r.data].reverse().map((x) => ({
        id: x.id, label: `${x.method} ${x.path}`, dbMs: x.dbMs, totalMs: x.totalMs,
        dup: x.dupCount, error: (x.status ?? 200) >= 500, ts: x.ts,
      }))))
      .catch(() => {})
    if (tab === 'analysis') {
      adminFetch<{ data: Aggregates }>('/admin/query-monitor/aggregates')
        .then((r) => setAggregates(r.data))
        .catch(() => {})
      adminFetch<{ data: GatewaySnapshot }>('/admin/query-monitor/gateway')
        .then((r) => setGateway(r.data))
        .catch(() => {})
    }
  }, [allowed, ready, page, slowOnly, dupsOnly, pathQuery, pageFilter, tab])

  useEffect(() => {
    reload()
    // Poll only while the tab is visible - a background devtool must not
    // keep the API warm for nothing.
    const t = setInterval(() => { if (!document.hidden) reload() }, 5_000)
    const onVisible = () => { if (!document.hidden) reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])

  // Deep link from the floating widget: ?id=<requestId> opens the detail sheet.
  useEffect(() => {
    const id = searchParams.get('id')
    if (!id || !allowed || !ready) return
    adminFetch<{ data: RequestDetail }>(`/admin/query-monitor/requests/${id}`)
      .then((res) => setDetail(res.data))
      .catch(() => toast.error('Request evicted from the buffer'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allowed, ready])

  const toggleCapture = async () => {
    try {
      const r = await adminFetch<{ data: { enabled: boolean } }>('/admin/query-monitor/toggle', {
        method: 'POST', body: JSON.stringify({ enabled: !enabled }),
      })
      setEnabled(r.data.enabled)
      toast.success(r.data.enabled ? 'Monitoring enabled' : 'Monitoring disabled')
    } catch (e) { toast.error('Toggle failed', (e as Error).message) }
  }

  const clear = async () => {
    try {
      await adminFetch('/admin/query-monitor/requests', { method: 'DELETE' })
      reload()
      toast.success('Cleared')
    } catch (e) { toast.error('Clear failed', (e as Error).message) }
  }

  usePageHeader({
    title: 'Performance Monitor',
    icon: <DynamicIcon name="IconBarChart" className="size-4" />,
    description: 'Per-request SQL for the admin API - timings, duplicates, N+1s (last 200 requests, dev tool)',
    tabs: [{ id: 'requests', label: 'Requests' }, { id: 'analysis', label: 'Analysis' }],
    activeTab: tab,
    onTabChange: (id) => setTab(id as 'requests' | 'analysis'),
    actions: (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted">
          <span className={`size-2 rounded-full ${enabled == null ? 'bg-fg-faint' : enabled ? 'bg-success' : 'bg-danger'}`} />
          {enabled == null ? 'Checking status' : enabled ? 'Monitoring on' : 'Monitoring off'}
        </span>
        <Button size="xs" variant="secondary" onClick={toggleCapture}>
          {enabled ? 'Disable' : 'Enable'}
        </Button>
        <label
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-fg-muted cursor-pointer select-none hover:border-border-strong"
          title="Show the draggable Performance pill on every admin page"
        >
          <input
            type="checkbox"
            checked={fabShown}
            onChange={(e) => { const show = e.currentTarget.checked; setFabShown(show); setFabHidden(!show) }}
            className="accent-indigo-500"
          />
          Floating pill
        </label>
        <Button size="sm" variant="ghost" onClick={clear}>Clear</Button>
        <Button size="sm" variant="ghost" onClick={async () => {
          try {
            const r = await adminFetch<{ data: unknown }>('/admin/query-monitor/export')
            const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `qm-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
            a.click()
            URL.revokeObjectURL(a.href)
          } catch (e) { toast.error('Export failed', (e as Error).message) }
        }}>Export</Button>
      </div>
    ),
  }, [tab, enabled, fabShown])

  if (ready && !allowed) {
    return <div className="p-6"><NoPermission note="The Performance Monitor is available to owners and admins only." /></div>
  }

  const columns: DataListColumn<RequestSummary>[] = [
    { key: 'method', header: '', cell: (r) => <MethodBadge method={r.method} /> },
    { key: 'path', header: 'Path', cell: (r) => <span className="font-mono text-xs text-fg truncate max-w-[280px] inline-block">{r.path}</span> },
    {
      key: 'page', header: 'Page',
      cell: (r) => r.page
        ? <button type="button" title={`Filter to this page\n${r.page}`} className="font-mono text-[11px] text-accent-fg hover:underline truncate max-w-[180px] inline-block text-left"
            onClick={(e) => { e.stopPropagation(); setPageFilter(r.page!.split('/').slice(3).join('/')) }}>
            /{r.page.split('/').slice(3).join('/')}
          </button>
        : <span className="text-xs text-fg-subtle">-</span>,
    },
    { key: 'status', header: 'Status', cell: (r) => <Badge variant={(r.status ?? 500) < 400 ? 'success' : 'error'}>{r.status ?? '?'}</Badge> },
    { key: 'totalMs', header: 'Total', cell: (r) => <span className={`text-xs tabular-nums ${msTone(r.totalMs)}`}>{ms(r.totalMs)}</span> },
    { key: 'dbMs', header: 'DB', cell: (r) => <span className={`text-xs tabular-nums ${msTone(r.dbMs)}`}>{ms(r.dbMs)}</span> },
    { key: 'filterMs', header: 'Filters', cell: (r) => (r.filterSteps ?? 0) > 0
        ? <span className={`text-xs tabular-nums ${msTone(r.filterMs ?? 0)}`} title={`${r.filterSteps} transforms`}>{ms(r.filterMs ?? 0)}</span>
        : <span className="text-xs text-fg-subtle">-</span> },
    { key: 'queryCount', header: 'Queries', cell: (r) => <span className="text-xs tabular-nums text-fg-muted">{r.queryCount}{r.droppedQueries > 0 ? `+${r.droppedQueries}` : ''}</span> },
    {
      key: 'dupCount', header: 'Dups',
      cell: (r) => r.dupCount > 0
        ? <Badge variant="warning">{r.dupCount}</Badge>
        : <span className="text-xs text-fg-subtle">0</span>,
    },
    {
      key: 'cache', header: 'Cache',
      cell: (r) => (r.cacheHits + r.cacheMisses) > 0
        ? <span className="text-xs text-fg-muted tabular-nums">{r.cacheHits}h / {r.cacheMisses}m</span>
        : <span className="text-xs text-fg-subtle">-</span>,
    },
    { key: 'ts', header: 'When', cell: (r) => <span className="text-xs text-fg-subtle tabular-nums">{new Date(r.ts).toLocaleTimeString()}</span> },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-3">
        {enabled === false && (
          <Text variant="help">Monitoring is off - enable it and browse the admin to record requests.</Text>
        )}
        {tab === 'requests' ? (
          <>
          <section className="rounded-xl border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold text-fg mb-1">Recent requests - db time</h3>
            <RequestTimeline
              points={timeline}
              onPick={(id) => {
                adminFetch<{ data: RequestDetail }>(`/admin/query-monitor/requests/${id}`)
                  .then((res) => setDetail(res.data))
                  .catch(() => toast.error('Request evicted from the buffer'))
              }}
            />
          </section>
          <DataList<RequestSummary>
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            onRowClick={(r) => {
              adminFetch<{ data: RequestDetail }>(`/admin/query-monitor/requests/${r.id}`)
                .then((res) => setDetail(res.data))
                .catch(() => toast.error('Request evicted from the buffer'))
            }}
            searchPlaceholder="Filter by path…"
            onSearchChange={(v) => { setPathQuery(v); setPage(1) }}
            toolbarLeft={(
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
                  <input type="checkbox" checked={slowOnly} onChange={(e) => { setSlowOnly(e.currentTarget.checked); setPage(1) }} className="accent-indigo-500" />
                  Slow only (≥{SLOW_MS}ms)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
                  <input type="checkbox" checked={dupsOnly} onChange={(e) => { setDupsOnly(e.currentTarget.checked); setPage(1) }} className="accent-indigo-500" />
                  Has duplicates
                </label>
                {pageFilter && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-muted px-2 py-0.5 text-[11px] text-accent-fg">
                    page: /{pageFilter}
                    <button type="button" aria-label="Clear page filter" onClick={() => setPageFilter('')}>✕</button>
                  </span>
                )}
              </div>
            )}
            page={page}
            pageSize={PAGE}
            total={total}
            onPageChange={setPage}
            emptyState={{ title: 'No requests captured', description: enabled === false ? 'Monitoring is off.' : 'Browse the admin in another tab - requests appear here live.' }}
          />
          </>
        ) : (
          <>
            <AnalysisView aggregates={aggregates} />
            <GatewayPanel snapshot={gateway} />
          </>
        )}
        {detail && <RequestSheet detail={detail} onClose={() => setDetail(null)} />}
      </div>
    </div>
  )
}

function RequestSheet({ detail, onClose }: { detail: RequestDetail; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle><span className="font-mono text-sm">{detail.method} {detail.path}</span></SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 flex-wrap text-xs text-fg-muted">
              <Badge variant={(detail.status ?? 500) < 400 ? 'success' : 'error'}>{detail.status ?? '?'}</Badge>
              <span className="tabular-nums">total {ms(detail.totalMs)}</span>
              <span>·</span>
              <span className="tabular-nums">db {ms(detail.dbMs)}</span>
              <span>·</span>
              <span>{detail.queryCount} queries{detail.droppedQueries > 0 ? ` (+${detail.droppedQueries} dropped)` : ''}</span>
              {(detail.filters ?? []).length > 0 && (<>
                <span>·</span>
                <span className="tabular-nums">filters {ms(detail.filterMs ?? 0)} ({detail.filters!.length})</span>
              </>)}
            </div>
            {(detail.filters ?? []).length > 0 && (
              <div className="space-y-1">
                {detail.filters!.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs">
                    <span className="font-mono truncate" title={f.scope}>{f.point} <span className="text-fg-muted">by {f.extensionId}</span></span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge variant={f.outcome === 'applied' || f.outcome === 'unchanged' || f.outcome === 'stopped' ? 'neutral' : 'warning'}>{f.outcome}</Badge>
                      <span className={`tabular-nums ${msTone(f.ms)}`}>{ms(f.ms)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(detail.dupGroups ?? []).length > 0 && (
              <Callout variant="warning" title="Duplicate statements">
                <div className="space-y-1">
                {detail.dupGroups!.map((g, i) => (
                  <p key={i} className="text-xs font-mono truncate" title={g.normalized}>
                    ×{g.count} ({g.totalMs} ms) {g.normalized}
                  </p>
                ))}
              </div>
              </Callout>
            )}
            {detail.cacheEvents.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detail.cacheEvents.map((c, i) => (
                  <Badge key={i} variant={c.status === 'hit' ? 'success' : c.status === 'stale' ? 'warning' : 'neutral'}>
                    cache {c.status}{c.typeName ? `: ${c.typeName}` : ''}
                  </Badge>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              {detail.queries.map((q, i) => (
                <div key={i} className={`rounded-md border p-2 ${q.error ? 'border-l-2 border-l-danger' : q.durationMs >= SLOW_MS ? 'border-l-2 border-l-warning' : 'border-border bg-surface'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-fg-subtle tabular-nums">#{i + 1}</span>
                    <span className={`text-xs tabular-nums ${msTone(q.durationMs)}`}>{(q.waitMs ?? 0) >= 10 ? <span className="text-warning-fg" title="Waited for a pooled connection (burst/cold load)">+{Math.round(q.waitMs!)}ms queued · </span> : null}{ms(q.durationMs)}{q.error ? ' · failed' : ''}</span>
                  </div>
                  <pre className="text-xs font-mono text-fg-muted whitespace-pre-wrap break-all mt-1 max-h-40 overflow-y-auto">{q.sql}</pre>
                </div>
              ))}
            </div>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function AnalysisView({ aggregates }: { aggregates: Aggregates | null }) {
  if (!aggregates) return <Text variant="help">Loading analysis…</Text>
  const { routes, slowStatements, nPlusOne, sampled } = aggregates
  return (
    <div className="space-y-5">
      <Text variant="help">Computed over the last {sampled} captured requests.</Text>

      <section className="rounded-xl border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-fg mb-2">Slowest routes - avg db time (tick = p95)</h3>
        <RouteBars routes={routes.map((r) => ({ route: r.route, count: r.count, avgDbMs: r.avgDbMs, p95Ms: r.p95Ms }))} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-fg mb-2">Heaviest admin pages - where db cost accumulates</h3>
        <PageBars pages={aggregates.pages} />
      </section>

      {nPlusOne.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-fg mb-2">N+1 candidates</h3>
          <div className="space-y-1.5">
            {nPlusOne.map((f, i) => (
              <Callout key={i} variant="danger">
                <p className="text-xs font-semibold">{f.route} - same statement ×{f.maxCountInOneRequest} in one request ({f.occurrences} request{f.occurrences === 1 ? '' : 's'})</p>
                <p className="text-xs font-mono truncate mt-0.5" title={f.normalized}>{f.normalized}</p>
              </Callout>
            ))}
          </div>
        </section>
      )}

      {aggregates.pages.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-fg mb-2">By page (where the cost lands)</h3>
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-sunken text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Admin page</th>
                  <th className="px-3 py-2 text-right font-medium">Requests</th>
                  <th className="px-3 py-2 text-right font-medium">Total DB</th>
                  <th className="px-3 py-2 text-right font-medium">Avg DB/req</th>
                  <th className="px-3 py-2 text-right font-medium">Queries</th>
                  <th className="px-3 py-2 text-right font-medium">Dups</th>
                  <th className="px-3 py-2 text-right font-medium">API routes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {aggregates.pages.slice(0, 15).map((p) => (
                  <tr key={p.page}>
                    <td className="px-3 py-1.5 font-mono truncate max-w-[240px]">{p.page}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.requests}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${msTone(p.totalDbMs)}`}>{p.totalDbMs} ms</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.avgDbMsPerRequest} ms</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.queryCount}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.dupTotal}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.apiPaths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-fg mb-2">Slowest routes</h3>
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-sunken text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Route</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Avg</th>
                <th className="px-3 py-2 text-right font-medium">p95</th>
                <th className="px-3 py-2 text-right font-medium">Max</th>
                <th className="px-3 py-2 text-right font-medium">Avg queries</th>
                <th className="px-3 py-2 text-right font-medium">Avg DB</th>
                <th className="px-3 py-2 text-right font-medium">Dups</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {routes.slice(0, 20).map((r) => (
                <tr key={r.route}>
                  <td className="px-3 py-1.5 font-mono truncate max-w-[280px]">{r.route}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${msTone(r.avgMs)}`}>{r.avgMs}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${msTone(r.p95Ms)}`}>{r.p95Ms}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.maxMs}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.avgQueries}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.avgDbMs}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.dupTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-fg mb-2">Heaviest statements (by total time)</h3>
        <div className="space-y-1">
          {slowStatements.slice(0, 15).map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="tabular-nums text-fg-muted w-24 shrink-0 text-right">{s.totalMs} ms ×{s.count}</span>
              <span className="font-mono text-fg-muted truncate" title={s.normalized}>{s.normalized}</span>
            </div>
          ))}
          {slowStatements.length === 0 && <Text variant="help">Nothing captured yet.</Text>}
        </div>
      </section>
    </div>
  )
}

/** A `key|key` counter map as a two-column table; nothing when it is empty. */
function CounterTable({ title, counts, labels, note }: { title: string; counts: Record<string, number>; labels: [string, string]; note?: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className="text-xs font-semibold text-fg mb-1">{title}</h4>
      {note && <p className="text-[11px] text-fg-subtle mb-1">{note}</p>}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-sunken text-fg-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">{labels[0]}</th>
              <th className="px-3 py-1.5 text-right font-medium">{labels[1]}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(([key, n]) => (
              <tr key={key}>
                <td className="px-3 py-1.5 font-mono text-fg-muted">{key.replace('|', ' : ')}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-fg">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The Gateway's counters (plan-gateway 29.5): what the Gateway refused,
 * would have refused in observe mode, nearly refused, and could not count,
 * since the API process started. Workspace-keyed counters are this
 * workspace's; the rest are process-wide by nature.
 */
function GatewayPanel({ snapshot }: { snapshot: GatewaySnapshot | null }) {
  if (!snapshot) return null
  const { rateLimit, realtime } = snapshot
  const stat = (label: string, value: number, tone = 'text-fg') => (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">Gateway</h3>
        <Text variant="help">Counters since the API process started. Denials are enforced refusals; would-deny is what observe mode let through; a near-miss used over 80% of a budget.</Text>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {stat('Denied', rateLimit.totals.denied, rateLimit.totals.denied > 0 ? 'text-danger-fg' : 'text-fg')}
        {stat('Would deny', rateLimit.totals.wouldDeny, rateLimit.totals.wouldDeny > 0 ? 'text-warning-fg' : 'text-fg')}
        {stat('Near miss', rateLimit.totals.nearMiss)}
        {stat('Store failures', rateLimit.storeFailures, rateLimit.storeFailures > 0 ? 'text-danger-fg' : 'text-fg')}
        {stat('Realtime open', realtime.open)}
        {stat('Realtime opened', realtime.opened)}
        {stat('Realtime closed', realtime.closed)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <CounterTable title="Rate limit by policy" counts={rateLimit.byPolicy} labels={['kind : policy', 'count']} />
        <CounterTable title="Denials by dimension" counts={rateLimit.byDimension} labels={['dimension', 'count']} note="Denied and would-deny, folded onto what each policy counts by." />
        <CounterTable title="CORS observe divergences" counts={snapshot.cors} labels={['workspace : route', 'count']} note="Origins the process-wide union allowed that the workspace did not declare." />
        <CounterTable title="Request limits" counts={snapshot.requestLimits} labels={['ceiling : seen at', 'count']} />
        <CounterTable title="Surfaces switched off" counts={snapshot.exposure} labels={['category : workspace', 'refusals']} />
        <CounterTable title="Policy mismatches" counts={snapshot.policyMismatches} labels={['kind : route', 'count']} />
        <CounterTable title="Realtime close codes" counts={realtime.byCode} labels={['code', 'count']} />
        <CounterTable title="Realtime open by workspace : environment" counts={realtime.openByScope ?? {}} labels={['workspace : environment', 'open']} note="Live on this API process. The ceilings count across processes through the rate-limit store." />
        <CounterTable title="Realtime open by transport" counts={realtime.openByTransport ?? {}} labels={['transport', 'open']} />
        <LastClosesTable closes={realtime.lastCloses ?? []} />
      </div>
    </section>
  )
}

/** The last realtime closes this process saw, newest first; codes and ids only. */
function LastClosesTable({ closes }: { closes: GatewaySnapshot['realtime']['lastCloses'] }) {
  if (closes.length === 0) return null
  const ago = (at: number) => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000))
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
  }
  return (
    <div className="md:col-span-2">
      <h4 className="text-xs font-semibold text-fg mb-1">Realtime last closes</h4>
      <p className="text-[11px] text-fg-subtle mb-1">Newest first. Codes 4000 and up are the server ending a connection; the reason is what the closing side said, clipped.</p>
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-surface-sunken text-fg-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">when</th>
              <th className="px-3 py-1.5 text-left font-medium">code</th>
              <th className="px-3 py-1.5 text-left font-medium">reason</th>
              <th className="px-3 py-1.5 text-left font-medium">workspace : environment</th>
              <th className="px-3 py-1.5 text-left font-medium">transport</th>
              <th className="px-3 py-1.5 text-left font-medium">auth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {closes.map((c, i) => (
              <tr key={`${c.at}-${i}`}>
                <td className="px-3 py-1.5 text-fg-muted whitespace-nowrap">{ago(c.at)}</td>
                <td className={`px-3 py-1.5 font-mono ${c.code != null && c.code >= 4000 ? 'text-warning-fg' : 'text-fg'}`}>{c.code ?? '-'}</td>
                <td className="px-3 py-1.5 text-fg-muted">{c.reason ?? ''}</td>
                <td className="px-3 py-1.5 font-mono text-fg-muted">{c.workspaceId} : {c.environment}</td>
                <td className="px-3 py-1.5 font-mono text-fg-muted">{c.transport ?? 'unknown'}</td>
                <td className="px-3 py-1.5 font-mono text-fg-muted">{c.authMode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
