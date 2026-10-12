

import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  IconArrowLeft, IconCheck, IconX,
  IconChevronDown, IconChevronRight, IconRefresh, IconRepeat,
} from '@tangen/icons'
import { adminFetch } from '@/lib/api'
import {
  eventBadgeClass, timeAgo, buildReplayPath, canReplay,
  filterDeliveries, deliveryEventOptions, type DeliveryFilters,
} from '@/lib/webhook-logs'
import { toast } from '@/lib/toast'
import { Button, FilterDropdown } from '@/kit'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Delivery {
  id: string
  event: string
  typeName: string
  objectId: string
  payload: Record<string, unknown>
  statusCode: number | null
  responseBody: string | null
  durationMs: number | null
  success: boolean
  error: string | null
  createdAt: string
}

// ── Expandable row ────────────────────────────────────────────────────────────

function DeliveryRow({
  d,
  webhookId,
  onReplayed,
}: {
  d: Delivery
  webhookId: string
  onReplayed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [replaying, setReplaying] = useState(false)

  async function handleReplay(e: React.MouseEvent) {
    e.stopPropagation()
    setReplaying(true)
    try {
      const res = await adminFetch<{ deliveryId: string }>(buildReplayPath(webhookId, d.id), { method: 'POST' })
      toast.success('Replay queued', `New delivery ID: ${res.deliveryId}`)
      onReplayed()
    } catch (err: any) {
      toast.error('Replay failed', err.message ?? 'Could not queue replay')
    } finally {
      setReplaying(false)
    }
  }

  return (
    <>
      <tr
        className="hover:bg-surface-sunken cursor-pointer transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-4 py-3 w-6">
          {open
            ? <IconChevronDown className="size-4 text-fg-subtle" />
            : <IconChevronRight className="size-4 text-fg-subtle" />}
        </td>
        <td className="px-4 py-3">
          <span className={clsx(
            'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1',
            eventBadgeClass(d.event),
          )}>
            {d.event.replace('object.', '')}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-fg font-medium">{d.typeName}</td>
        <td className="px-4 py-3 text-xs text-fg-subtle font-mono">{d.objectId}</td>
        <td className="px-4 py-3">
          <span className={clsx(
            'inline-flex items-center gap-1 text-xs font-medium',
            d.success ? 'text-green-600' : 'text-red-600',
          )}>
            {d.success
              ? <IconCheck className="size-3.5" />
              : <IconX className="size-3.5" />}
            {d.statusCode ?? (d.error ? 'Error' : '-')}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-fg-subtle">
          {d.durationMs != null ? `${d.durationMs}ms` : '-'}
        </td>
        <td className="px-4 py-3 text-xs text-fg-subtle whitespace-nowrap">
          {timeAgo(d.createdAt)}
        </td>
        <td className="px-4 py-3 w-8">
          {canReplay(d) && (
            <button
              onClick={handleReplay}
              disabled={replaying}
              title="Replay this delivery"
              className="flex items-center justify-center rounded p-1 text-fg-subtle hover:text-accent-fg hover:bg-accent-muted disabled:opacity-40 transition-colors"
            >
              <IconRepeat className={clsx('size-3.5', replaying && 'animate-spin')} />
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr className="bg-surface-sunken">
          <td colSpan={8} className="px-4 pb-4 pt-0">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">
                  Request payload
                </p>
                <pre className="text-xs bg-surface-inverted text-surface rounded-lg p-3 overflow-x-auto max-h-64">
                  {JSON.stringify(d.payload, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">
                  Response {d.statusCode ? `(${d.statusCode})` : ''}
                </p>
                {d.error && !d.statusCode && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                    {d.error}
                  </div>
                )}
                {d.responseBody != null ? (
                  <pre className="text-xs bg-surface-inverted text-surface rounded-lg p-3 overflow-x-auto max-h-64">
                    {d.responseBody || '(empty response body)'}
                  </pre>
                ) : (
                  <p className="text-xs text-fg-subtle italic">No response received</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WebhookLogsPage() {
  const params = useParams<{ workspaceId: string; webhookId: string }>()
  const navigate = useNavigate()
  const { workspaceId, webhookId } = params

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState('')
  const [status, setStatus] = useState<DeliveryFilters['status']>('')
  const [since, setSince] = useState<DeliveryFilters['since']>('')

  const filtersActive = Boolean(event || status || since)
  const eventOptions = useMemo(() => deliveryEventOptions(deliveries), [deliveries])
  const visible = useMemo(
    () => filterDeliveries(deliveries, { event, status, since }),
    [deliveries, event, status, since],
  )

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await adminFetch<{ data: Delivery[] }>(`/webhooks/${webhookId}/deliveries`)
      setDeliveries(res.data)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [webhookId])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/${workspaceId}/settings/webhooks`)}
            className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors"
          >
            <IconArrowLeft className="size-4" />
            Webhooks
          </button>
          <span className="text-gray-300">/</span>
          <h1 className="text-base font-semibold text-fg">Delivery log</h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg disabled:opacity-40 transition-colors"
        >
          <IconRefresh className={clsx('size-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {deliveries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <FilterDropdown
            label="Event"
            value={event}
            onChange={setEvent}
            options={[
              { value: '', label: 'All events' },
              ...eventOptions.map((e) => ({ value: e, label: e })),
            ]}
          />
          <FilterDropdown
            label="Status"
            value={status ?? ''}
            onChange={(v) => setStatus(v as DeliveryFilters['status'])}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'success', label: 'Succeeded' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
          <FilterDropdown
            label="Time"
            value={since ?? ''}
            onChange={(v) => setSince(v as DeliveryFilters['since'])}
            options={[
              { value: '', label: 'Any time' },
              { value: 'hour', label: 'Last hour' },
              { value: 'day', label: 'Last 24 hours' },
              { value: 'week', label: 'Last 7 days' },
            ]}
          />
          {filtersActive && (
            <Button size="xs" variant="ghost" onClick={() => { setEvent(''); setStatus(''); setSince('') }}>Clear</Button>
          )}
        </div>
      )}

      {!loading && !error && deliveries.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-fg-muted">No deliveries yet</p>
          <p className="text-xs text-fg-subtle mt-0.5">
            Deliveries appear here when content events fire and match this webhook's configuration.
          </p>
        </div>
      )}

      {deliveries.length > 0 && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium text-fg-muted">No deliveries match these filters</p>
          <p className="text-xs text-fg-subtle mt-0.5">
            Try widening the event, status, or time filter - or clear them.
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunken">
                <th className="w-6 px-4 py-2.5" />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Event</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Object ID</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Duration</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">When</th>
                <th className="w-8 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((d) => (
                <DeliveryRow
                  key={d.id}
                  d={d}
                  webhookId={webhookId}
                  onReplayed={load}
                />
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2.5 text-xs text-fg-subtle border-t border-border">
            {filtersActive
              ? `Showing ${visible.length} of the last ${deliveries.length} deliveries`
              : `Showing last ${deliveries.length} deliveries`}
          </p>
        </div>
      )}
    </div>
  )
}
