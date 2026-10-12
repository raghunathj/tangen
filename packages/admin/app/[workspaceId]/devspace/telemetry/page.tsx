/**
 * File Name: page.tsx
 * Purpose: Telemetry - what has been happening in this workspace and
 *          environment (closure plan Phase 9C, Units 28-32): the aggregate,
 *          and the recent events behind it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A DEVELOPER surface, in Devspace beside the Performance
 *          Monitor, which is unchanged - that page answers "what did THIS
 *          request do", this one answers "what has been happening". Phase 8B
 *          contracts throughout: loading is not empty, a filter that matches
 *          nothing is not an empty ring, an off capability is neither, and a
 *          failed load says so and offers a retry.
 */
import { useCallback, useEffect, useState } from 'react'
import { Callout } from '@tangen/ui'
import { useParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, Button, Badge, Text, DataList, Label, Select, SelectItem,
  type DataListColumn,
} from '@/kit'

interface Series {
  series: string
  count: number
  failed: number
  p50Ms: number | null
  p95Ms: number | null
  avgMs: number | null
  maxMs: number | null
}

interface Overview {
  enabled: boolean
  collecting: boolean
  since: number
  series: Series[]
  ring: { capacity: number; kept: number; written: number }
  dropped: Record<string, number>
  sampledOut: number
  scopes: number
}

interface TelemetryEvent {
  name: string
  timestamp: number
  severity: 'info' | 'warn' | 'error'
  status?: 'ok' | 'failed'
  durationMs?: number
  requestId?: string
  operationId?: string
  attributes?: Record<string, string | number | boolean>
}

const SEVERITY_TONE: Record<string, 'neutral' | 'warning' | 'error'> = { info: 'neutral', warn: 'warning', error: 'error' }

