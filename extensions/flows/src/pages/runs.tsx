/**
 * File Name: runs.tsx
 * Purpose: Run history - a DataList of runs (status icon, flow, trigger,
 *          duration, when) with status/date filters; clicking a row opens
 *          a Sheet with the per-step log (humanized names, clean JSON),
 *          so "why didn't it fire?" is self-serve. Shared by the per-flow
 *          page and the "All runs" tab.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, Button, Badge, Text, DataList, DatePicker, toast,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle,
  type DataListColumn,
  FilterDropdown,
} from '@/kit'
import { DynamicIcon } from '@/kit'
import { HighlightedJson } from '../components/code'

// Human names for whatever lands in a step log's `action` field.
const STEP_LABELS: Record<string, string> = {
  condition: 'If',
  switch: 'Switch',
  transform: 'Transform',
  wait: 'Wait',
  loop: 'For each',
  guard: 'Safety limit',
  http: 'HTTP request',
  email: 'Send email',
  content: 'Content operation',
  query: 'Query content',
  label: 'System Label',
  run_flow: 'Run flow',
  code: 'Run code',
  log: 'Log',
}

function stepLabel(l: Record<string, unknown>): string {
  const action = String(l.action ?? '')
  const base = STEP_LABELS[action] ?? action.replace(/[_:]/g, ' ')
  const iter = String(l.step ?? '').match(/\[(\d+)\]$/)
  return iter ? `${base} (iteration ${Number(iter[1]) + 1})` : base
}

/** Per-step run log - humanized names, clean output JSON. */
function StepLog({ log }: { log: Array<Record<string, unknown>> }) {
  if (!log?.length) return <Text variant="help">No steps ran (conditions may not have matched).</Text>
  return (
    <div className="space-y-1.5">
      {log.map((l, i) => (
        <details key={i} className="border border-border rounded-md bg-surface" open={!l.ok}>
          <summary className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none text-sm" title={String(l.step)}>
            <DynamicIcon name={l.ok ? 'IconCheckCircle' : 'IconCloseCircle'} className={`size-4 shrink-0 ${l.ok ? 'text-success' : 'text-danger-fg'}`} />
            <span className="font-medium text-fg">{stepLabel(l)}</span>
            {(l.output as { dryRun?: boolean } | undefined)?.dryRun && <Badge variant="neutral">simulated</Badge>}
            <span className="ml-auto text-xs text-fg-subtle tabular-nums">{String(l.ms)}ms</span>
          </summary>
          <div className="px-2.5 pb-2 pt-0.5">
            {l.error != null && <p className="text-xs text-danger-fg whitespace-pre-wrap mb-1">{String(l.error)}</p>}
            {l.output != null && <HighlightedJson value={l.output} />}
          </div>
        </details>
      ))}
    </div>
  )
}

export interface RunRow {
  flowId: string
  flowName: string
  status: 'completed' | 'skipped' | 'error' | 'waiting' | string
  ms: number
  triggerType: string
  startedAt: string
  log: Array<Record<string, unknown>>
  /** Server-stamped: the flow this run belonged to no longer exists. */
  flowDeleted?: boolean
  // ── What Phase 9B added, so an operator can answer their own questions ──
  /** The identity every attempt of this run shares. */
  executionId?: string
  /** WHICH graph ran: later edits do not rewrite this history. */
  definition?: { checksum: string; version: number }
  /** How many attempts the failing node has had. */
  attempts?: number
  /** When the next attempt is due, while one is scheduled. */
  nextRetryAt?: string | null
  nextAttempt?: number | null
  /** The typed, redacted failure. */
  failure?: { code: string; message: string; retryable: string; nodeId?: string; attempt?: number } | null
}

/**
 * A run's status, as an icon a person reads at a glance. Four of these names
 * did not exist (`IconCircleCheck`, `IconCircleX`, `IconCircleMinus`,
 * `IconAlertTriangle`), and DynamicIcon answers an unknown name with its
 * IconFileText fallback - so a completed run showed a green PAGE and a failed
 * one a red page, which reads as "a document" and not as an outcome. The
 * icon-name test below now holds every one of these to the icon set.
 */
