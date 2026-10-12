/**
 * File Name: SeoManagerPage.tsx
 * Purpose: The SEO Manager's Dashboard (plan-seo-manager-v2 V1): the health
 *          report over the workspace's own published content - a score, the
 *          coverage per type, the services around the site, and the objects
 *          that need attention - each number from `GET health-report`. No
 *          Search Console tiles until a connection exists: a card says how
 *          to connect instead. A v1 `?tab=` link is sent to its child page.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AdminPage, Panel, Text, Button, DataList, ListChip, TEXT_LINK, adminFetch, toast, useCan, type DataListColumn } from '@/kit'
import { IconRefresh, IconTable, IconListChecks, IconChevronRight, IconFileList, IconProhibited, IconSparkles, IconBarChart } from '@tangen/icons'
import { legacyTabPath, seoManagerHref, DASHBOARD_PAGE_SIZE } from '../lib/seo-manager-nav'
import { scoreTone, type HealthReport } from '../lib/health-report'
import { Stat, type AnalyticsViewData } from './AnalyticsTab'

export function SeoManagerPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const [params] = useSearchParams()
  const legacy = legacyTabPath(params.get('tab'))
  if (legacy) return <Navigate to={seoManagerHref(workspaceId, legacy)} replace />
  return <Dashboard workspaceId={workspaceId} />
}

function Dashboard({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate()
  const [report, setReport] = useState<HealthReport | null>(null)
  // V4: the search numbers ride along only when a connection actually reported some.
  const [analytics, setAnalytics] = useState<AnalyticsViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { hasCapability } = useCan()
  const canWrite = hasCapability('seo:write')

  const load = useCallback(async (rebuild: boolean) => {
    try {
      const r = await adminFetch<{ data: HealthReport }>('/admin/ext/seo/health-report', rebuild ? { method: 'POST' } : undefined)
      setReport(r.data)
      if (r.data.services.searchConsole.connected) {
        const a = await adminFetch<{ data: AnalyticsViewData }>('/admin/ext/seo/analytics?days=28').catch(() => null)
        setAnalytics(a?.data ?? null)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The health report could not be loaded')
    }
  }, [])
  useEffect(() => { load(false).finally(() => setLoading(false)) }, [load])
  const recheck = async () => { setBusy(true); try { await load(true) } finally { setBusy(false) } }

  return (
    <AdminPage
      title="SEO Manager"
      description="How the site's published content stands in search, from its own metadata."
      access={{ capability: 'seo:read' }}
      loading={loading}
      actions={canWrite ? <Button size="sm" variant="secondary" icon={<IconRefresh className="size-3.5" />} disabled={busy} onClick={recheck}>{busy ? 'Checking' : 'Recheck'}</Button> : undefined}
    >
      {report && (
        <div className="space-y-4">
          {analytics?.summary && analytics.summary.days > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Clicks" summary={analytics.summary} metric="clicks" format={(n) => Math.round(n).toLocaleString()} />
              <Stat label="Impressions" summary={analytics.summary} metric="impressions" format={(n) => Math.round(n).toLocaleString()} />
              <Stat label="Average CTR" summary={analytics.summary} metric="ctr" format={(n) => `${(n * 100).toFixed(1)}%`} />
              <Stat label="Average position" summary={analytics.summary} metric="position" format={(n) => n.toFixed(1)} />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[284px_1fr]">
            <HealthCard report={report} />
            <div className="space-y-4">
              <CoverageCard report={report} />
              <ServicesCard report={report} workspaceId={workspaceId} />
            </div>
          </div>
          <AttentionCard workspaceId={workspaceId} onOpen={(o) => navigate(`/${workspaceId}/objects/${o.type}/${o.id}`)} />
          <Text variant="help">Generated {new Date(report.generatedAt).toLocaleString()} over {report.scanned.toLocaleString()} published objects. A publish refreshes it; Recheck rebuilds it now.</Text>
        </div>
      )}
    </AdminPage>
  )
}

const TONE_TEXT = { good: 'text-success-fg', ok: 'text-warning-fg', poor: 'text-danger-fg' } as const
const TONE_STROKE = { good: 'text-success', ok: 'text-warning', poor: 'text-danger' } as const
const TONE_LABEL = { good: 'Good', ok: 'Needs work', poor: 'Poor' } as const

/**
 * A dashboard card. The chrome is the kit's, not its own: these sit beside
 * framed DataLists on the same page, and a wider radius with a heavier shadow
 * made them read as widgets pasted onto the page rather than part of it.
 */
function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <Panel flush className={`p-5 ${className}`}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {sub && <span className="text-ui-xs text-fg-subtle">{sub}</span>}
      </div>
      {children}
    </Panel>
  )
}