export default function TelemetryPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [events, setEvents] = useState<TelemetryEvent[]>([])
  const [meta, setMeta] = useState<{ filtered: boolean; kept: number; written: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Radix Select has no empty value, so 'all' is the sentinel for "no filter".
  const [name, setName] = useState('all')
  const [severity, setSeverity] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [o, e] = await Promise.all([
        adminFetch<{ data: Overview }>('/admin/telemetry/overview'),
        adminFetch<{ data: TelemetryEvent[]; meta: { filtered: boolean; kept: number; written: number } }>(
          '/admin/telemetry/events', undefined,
          {
            ...(name && name !== 'all' ? { name } : {}),
            ...(severity && severity !== 'all' ? { severity } : {}),
            limit: '100',
          },
        ),
      ])
      setOverview(o.data)
      setEvents(e.data ?? [])
      setMeta(e.meta)
    } catch (err) {
      // Phase 8B: a failed load is an ERROR, never "nothing has happened".
      setError((err as Error).message || 'Telemetry could not be loaded.')
    } finally { setLoading(false) }
  }, [name, severity])

  useEffect(() => { load() }, [load])

  usePageHeader({
    title: 'Telemetry',
    description: 'Recent operational events and their aggregate, held in memory for this process. Nothing is stored and nothing leaves the server.',
    actions: (
      <Button size="xs" variant="secondary" onClick={load}>Refresh</Button>
    ),
  })

  const columns: DataListColumn<TelemetryEvent>[] = [
    {
      key: 'when', header: 'When',
      cell: (e) => <span className="text-xs text-fg-muted tabular-nums" title={new Date(e.timestamp).toLocaleString()}>{new Date(e.timestamp).toLocaleTimeString()}</span>,
    },
    { key: 'name', header: 'Event', cell: (e) => <span className="font-mono text-xs">{e.name}</span> },
    {
      key: 'severity', header: 'Severity',
      cell: (e) => <Badge variant={SEVERITY_TONE[e.severity] ?? 'neutral'}>{e.severity}</Badge>,
    },
    {
      key: 'duration', header: 'Duration',
      cell: (e) => <span className="text-xs text-fg-muted tabular-nums">{e.durationMs != null ? `${e.durationMs}ms` : '-'}</span>,
    },
    {
      key: 'correlation', header: 'Correlation',
      cell: (e) => <span className="font-mono text-[11px] text-fg-subtle">{e.requestId ?? e.operationId ?? '-'}</span>,
    },
    {
      key: 'attributes', header: 'Detail',
      cell: (e) => (
        <span className="text-[11px] text-fg-muted">
          {Object.entries(e.attributes ?? {}).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}
        </span>
      ),
    },
  ]

  const totalDropped = Object.values(overview?.dropped ?? {}).reduce((n, v) => n + v, 0)

  return (
    <div className="p-6 space-y-4">
      {/* Not collecting is a CONDITION, not an empty list, and it says how to
          change it rather than leaving the reader to guess. */}
      {overview && !overview.collecting && (
        <div role="status" className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-fg-muted">
          Telemetry is not collecting in this process, so there is nothing recent to show.
          {' '}Set <span className="font-mono">TANGEN_TELEMETRY=1</span> to turn it on. Nothing is stored, and nothing is sent anywhere.
        </div>
      )}

      {overview && totalDropped > 0 && (
        <Callout variant="warning">{totalDropped} event{totalDropped === 1 ? '' : 's'} did not reach the ring
          ({Object.entries(overview.dropped).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ')}).
          Telemetry drops its own data rather than slowing anything down.</Callout>
      )}

      {overview && overview.collecting && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Events kept" value={`${overview.ring.kept} / ${overview.ring.capacity}`} help={`${overview.ring.written} seen`} />
          <Stat label="Series" value={String(overview.series.length)} help="metric combinations" />
          <Stat label="Sampled out" value={String(overview.sampledOut)} help="successes not kept" />
          <Stat label="Since" value={new Date(overview.since).toLocaleTimeString()} help="this process" />
        </div>
      )}

      {overview && overview.series.length > 0 && (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-sunken">
              <tr>
                {['Series', 'Count', 'Failed', 'p50', 'p95', 'Max'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-fg-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overview.series.map((s) => (
                <tr key={s.series}>
                  <td className="px-3 py-2 font-mono">{s.series}</td>
                  <td className="px-3 py-2 tabular-nums">{s.count}</td>
                  <td className="px-3 py-2 tabular-nums">{s.failed || '-'}</td>
                  <td className="px-3 py-2 tabular-nums">{s.p50Ms != null ? `≤${s.p50Ms}ms` : '-'}</td>
                  <td className="px-3 py-2 tabular-nums">{s.p95Ms != null ? `≤${s.p95Ms}ms` : '-'}</td>
                  <td className="px-3 py-2 tabular-nums">{s.maxMs != null ? `${s.maxMs}ms` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Text variant="help">
            Percentiles are bucket boundaries, not exact values: telemetry counts durations into twelve buckets rather than keeping every sample.
          </Text>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label htmlFor="telemetry-event">Event</Label>
          <Select id="telemetry-event" value={name} onValueChange={setName}>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="http.request.completed">Requests</SelectItem>
            <SelectItem value="db.query.completed">Queries</SelectItem>
            <SelectItem value="flow.execution.completed">Flow executions</SelectItem>
            <SelectItem value="release.apply.completed">Releases</SelectItem>
          </Select>
        </div>
        <div className="w-44">
          <Label htmlFor="telemetry-severity">Severity</Label>
          <Select id="telemetry-severity" value={severity} onValueChange={setSeverity}>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="error">Errors</SelectItem>
            <SelectItem value="warn">Warnings</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </Select>
        </div>
      </div>

      <DataList<TelemetryEvent>
        columns={columns}
        rows={events}
        rowKey={(e) => `${e.timestamp}:${e.name}:${e.requestId ?? e.operationId ?? ''}`}
        loading={loading}
        filtered={Boolean(meta?.filtered)}
        error={error ? { message: error, onRetry: load } : undefined}
        emptyState={{
          title: overview?.collecting ? 'Nothing recorded yet' : 'Telemetry is not collecting',
          description: overview?.collecting
            ? 'Events appear here as requests, queries and flows run in this environment.'
            : 'Turn it on to see recent operational events.',
        }}
        filteredEmptyState={{
          title: 'Nothing matches these filters',
          description: `The ring holds ${meta?.kept ?? 0} event${meta?.kept === 1 ? '' : 's'}, none of them matching.`,
          action: <Button size="sm" variant="secondary" onClick={() => { setName('all'); setSeverity('all') }}>Clear filters</Button>,
        }}
      />

      <Text variant="help">
        This is the last {overview?.ring.capacity ?? 500} events of this process, in memory. It does not survive a restart, and it is not a record of anything: job runs, flow runs, release history and the audit log are the durable ones.
      </Text>
    </div>
  )
}

function Stat({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="text-lg font-semibold text-fg tabular-nums">{value}</p>
      <p className="text-[11px] text-fg-subtle">{help}</p>
    </div>
  )
}
