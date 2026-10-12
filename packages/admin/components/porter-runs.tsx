/**
 * PorterRuns - the migration runs surface (M-T4). Lists runs newest first,
 * refetches when the server announces a run changed (realtime R1: the
 * porter:runs topic, which replaced the 2 s polling loop), expands a run
 * into its failure list, and offers CSV/JSONL report downloads. A manual
 * refresh stays for the case where the connection is down. Realtime R2:
 * an active run's bar follows its own `migration:<runId>` topic (one frame
 * per second at most, the final count always), so it moves between list
 * refetches without one.
 */

import { useEffect, useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { adminFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { useRealtime, useRealtimeStatus } from '@/lib/realtime'
import type { PorterRun } from '@/lib/porter-runs'
import { progressPercent, isRunActive, runCountsLine, parseResultsJsonl } from '@/lib/porter-runs'
import { apiOrigin } from '@/lib/api-origin'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Queued',    cls: 'bg-surface-sunken text-fg-muted border-border' },
  running:   { label: 'Running',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'Completed', cls: 'bg-green-50 text-green-700 border-green-200' },
  failed:    { label: 'Failed',    cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

function fmtWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** An active run's counters, live from `migration:<runId>`, falling back to the listed row. */
function RunProgress({ run}: { run: PorterRun; }) {
  const [live, setLive] = useState<{ processedItems: number; totalItems: number } | null>(null)
  useEffect(() => { setLive(null) }, [run.id, run.processedItems, run.totalItems])
  useRealtime(`migration:${run.id}`, (event) => {
    const d = event.data as { processedItems?: number; totalItems?: number }
    if (typeof d.processedItems === 'number' && typeof d.totalItems === 'number') setLive({ processedItems: d.processedItems, totalItems: d.totalItems })
  }, { enabled: isRunActive(run) })
  const counters = live ?? { processedItems: run.processedItems, totalItems: run.totalItems }
  const pct = progressPercent({ ...counters, status: run.status })
  return (
    <>
      <span className="text-xs text-fg-muted tabular-nums shrink-0" data-testid="run-progress">{counters.processedItems} of {counters.totalItems}</span>
      <div className="mt-2 h-1.5 rounded-full bg-surface-sunken overflow-hidden basis-full">
        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </>
  )
}

export function PorterRuns({ refreshToken = 0 }: { refreshToken?: number }) {
  const [runs, setRuns] = useState<PorterRun[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, Record<string, unknown>[]>>({})

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<{ data: PorterRun[] }>('/sync/runs')
      setRuns(res.data ?? [])
    } catch { /* keep last state */ } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshToken])

  // Realtime signals, it does not replicate: every porter.run.changed on the
  // workspace-scoped porter:runs topic refetches the list (created, claimed,
  // progressed, finished), so the progress bar moves without a timer.
  useRealtime('porter:runs', () => { load() }, { onResync: () => { load() } })
  const realtimeStatus = useRealtimeStatus()

  async function toggleExpand(run: PorterRun) {
    if (expanded === run.id) { setExpanded(null); return }
    setExpanded(run.id)
    if ((run.counts?.failed ?? 0) > 0 && !failures[run.id]) {
      try {
        const apiHost = apiOrigin()
        const token = useAuthStore.getState().accessToken
        const res = await fetch(`${apiHost}/api/v1/sync/runs/${run.id}/results?failed=1`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          setFailures((f) => ({ ...f, [run.id]: parseResultsJsonl('') }))
          const text = await res.text()
          setFailures((f) => ({ ...f, [run.id]: parseResultsJsonl(text) }))
        }
      } catch { /* leave absent */ }
    }
  }

  async function download(run: PorterRun, format: 'csv' | 'jsonl') {
    try {
      const apiHost = apiOrigin()
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`${apiHost}/api/v1/sync/runs/${run.id}/results?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${run.id}-results.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* no-op */ }
  }

  async function downloadBundle(run: PorterRun) {
    try {
      const apiHost = apiOrigin()
      const token = useAuthStore.getState().accessToken
      const res = await fetch(`${apiHost}/api/v1/sync/runs/${run.id}/bundle`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${run.id}.tangen-export.tar.gz`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* no-op */ }
  }

  async function cancel(run: PorterRun) {
    try {
      await adminFetch(`/sync/runs/${run.id}/cancel`, { method: 'POST' })
      load()
    } catch { /* no-op */ }
  }

  if (!loaded) return null
  if (runs.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-fg-subtle">
        No runs yet. Promotions, exports and imports appear here.
      </p>
    )
  }

  const live = realtimeStatus === 'open'

  return (
    <section>
      <div className="flex items-center justify-end gap-2 mb-2 text-[11px] text-fg-subtle">
        <span className="flex items-center gap-1" title={live ? 'Updates arrive as runs change' : `Realtime ${realtimeStatus}: refresh to see changes`}>
          <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', live ? 'bg-green-500' : 'bg-gray-400')} aria-hidden="true" />
          {live ? 'Live' : 'Not live'}
        </span>
        <button type="button" onClick={() => load()} className="text-accent-fg hover:underline">Refresh</button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
        {runs.map((run) => {
          const meta = STATUS_META[run.status] ?? STATUS_META.pending
          const countsLine = runCountsLine(run)
          return (
            <div key={run.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(run)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block text-sm font-medium text-fg truncate">
                    {run.scope?.typeName ?? run.kind} · {run.totalItems} {run.totalItems === 1 ? 'item' : 'items'}
                  </span>
                  <span className="block text-[11px] text-fg-subtle mt-0.5">
                    {fmtWhen(run.createdAt)}
                    {countsLine && <> · {countsLine}</>}
                  </span>
                </button>
                {isRunActive(run) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => cancel(run)}
                      className="text-xs text-red-600 hover:underline shrink-0"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    {run.kind === 'export' && run.status === 'completed' && (
                      <button type="button" onClick={() => downloadBundle(run)} className="text-[11px] text-accent-fg hover:underline font-medium">Download bundle</button>
                    )}
                    <button type="button" onClick={() => download(run, 'csv')} className="text-[11px] text-accent-fg hover:underline">CSV</button>
                    <button type="button" onClick={() => download(run, 'jsonl')} className="text-[11px] text-accent-fg hover:underline">JSONL</button>
                  </div>
                )}
                <span className={clsx('px-1.5 py-0.5 rounded text-[11px] font-medium border shrink-0', meta.cls)}>
                  {meta.label}
                </span>
                {isRunActive(run) && <RunProgress run={run} />}
              </div>

              {run.error && (
                <p className="mt-1.5 text-[11px] text-red-700">{run.error}</p>
              )}

              {expanded === run.id && (run.counts?.failed ?? 0) > 0 && (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 max-h-40 overflow-y-auto space-y-1">
                  {(failures[run.id] ?? []).map((f: any) => (
                    <p key={String(f.objectId)} className="text-[11px] text-red-700">
                      <span className="font-mono">{f.title || f.objectId}</span>: {f.error}
                    </p>
                  ))}
                  {!failures[run.id] && <p className="text-[11px] text-red-700 animate-pulse">Loading failures…</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