/** The score ring: one SVG arc over a track, the same thresholds as the panel's badge. */
function HealthCard({ report }: { report: HealthReport }) {
  const tone = scoreTone(report.score)
  const r = 57, c = 2 * Math.PI * r
  const offset = report.score === null ? c : c * (1 - report.score / 100)
  return (
    <Card title="Site health">
      <div className="mt-2 flex flex-col items-center">
        <div className="relative my-2 size-[138px]">
          <svg width="138" height="138" viewBox="0 0 138 138" className="-rotate-90" aria-hidden="true">
            <circle cx="69" cy="69" r={r} fill="none" stroke="currentColor" strokeWidth="12" className="text-surface-sunken" />
            {tone && <circle cx="69" cy="69" r={r} fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className={TONE_STROKE[tone]} />}
          </svg>
          <div className="absolute inset-0 grid place-content-center text-center">
            <span className="text-[34px] font-semibold tracking-tight text-fg tabular-nums">{report.score ?? '–'}</span>
            <span className={`text-[10.5px] font-semibold uppercase tracking-wider ${tone ? TONE_TEXT[tone] : 'text-fg-faint'}`}>{tone ? TONE_LABEL[tone] : 'No content'}</span>
          </div>
        </div>
        <div className="w-full space-y-2 text-ui-xs">
          {(['good', 'ok', 'poor'] as const).map((k) => (
            <div key={k} className="flex items-center gap-2 text-fg-muted">
              <span className={`size-2 rounded-sm ${k === 'good' ? 'bg-success' : k === 'ok' ? 'bg-warning' : 'bg-danger'}`} />
              {TONE_LABEL[k]}
              <span className="ml-auto font-semibold text-fg tabular-nums">{report.counts[k].toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

/** One segmented bar per content type: optimised, missing a description, no metadata. */
function CoverageCard({ report }: { report: HealthReport }) {
  const total = report.coverage.reduce((n, c) => n + c.total, 0)
  return (
    <Card title="Content coverage" sub={`${total.toLocaleString()} published objects across ${report.coverage.length} ${report.coverage.length === 1 ? 'type' : 'types'}`}>
      {report.coverage.length === 0 ? (
        <Text variant="help" className="mt-2">Nothing is published yet. Coverage appears with the first published object.</Text>
      ) : (
        <div className="mt-3 space-y-3">
          {report.coverage.map((c) => (
            <div key={c.type}>
              <div className="flex items-center justify-between text-ui-xs">
                <span className="font-medium text-fg">{c.type}</span>
                <span className="text-fg-subtle tabular-nums">{c.total.toLocaleString()}</span>
              </div>
              <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-surface-sunken">
                <i style={{ width: `${(100 * c.optimised) / c.total}%` }} className="bg-success" />
                <i style={{ width: `${(100 * c.missingDescription) / c.total}%` }} className="bg-warning" />
                <i style={{ width: `${(100 * c.noMetadata) / c.total}%` }} className="bg-danger" />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-4 text-ui-xs text-fg-muted">
            <span><b className="text-fg">{report.coverage.reduce((n, c) => n + c.optimised, 0).toLocaleString()}</b> with a description</span>
            <span className="text-warning-fg"><b>{report.coverage.reduce((n, c) => n + c.missingDescription, 0).toLocaleString()}</b> missing a description</span>
            <span className="text-danger-fg"><b>{report.coverage.reduce((n, c) => n + c.noMetadata, 0).toLocaleString()}</b> no metadata</span>
          </div>
        </div>
      )}
    </Card>
  )
}

/** One service: what it is, how it stands, and the one thing to do about it. */
function ServiceRow({ icon, name, state, tone, detail, action }: {
  icon: React.ReactNode
  name: string
  state: string
  tone: 'on' | 'off' | 'warn'
  detail?: string
  action?: React.ReactNode
}) {
  const dot = tone === 'on' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-fg-faint'
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-muted [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-ui-sm font-medium text-fg">{name}</p>
          <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <p className="truncate text-ui-xs text-fg-muted">{state}</p>
        </div>
        {detail && <p className="mt-0.5 text-ui-xs text-fg-subtle">{detail}</p>}
      </div>
      {action && <div className="shrink-0 pt-0.5 text-ui-xs">{action}</div>}
    </div>
  )
}

function ServicesCard({ report, workspaceId }: { report: HealthReport; workspaceId: string }) {
  const s = report.services
  return (
    <Card title="Services" sub="What the site serves search engines">
      <div className="mt-1 grid gap-x-8 sm:grid-cols-2 sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-border-subtle [&>*+*]:border-t [&>*+*]:border-border-subtle sm:[&>*:nth-child(2)]:border-t-0">
        <ServiceRow
          icon={<IconFileList />}
          name="Sitemap"
          state={`${s.sitemap.entries.toLocaleString()} ${s.sitemap.entries === 1 ? 'URL' : 'URLs'} in ${s.sitemap.pageCount} ${s.sitemap.pageCount === 1 ? 'file' : 'files'}`}
          tone={s.sitemap.entries > 0 ? 'on' : 'warn'}
          detail={s.sitemap.truncated ? 'Cut short at the size limit.' : s.sitemap.entries === 0 ? 'No page resolved a URL yet.' : undefined}
          action={<Link className={TEXT_LINK} to={seoManagerHref(workspaceId, 'sitemap')}>Report</Link>}
        />
        <ServiceRow
          icon={<IconProhibited />}
          name="robots.txt"
          state="Served"
          tone="on"
          action={<Link className={TEXT_LINK} to={seoManagerHref(workspaceId, 'tools')}>Preview</Link>}
        />
        <ServiceRow
          icon={<IconSparkles />}
          name="llms.txt"
          state={s.llmsTxt.enabled ? 'On' : 'Off'}
          tone={s.llmsTxt.enabled ? 'on' : 'off'}
          detail={s.llmsTxt.enabled ? undefined : 'AI answer engines read it when it is on.'}
          action={<Link className={TEXT_LINK} to={seoManagerHref(workspaceId, 'ai-geo')}>{s.llmsTxt.enabled ? 'Preview' : 'Turn on'}</Link>}
        />
        <ServiceRow
          icon={<IconBarChart />}
          name="Search Console"
          state={s.searchConsole.connected ? 'Connected' : 'Not connected'}
          tone={s.searchConsole.connected ? 'on' : 'off'}
          detail={s.searchConsole.connected ? undefined : 'Clicks, impressions and positions appear once connected.'}
          action={s.searchConsole.connected
            ? <Link className={TEXT_LINK} to={seoManagerHref(workspaceId, 'analytics')}>Analytics</Link>
            : <Link className={TEXT_LINK} to={`/${workspaceId}/settings/connections`}>Connect</Link>}
        />
      </div>
    </Card>
  )
}

interface AttentionRow {
  id: string
  type: string
  objectTitle: string | null
  state: 'good' | 'needs-work' | 'missing'
  issues: string[]
}

/**
 * The pages that need work, PAGED BY THE SERVER over the same list Titles &
 * Meta shows (`state=attention`), so there is no shortlist and no cap: what
 * the footer counts is every page that needs work.
 */
function AttentionCard({ workspaceId, onOpen }: { workspaceId: string; onOpen: (row: AttentionRow) => void }) {
  const navigate = useNavigate()
  const pageSize = DASHBOARD_PAGE_SIZE
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AttentionRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ state: 'attention', sort: 'state', limit: String(pageSize), offset: String((page - 1) * pageSize) })
      const res = await adminFetch<{ data: AttentionRow[]; meta: { total: number } }>(`/admin/ext/seo/titles?${params.toString()}`)
      setRows(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch (e) {
      setError((e as Error).message || 'The list could not be loaded.')
    } finally { setLoading(false) }
  }, [page])
  useEffect(() => { load() }, [load])

  const columns: DataListColumn<AttentionRow>[] = [
    {
      key: 'title', header: 'Page', icon: <IconTable />,
      cell: (o) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`size-2 shrink-0 rounded-full ${o.state === 'missing' ? 'bg-danger' : 'bg-warning'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{o.objectTitle || o.id}</p>
            <p className="truncate text-[11px] text-fg-subtle">{o.type}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'issues', header: 'What to fix', icon: <IconListChecks />,
      // The whole sentence, wrapped: the kit clips a cell at 30 characters by
      // default, which cut "Aim for 50-60 characters" mid-word.
      clipAt: false,
      cell: (o) => <span className="block whitespace-normal text-fg-muted">{o.issues.join(' ')}</span>,
    },
    {
      key: 'go', header: '', className: 'w-10 text-right',
      // The row is the target; the arrow says so without spending a word on it.
      cell: () => <IconChevronRight className="ml-auto size-4 text-fg-faint" aria-hidden="true" />,
    },
  ]

  return (
    <DataList<AttentionRow>
      chrome="framed"
      columns={columns}
      rows={rows}
      rowKey={(o) => `${o.type}:${o.id}`}
      loading={loading}
      onRowClick={onOpen}
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={setPage}
      error={error ? { message: error, onRetry: load } : undefined}
      toolbarLeft={<ListChip icon={<IconListChecks />} label="Needs attention" count={total} />}
      toolbarRight={(
        <Button size="xs" variant="secondary" onClick={() => navigate(`${seoManagerHref(workspaceId, 'titles')}?state=attention`)}>
          Edit all
        </Button>
      )}
      emptyState={{
        title: 'Nothing needs attention',
        description: 'Every published page has a title and description in the ideal range.',
      }}
    />
  )
}