export const STATUS_META: Record<string, { icon: string; cls: string; label: string }> = {
  completed: { icon: 'IconCheckCircle', cls: 'text-success', label: 'Completed' },
  error: { icon: 'IconCloseCircle', cls: 'text-danger-fg', label: 'Failed' },
  skipped: { icon: 'IconMinus', cls: 'text-fg-subtle', label: 'Skipped (conditions)' },
  waiting: { icon: 'IconLoader', cls: 'text-warning animate-spin', label: 'In progress (waiting)' },
  running: { icon: 'IconLoader', cls: 'text-info animate-spin', label: 'Running' },
  waiting_retry: { icon: 'IconRefresh', cls: 'text-warning', label: 'Waiting to retry' },
  cancelled: { icon: 'IconProhibited', cls: 'text-fg-subtle', label: 'Cancelled' },
  'circuit-breaker': { icon: 'IconAlert', cls: 'text-warning', label: 'Circuit breaker' },
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleString()
}

export interface RunFilters {
  status: string   // '' = all
  from: string     // yyyy-mm-dd or ''
  to: string
}

export const EMPTY_FILTERS: RunFilters = { status: '', from: '', to: '' }
const PAGE_SIZE = 25

/** Compact status + date-range controls (content-list toolbar style). */
export function RunsToolbar({ filters, onChange }: {
  filters: RunFilters
  onChange: (f: RunFilters) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <FilterDropdown
        label="Status"
        value={filters.status}
        onChange={(v) => onChange({ ...filters, status: v })}
        options={[
          { value: '', label: 'All statuses' },
          { value: 'completed', label: 'Completed' },
          { value: 'error', label: 'Failed' },
          { value: 'skipped', label: 'Skipped' },
          { value: 'waiting', label: 'In progress' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
      />
      <DatePicker size="sm" withTime className="w-44" value={filters.from || undefined} onChange={(v: string | undefined) => onChange({ ...filters, from: v ?? '' })} placeholder="From date" />
      <span className="text-xs text-fg-subtle">to</span>
      <DatePicker size="sm" withTime className="w-44" value={filters.to || undefined} onChange={(v: string | undefined) => onChange({ ...filters, to: v ?? '' })} placeholder="To date" />
      {(filters.status || filters.from || filters.to) && (
        <Button size="xs" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>Clear</Button>
      )}
    </div>
  )
}

/** Run detail - the step-by-step log in a side sheet. */
/** When the next attempt is due, in words an operator reads at a glance. */
function dueIn(iso: string): string {
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000)
  if (!Number.isFinite(s)) return ''
  if (s <= 0) return 'due now'
  if (s < 90) return `in ${s}s`
  if (s < 5400) return `in ${Math.round(s / 60)}m`
  return `at ${new Date(iso).toLocaleTimeString()}`
}

function RunSheet({ run, onClose, onOpenFlow, onRetry, onCancel, busy }: {
  run: RunRow
  onClose: () => void
  onOpenFlow?: (flowId: string) => void
  onRetry?: (run: RunRow) => void
  onCancel?: (run: RunRow) => void
  busy?: boolean
}) {
  const meta = STATUS_META[run.status] ?? { icon: 'IconMinus', cls: 'text-fg-subtle', label: run.status }
  const failed = run.status === 'error' ? run.log?.find((l) => !l.ok) : undefined
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            <span className="flex items-center gap-2">
              <DynamicIcon name={meta.icon} className={`size-5 shrink-0 ${meta.cls}`} />
              {run.flowName}
            </span>
          </SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 flex-wrap text-xs text-fg-muted">
              <Badge variant={run.status === 'completed' ? 'success' : run.status === 'error' ? 'error' : run.status === 'waiting' ? 'warning' : 'neutral'}>{meta.label}</Badge>
              <span>via {run.triggerType}</span>
              <span>·</span>
              <span className="tabular-nums">{run.ms}ms</span>
              <span>·</span>
              <span title={new Date(run.startedAt).toLocaleString()}>{timeAgo(run.startedAt)}</span>
              {onOpenFlow && (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onOpenFlow(run.flowId)}>Open flow →</Button>
              )}
            </div>
            {/* A retry that is scheduled is a CONDITION, not a notification -
                it stays on screen until it resolves (Phase 8B contract). */}
            {run.status === 'waiting_retry' && run.nextRetryAt && (
              <div role="status" className="rounded-lg border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning-fg">
                Attempt {run.attempts ?? 1} failed. The next attempt is scheduled {dueIn(run.nextRetryAt)}
                {run.nextAttempt ? ` (attempt ${run.nextAttempt})` : ''}. Nothing is running in the meantime.
              </div>
            )}
            {run.failure && run.status === 'error' && (
              <div role="alert" className="rounded-lg border border-danger/40 bg-danger-muted px-3 py-2 text-xs text-danger-fg space-y-1">
                <p className="font-medium">{run.failure.message}</p>
                <p className="text-danger-fg">
                  <span className="font-mono">{run.failure.code}</span>
                  {run.failure.nodeId ? ` · node ${run.failure.nodeId}` : ''}
                  {run.failure.attempt ? ` · attempt ${run.failure.attempt}` : ''}
                  {run.failure.retryable === 'retryable' ? ' · retryable' : run.failure.retryable === 'non_retryable' ? ' · will not succeed by repeating' : ' · not classified, so not retried automatically'}
                </p>
              </div>
            )}
            {failed && !run.failure && (
              <p className="text-sm text-danger-fg">Failed at <span className="font-medium">{stepLabel(failed)}</span> - see the step below.</p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
              {run.executionId && <span className="font-mono" title="The identity every attempt of this run shares">{run.executionId}</span>}
              {run.definition && (
                <span className="font-mono" title="The graph this run executed. Later edits to the flow do not change it.">
                  graph {run.definition.checksum}
                </span>
              )}
              {run.attempts != null && <span>{run.attempts} attempt{run.attempts === 1 ? '' : 's'}</span>}
            </div>
            {(onRetry || onCancel) && (
              <div className="flex gap-2">
                {onRetry && run.status === 'error' && (
                  <Button size="sm" variant="secondary" isLoading={busy} onClick={() => onRetry(run)}>
                    Retry from the failed step
                  </Button>
                )}
                {onCancel && (run.status === 'waiting' || run.status === 'waiting_retry' || run.status === 'running') && (
                  <Button size="sm" variant="secondary" isLoading={busy} onClick={() => onCancel(run)}>
                    {run.status === 'running' ? 'Ask this run to stop' : 'Cancel this run'}
                  </Button>
                )}
              </div>
            )}
            <StepLog log={run.log} />
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

/** Runs as a DataList; a row click opens the step-log sheet. */
export function RunsTable({ runs, total, loading, page, onPage, showFlow, onOpenFlow, toolbarLeft, toolbarRight, emptyDescription, onChanged }: {
  runs: RunRow[]
  total: number
  loading: boolean
  page: number
  onPage: (p: number) => void
  showFlow?: boolean
  onOpenFlow?: (flowId: string) => void
  toolbarLeft?: React.ReactNode
  toolbarRight?: React.ReactNode
  emptyDescription: string
  /** Present when the operator actions are available. */
  onChanged?: () => void
}) {
  const [openRun, setOpenRun] = useState<RunRow | null>(null)
  const [busy, setBusy] = useState(false)

  /** The run id is the tail of its store key, which the server derives from
   *  the execution id - the same identity the retry route addresses. */
  const runIdOf = (r: RunRow) => String(r.executionId ?? '').replace(/^exec_/, '')

  async function operate(run: RunRow, op: 'retry' | 'cancel') {
    if (!runIdOf(run)) return
    setBusy(true)
    try {
      const res = await adminFetch<{ data: { effect?: string } }>(
        `/admin/ext/flows/flows/${run.flowId}/runs/${runIdOf(run)}/${op}`, { method: 'POST' },
      )
      if (op === 'retry') toast.success('Retrying from the failed step')
      else if (res?.data?.effect === 'cooperative') toast.success('Cancellation requested', 'This run is executing now; it will stop at its next step.')
      else toast.success('Run cancelled')
      setOpenRun(null)
      onChanged?.()
    } catch (e) {
      toast.error(op === 'retry' ? 'Could not retry this run' : 'Could not cancel this run', (e as Error).message)
    } finally { setBusy(false) }
  }

  const columns: DataListColumn<RunRow>[] = [
    {
      key: 'status', header: 'Status',
      cell: (r) => {
        const meta = STATUS_META[r.status] ?? { icon: 'IconMinus', cls: 'text-fg-subtle', label: r.status }
        return (
          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
            <DynamicIcon name={meta.icon} className={`size-4 shrink-0 ${meta.cls}`} />
            {meta.label}
          </span>
        )
      },
    },
    ...(showFlow ? [{
      key: 'flow', header: 'Flow',
      cell: (r: RunRow) => (
        <span className="font-medium text-fg">
          {r.flowName}
          {r.flowDeleted && <span className="ml-1.5 text-xs font-normal text-fg-subtle">(deleted)</span>}
        </span>
      ),
    } satisfies DataListColumn<RunRow>] : []),
    { key: 'trigger', header: 'Trigger', cell: (r) => <span className="text-xs text-fg-muted">{r.triggerType}</span> },
    { key: 'steps', header: 'Steps', cell: (r) => <span className="text-xs text-fg-muted tabular-nums">{r.log?.length ?? 0}</span> },
    { key: 'ms', header: 'Duration', cell: (r) => <span className="text-xs text-fg-muted tabular-nums">{r.ms}ms</span> },
    {
      key: 'when', header: 'When',
      cell: (r) => <span className="text-xs text-fg-muted" title={new Date(r.startedAt).toLocaleString()}>{timeAgo(r.startedAt)}</span>,
    },
  ]

  return (
    <>
      <DataList<RunRow>
        columns={columns}
        rows={runs}
        rowKey={(r) => `${r.flowId}:${r.startedAt}:${r.ms}`}
        loading={loading}
        onRowClick={(r) => setOpenRun(r)}
        emptyState={{ title: 'No runs', description: emptyDescription }}
        toolbarLeft={toolbarLeft}
        toolbarRight={toolbarRight}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={onPage}
      />
      {openRun && (
        <RunSheet
          run={openRun}
          onClose={() => setOpenRun(null)}
          onOpenFlow={openRun.flowDeleted ? undefined : onOpenFlow}
          busy={busy}
          onRetry={runIdOf(openRun) ? (r) => operate(r, 'retry') : undefined}
          onCancel={runIdOf(openRun) ? (r) => operate(r, 'cancel') : undefined}
        />
      )}
    </>
  )
}

/**
 * Fetch + auto-refresh runs (all, or one flow's) with filters + paging.
 * `initialFilters` seeds filters BEFORE the first request (deep links) - so
 * the first fetch is already filtered and never races a later filtered one.
 */
export function useRuns(flowId?: string, initialFilters?: RunFilters) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [total, setTotal] = useState(0)
  const [retentionDays, setRetentionDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [filters, setFiltersRaw] = useState<RunFilters>(initialFilters ?? EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  // Monotonic request id - a response only lands if it's still the newest
  // (filter changes + the poll can otherwise resolve out of order).
  const seq = useRef(0)

  const reload = useCallback(() => {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    }
    if (flowId) params.flowId = flowId
    if (filters.status) params.status = filters.status
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    const mySeq = ++seq.current
    adminFetch<{ data: RunRow[]; meta?: { total: number; retentionDays?: number } }>('/admin/ext/flows/runs', undefined, params)
      .then((r) => {
        if (mySeq !== seq.current) return   // a newer request superseded this one
        setRuns(r.data)
        setTotal(r.meta?.total ?? r.data.length)
        if (r.meta?.retentionDays) setRetentionDays(r.meta.retentionDays)
      })
      .catch((e) => { if (mySeq === seq.current) toast.error('Could not load runs', (e as Error).message) })
      .finally(() => { if (mySeq === seq.current) setLoading(false) })
  }, [flowId, filters, page])

  useEffect(() => {
    reload()
    const t = setInterval(reload, 15_000)   // pick up fresh + in-progress runs
    return () => clearInterval(t)
  }, [reload])

  const setFilters = useCallback((f: RunFilters) => { setFiltersRaw(f); setPage(1) }, [])
  return { runs, total, loading, reload, filters, setFilters, page, setPage, retentionDays }
}

/** Small retention note rendered under the run tables. */
export function RunsRetentionNote({ days }: { days: number }) {
  return (
    <Text variant="help" className="mt-2">
      Runs are kept for {days} days - older runs (including those of deleted flows) are removed automatically.
    </Text>
  )
}

export function FlowRunsPage() {
  const { workspaceId, flowId } = useParams<{ workspaceId: string; flowId: string }>()
  const navigate = useNavigate()
  const { runs, total, loading, reload, filters, setFilters, page, setPage, retentionDays } = useRuns(flowId!)
  const flowName = runs[0]?.flowName

  usePageHeader({
    title: flowName ? `Runs · ${flowName}` : 'Flow runs',
    description: 'Every execution - completed, skipped (conditions), or failed',
    actions: (
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => navigate(`/${workspaceId}/extensions/flows`)}>← All flows</Button>
        <Button size="sm" onClick={() => navigate(`/${workspaceId}/extensions/flows/${flowId}/canvas`)}>Edit flow</Button>
      </div>
    ),
  }, [workspaceId, flowId, flowName])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-3">
        <RunsTable
          runs={runs} total={total} loading={loading} page={page} onPage={setPage} onChanged={reload}
          toolbarLeft={<RunsToolbar filters={filters} onChange={setFilters} />}
          toolbarRight={(
            <Button size="xs" variant="ghost" onClick={reload} title="Refresh"><DynamicIcon name="IconRefresh" className="size-3.5" /></Button>
          )}
          emptyDescription={filters.status || filters.from || filters.to
            ? 'Nothing matches these filters.'
            : 'Turn the flow on and trigger its event - or use Test run in the editor.'}
        />
        <RunsRetentionNote days={retentionDays} />
      </div>
    </div>
  )
}
