import { useCallback, useEffect, useState } from 'react'
import { IconSearch, IconAlert, IconBarChart } from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import { TabBar } from '@/kit'

interface TermCount { term: string; count: number }
interface Summary {
  total: number
  uniqueTerms: number
  zeroResultRate: number
  topSearches: TermCount[]
  zeroResultSearches: TermCount[]
  trend: { date: string; count: number }[]
}
type Audience = 'all' | 'public' | 'internal'

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-fg-subtle mb-0.5">{label}</p>
      <p className="text-2xl font-semibold text-fg tabular-nums">{value}</p>
      {sub && <p className="text-xs text-fg-subtle mt-0.5">{sub}</p>}
    </div>
  )
}

function TermList({ title, icon, rows, empty, accent }: { title: string; icon: React.ReactNode; rows: TermCount[]; empty: string; accent?: boolean }) {
  const max = rows[0]?.count ?? 1
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className={accent ? 'text-warning-fg' : 'text-fg-subtle'}>{icon}</span>
        <h3 className="text-sm font-medium text-fg">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-subtle">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.term} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1 min-w-0 truncate text-sm text-fg">{r.term}</span>
              <span className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" style={{ width: 80 }}>
                <span className={`block h-full ${accent ? 'bg-warning' : 'bg-blue-500'}`} style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
              </span>
              <span className="w-10 text-right text-sm text-fg-muted tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AnalyticsView() {
  const [audience, setAudience] = useState<Audience>('all')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const q: Record<string, string> = { days: '30' }
      if (audience !== 'all') q.audience = audience
      const res = await adminFetch<{ data: Summary }>('/admin/search-analytics', undefined, q)
      setSummary(res.data)
    } catch (e) { setError((e as Error).message ?? 'Failed to load analytics') }
    finally { setLoading(false) }
  }, [audience])
  useEffect(() => { void load() }, [load])

  const maxTrend = Math.max(1, ...(summary?.trend ?? []).map((t) => t.count))

  return (
    <div className="space-y-6" data-testid="search-analytics">
      <TabBar
        variant="pills"
        active={audience}
        onChange={(v) => setAudience(v as Audience)}
        tabs={[{ id: 'all', label: 'All' }, { id: 'public', label: 'Site Search' }, { id: 'internal', label: 'Admin Search' }]}
      />

      {loading && <p className="text-sm text-fg-subtle">Loading…</p>}
      {error && <p className="text-sm text-danger-fg">{error}</p>}

      {summary && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Total searches" value={summary.total.toLocaleString()} sub="last 30 days" />
            <StatCard label="Unique terms" value={summary.uniqueTerms.toLocaleString()} />
            <StatCard label="No-result rate" value={`${Math.round(summary.zeroResultRate * 100)}%`} sub="of all searches" />
          </div>

          {summary.total === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-12 text-center">
              <IconSearch className="mx-auto size-6 text-fg-subtle" />
              <p className="mt-2 text-sm text-fg-muted">No searches logged yet in this window.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <TermList title="Top searches" icon={<IconBarChart className="size-4" />} rows={summary.topSearches} empty="No searches yet" />
                <TermList title="No-result searches" icon={<IconAlert className="size-4" />} rows={summary.zeroResultSearches} empty="Every search found something 🎉" accent />
              </div>
              <div className="rounded-lg border border-border bg-surface overflow-hidden">
                <div className="px-4 py-3 border-b border-border"><h3 className="text-sm font-medium text-fg">Volume</h3></div>
                <div className="flex items-end gap-1 px-4 py-4" style={{ height: 120 }}>
                  {summary.trend.map((t) => (
                    <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${t.date}: ${t.count}`}>
                      <span className="w-full rounded-t bg-blue-500/80" style={{ height: `${Math.round((t.count / maxTrend) * 88)}%` }} />
                      <span className="text-[10px] text-fg-subtle tabular-nums">{t.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
