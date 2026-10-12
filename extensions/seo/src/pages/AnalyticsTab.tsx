/**
 * File Name: AnalyticsTab.tsx
 * Purpose: The Analytics page (plan-seo-manager-v2 V4): what Search Console
 *          reported, read from the stored daily aggregates - totals with the
 *          window before them, a click sparkline, the top pages and the top
 *          queries. Nothing is shown that was not synced: without a
 *          connection or a property the page says what to do instead of
 *          showing zeroes, and Sync now is the only thing that calls Google.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdminPage, Button, Callout, Panel, Text, adminFetch, toast, useCan, TEXT_LINK } from '@/kit'
import { IconRefresh } from '@tangen/icons'
import { changeOf, syncNotice, type Summary, type TopRow, type Totals } from '../lib/analytics'
import { seoManagerHref } from '../lib/seo-manager-nav'

interface Connection { connected: boolean; label?: string; property?: string | null; reason?: string }
export interface AnalyticsViewData {
  days: number
  summary: Summary | null
  pages: TopRow[]
  queries: TopRow[]
  sync: { lastSyncedAt?: string; lastError?: string | null; lastErrorKind?: 'connection' | 'property' | 'provider'; lastErrorAt?: string; intervalHours: number }
  connection: Connection
  limits: { retentionDays: number; rowLimit: number }
}

const RANGES = [7, 28, 90] as const

export function SeoAnalyticsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const { hasCapability } = useCan()
  const canWrite = hasCapability('seo:write')
  const [days, setDays] = useState<number>(28)
  const [view, setView] = useState<AnalyticsViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (span: number) => {
    try {
      const r = await adminFetch<{ data: AnalyticsViewData }>(`/admin/ext/seo/analytics?days=${span}`)
      setView(r.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analytics could not be loaded')
    }
  }, [])
  useEffect(() => { load(days).finally(() => setLoading(false)) }, [days, load])

  const sync = async () => {
    setBusy(true)
    try {
      const r = await adminFetch<{ data?: { days: number }; error?: { message: string } }>('/admin/ext/seo/analytics/sync', { method: 'POST' })
      if (r.error) toast.error(r.error.message)
      else { toast.success(`Synced ${r.data?.days ?? 0} days from Search Console`); await load(days) }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The sync could not run')
    } finally { setBusy(false) }
  }

  return (
    <AdminPage
      title="Analytics"
      description="Clicks, impressions and positions from Google Search Console."
      access={{ capability: 'seo:read' }}
      loading={loading}
      actions={canWrite && view?.connection.connected
        ? <Button size="sm" variant="secondary" icon={<IconRefresh className="size-3.5" />} disabled={busy} onClick={sync}>{busy ? 'Syncing' : 'Sync now'}</Button>
        : undefined}
      toolbar={view?.connection.connected ? (
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <Button key={r} size="xs" variant={r === view.days ? 'primary' : 'ghost'} onClick={() => setDays(r)}>Last {r} days</Button>
          ))}
        </div>
      ) : undefined}
    >
      {view && (
        <div className="space-y-4">
          {(() => {
            // ONE notice, from one rule: what blocks a sync now outranks what
            // failed before, and a failure whose cause is gone reads as
            // history with an action (the user, 2026-09-20).
            const notice = syncNotice({ sync: view.sync, connection: view.connection })
            if (!notice) return null
            return (
              <Callout
                variant={notice.kind === 'failed' ? 'danger' : notice.kind === 'stale' ? 'info' : view.connection.connected ? 'warning' : 'info'}
                title={notice.title}
              >
                <p>{notice.message}</p>
                {notice.at && <p className="mt-1 text-ui-xs text-fg-subtle">{`Recorded ${new Date(notice.at).toLocaleString()}.`}</p>}
                {notice.kind === 'blocked' && (
                  <p className="mt-2">
                    {view.connection.connected
                      ? <>Pick it on this manager's <Link className={TEXT_LINK} to={`/${workspaceId}/extensions/seo/settings`}>Settings</Link> tab, under Search Console.</>
                      : <>Add the connection under <Link className={TEXT_LINK} to={`/${workspaceId}/settings/connections`}>Settings, Connections</Link>, then choose it and the property on this manager's <Link className={TEXT_LINK} to={`/${workspaceId}/extensions/seo/settings`}>Settings</Link> tab.</>}
                  </p>
                )}
              </Callout>
            )
          })()}

          {view.summary && view.summary.days > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Clicks" summary={view.summary} metric="clicks" format={(n) => Math.round(n).toLocaleString()} />
                <Stat label="Impressions" summary={view.summary} metric="impressions" format={(n) => Math.round(n).toLocaleString()} />
                <Stat label="Average CTR" summary={view.summary} metric="ctr" format={(n) => `${(n * 100).toFixed(1)}%`} />
                <Stat label="Average position" summary={view.summary} metric="position" format={(n) => n.toFixed(1)} />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <TopTable title="Top pages" sub={`by clicks, last ${view.days} days`} rows={view.pages} />
                <TopTable title="Top queries" sub={`by clicks, last ${view.days} days`} rows={view.queries} />
              </div>
            </>
          ) : view.connection.connected ? (
            <Callout variant="info" title="Nothing synced yet">
              Search Console data arrives with the daily sync, or press Sync now. Google reports a day about two days late.
            </Callout>
          ) : null}

          <Text variant="help">
            {view.sync.lastSyncedAt ? `Last synced ${new Date(view.sync.lastSyncedAt).toLocaleString()}.` : 'Not synced yet.'}
            {` Synced every ${view.sync.intervalHours} hours, keeping ${view.limits.retentionDays} days of daily totals with the top ${view.limits.rowLimit} pages and queries per day. Change either on the Settings tab.`}
          </Text>
        </div>
      )}
    </AdminPage>
  )
}

/** One metric: its total, how it moved against the window before, and its daily shape. Shared with the Dashboard. */
export function Stat({ label, summary, metric, format }: { label: string; summary: Summary; metric: keyof Totals; format: (n: number) => string }) {
  const change = changeOf(summary, metric)
  return (
    <Panel>
      <p className="text-ui-xs font-medium text-fg-subtle">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">{format(summary[metric])}</p>
      {change ? (
        <p className={`text-ui-xs font-semibold ${change.better ? 'text-success-fg' : 'text-danger-fg'}`}>
          {change.delta >= 0 ? '+' : ''}{(change.delta * 100).toFixed(1)}% <span className="font-medium text-fg-faint">vs previous {summary.days} days</span>
        </p>
      ) : (
        <p className="text-ui-xs text-fg-subtle">No earlier window to compare</p>
      )}
      <Sparkline values={summary.series} className="mt-2.5" />
    </Panel>
  )
}

/** A line over the window, scaled to its own range; flat when everything is equal. */
function Sparkline({ values, className = '' }: { values: number[]; className?: string }) {
  if (values.length < 2) return <div className={`h-8 ${className}`} />
  const w = 180, h = 32, max = Math.max(...values), min = Math.min(...values)
  const span = max - min || 1
  const step = w / (values.length - 1)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-8 w-full text-accent ${className}`} aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="currentColor" opacity="0.12" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function TopTable({ title, sub, rows }: { title: string; sub: string; rows: TopRow[] }) {
  return (
    <Panel flush>
      <div className="flex items-baseline gap-2 p-5 pb-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <span className="text-ui-xs text-fg-subtle">{sub}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-ui-xs text-fg-subtle">Nothing reported for this window.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-ui-xs font-medium text-fg" title={r.key}>{r.key}</span>
              <span className="w-16 shrink-0 text-right text-ui-xs font-semibold text-fg tabular-nums">{r.clicks.toLocaleString()}</span>
              <span className="w-14 shrink-0 text-right text-ui-xs text-fg-subtle tabular-nums">{r.position.toFixed(1)}</span>
              <span className="w-20 shrink-0"><Sparkline values={r.series} /></span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
