/**
 * File Name: list.tsx
 * Purpose: Flows home - header-bar tabs (like Forms): every automation at
 *          a glance (state, one-click enable/disable, create blank or
 *          from template) and All runs (cross-flow run history with
 *          status/date filters).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, useCan,
  Button, Badge, Card, Text, DataList, useConfirm, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  type DataListColumn,
  FilterDropdown,
} from '@/kit'
import { DynamicIcon } from '@/kit'
import { FLOW_TEMPLATES } from '../templates'
import { originBadge, type FlowOrigin } from '../provenance'
import { RunsTable, RunsToolbar, RunsRetentionNote, useRuns, timeAgo, STATUS_META } from './runs'

interface FlowRow {
  id: string
  version?: number
  name: string
  description?: string
  enabled: boolean
  disabledReason?: string
  trigger: { type: string; typeName?: string }
  steps: Array<{ action: string }>
  updatedAt?: string
  lastRun?: { status: string; startedAt: string } | null
  broken?: string | null
  /** Derived on the server from what this environment currently offers. */
  runnable?: boolean
  issues?: Array<{ code: string; message: string; nodeId?: string; dependency?: string; level: 'error' | 'warning' }>
  /** Derived: a pack's preset built it, or a person drew it, and who changed it last. */
  origin?: FlowOrigin
}

const RECENCY_MS: Record<string, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

const FLOWS_PAGE_SIZE = 10

export function FlowsListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'runs' ? 'runs' : 'flows'
  const { hasCapability, me } = useCan()
  // An extension's id is not its name: the extensions list (which every
  // member may read - the sidebar is built from it) turns `google` into
  // "Google connectors". Falls back to the id, never to nothing.
  const [extensionNames, setExtensionNames] = useState<Record<string, string>>({})
  useEffect(() => {
    adminFetch<{ data: Array<{ id: string; name: string }> }>('/extensions')
      .then((r) => setExtensionNames(Object.fromEntries((r.data ?? []).map((e) => [e.id, e.name]))))
      .catch(() => {})
  }, [])
  const extensionName = useCallback((id: string) => extensionNames[id], [extensionNames])
  const canManage = hasCapability('manage:flows' as never)
  const [rows, setRows] = useState<FlowRow[]>([])
  const [loading, setLoading] = useState(true)
  const [flowsPage, setFlowsPage] = useState(1)
  const [flowSearch, setFlowSearch] = useState('')
  // Deep links preset the flows-tab filters synchronously (?status=on|off|auto,
  // ?recency=24h|7d|30d|never) - state init, so the first render is filtered.
  const [flowStatus, setFlowStatus] = useState(() => {
    const s = searchParams.get('status') ?? ''
    return searchParams.get('tab') !== 'runs' && ['on', 'off', 'auto'].includes(s) ? s : ''
  })
  const [flowRecency, setFlowRecency] = useState(() => {
    const r = searchParams.get('recency') ?? ''
    return searchParams.get('tab') !== 'runs' && ['24h', '7d', '30d', 'never'].includes(r) ? r : ''
  })
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  // Deep links preset the runs-tab filters (?tab=runs&status=error&from=&to=)
  // BEFORE the first request - passed as initial state so the first fetch is
  // already filtered (a post-mount setFilters raced its own unfiltered fetch).
  const [initialRunFilters] = useState(() => {
    if (searchParams.get('tab') !== 'runs') return undefined
    const status = searchParams.get('status') ?? ''
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    return status || from || to ? { status, from, to } : undefined
  })
  const { runs, total, loading: runsLoading, reload: reloadRuns, filters, setFilters, page, setPage, retentionDays } = useRuns(undefined, initialRunFilters)

  const base = `/${workspaceId}/extensions/flows`

  const reload = useCallback(() => {
    adminFetch<{ data: FlowRow[] }>('/admin/ext/flows/flows')
      .then((r) => setRows(r.data))
      .catch((e) => toast.error('Could not load flows', (e as Error).message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(reload, [reload])

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try { await fn(); toast.success(okMsg); reload() }
    catch (e) { toast.error('Failed', (e as Error).message) }
  }

  // Runs currently parked at a Wait - turning off / deleting cancels them,
  // so the confirm must say so.
  const waitingCount = async (flowId: string): Promise<number> => {
    try {
      const r = await adminFetch<{ meta?: { total: number } }>('/admin/ext/flows/runs', undefined, { flowId, status: 'waiting', limit: '1' })
      return r.meta?.total ?? 0
    } catch { return 0 }
  }

  // Create a blank v2 flow (one trigger node) and open it in the canvas builder.
  const createBlank = async () => {
    try {
      const created = await adminFetch<{ data: { id: string } }>('/admin/ext/flows/flows', {
        method: 'POST',
        body: JSON.stringify({
          version: 2, name: 'Untitled flow', enabled: false,
          nodes: [{ id: `trigger_${Math.random().toString(36).slice(2, 8)}`, kind: 'trigger', position: { x: 280, y: 120 }, data: { type: '' } }],
          edges: [],
        }),
      })
      navigate(`${base}/${created.data.id}/canvas`)
    } catch (e) { toast.error('Could not create flow', (e as Error).message) }
  }

  const useTemplate = (t: (typeof FLOW_TEMPLATES)[number]) => act(async () => {
    const created = await adminFetch<{ data: { id: string } }>('/admin/ext/flows/flows', { method: 'POST', body: JSON.stringify(t.flow) })
    setTemplatesOpen(false)
    navigate(`${base}/${created.data.id}/canvas`)
  }, 'Flow created - review, then turn it on')

  // Header chrome: title + tabs live in the secondary bar (same as Forms);
  // the create actions ride along on the Flows tab.
  usePageHeader({
    title: 'Flows',
    icon: <DynamicIcon name="IconGitBranch" className="size-4" />,
    description: 'Automations - when something happens, check conditions, run actions',
    tabs: [{ id: 'flows', label: 'Flows' }, { id: 'runs', label: 'All runs' }],
    activeTab: tab,
    onTabChange: (id) => setSearchParams(id === 'runs' ? { tab: 'runs' } : {}, { replace: true }),
    actions: tab === 'flows' && canManage ? (
      <div className="flex gap-2">
        {/* The secondary action steps aside on a narrow window so the PRIMARY
            one still fits: at 390px both ran past the edge and "New flow" was
            entirely off screen (Phase 9B browser lane). Templates remain
            reachable from the empty state. */}
        <Button size="sm" variant="secondary" className="hidden sm:inline-flex" onClick={() => setTemplatesOpen(true)}>From template</Button>
        <Button size="sm" className="gap-1" onClick={createBlank}><DynamicIcon name="IconPlus" className="size-3.5" /> New flow</Button>
      </div>
    ) : undefined,
  }, [tab, canManage, base])

  const columns: DataListColumn<FlowRow>[] = [
    {
      key: 'name', header: 'Flow',
      cell: (r) => (
        <div>
          <p className="font-medium text-fg">{r.name}</p>
          {r.description && <p className="text-xs text-fg-subtle truncate max-w-[420px]">{r.description}</p>}
        </div>
      ),
    },
    {
      key: 'enabled', header: 'Status',
      // Broken and off are different things, and a flow can be BOTH broken and
      // switched on - the operator's intent survives the breakage (Phase 9B,
      // Unit 21). Showing only one of them would report a broken flow as off.
      cell: (r) => r.broken
        ? (
          <span title={r.broken} className="flex items-center gap-1.5">
            <Badge variant="error">Broken</Badge>
            <span className="text-[11px] text-fg-subtle">{r.enabled ? 'switched on' : 'off'}</span>
          </span>
        )
        : r.enabled
          ? <Badge variant="success">On</Badge>
          : r.disabledReason
            ? <span title={r.disabledReason}><Badge variant="warning">Auto-disabled</Badge></span>
            : <Badge variant="neutral">Off</Badge>,
    },
    {
      // Where it came from, as its own column: a flow a pack's preset built is
      // not the same object as one somebody drew, and an operator deciding
      // whether to edit it needs to see which at a glance.
      key: 'origin', header: 'Origin',
      cell: (r) => {
        if (!r.origin) return <span className="text-xs text-fg-subtle">-</span>
        const badge = originBadge(r.origin, { extensionName, you: me?.memberId })
        return (
          <span className="flex items-center gap-1.5 text-xs text-fg-muted" title={badge.detail}>
            <DynamicIcon name={r.origin.kind === 'preset' ? 'IconPuzzle' : 'IconPencil'} className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="truncate">{badge.label}</span>
            {/* Edited since a preset built it: the fact that says the pack's
                shape can no longer be assumed here. */}
            {badge.edited && <span className="text-[11px] text-fg-subtle">· edited</span>}
          </span>
        )
      },
    },
    {
      key: 'lastRun', header: 'Last run',
      cell: (r) => {
        if (!r.lastRun) return <span className="text-xs text-fg-subtle">Not run recently</span>
        const meta = STATUS_META[r.lastRun.status] ?? { icon: 'IconMinus', cls: 'text-fg-subtle', label: r.lastRun.status }
        return (
          <span className="flex items-center gap-1.5 text-xs text-fg-muted" title={`${meta.label} · ${new Date(r.lastRun.startedAt).toLocaleString()}`}>
            <DynamicIcon name={meta.icon} className={`size-4 shrink-0 ${meta.cls}`} />
            {timeAgo(r.lastRun.startedAt)}
          </span>
        )
      },
    },
    {
      key: 'ops', header: '',
      cell: (r) => (
        <div className="flex gap-1.5 justify-end">
          {canManage && (
            <Button size="xs" variant="secondary" className="gap-1"
              title={r.enabled ? 'Turn off' : 'Turn on'}
              onClick={async (e) => {
                e.stopPropagation()
                if (r.enabled) {
                  const waiting = await waitingCount(r.id)
                  if (waiting > 0 && !(await confirm({
                    title: `Turn off "${r.name}"?`,
                    description: `${waiting} run${waiting === 1 ? ' is' : 's are'} waiting on a delay - turning off cancels ${waiting === 1 ? 'it' : 'them'}.`,
                    variant: 'destructive',
                  }))) return
                }
                act(
                  () => adminFetch(`/admin/ext/flows/flows/${r.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !r.enabled }) }),
                  r.enabled ? 'Flow turned off' : 'Flow turned on',
                )
              }}>
              <DynamicIcon name={r.enabled ? 'IconPlayerPause' : 'IconPlayerPlay'} className="size-3.5" />
              {r.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          )}
          <Button size="xs" variant="secondary" className="gap-1" title="Run history"
            onClick={(e) => { e.stopPropagation(); navigate(`${base}/${r.id}/runs`) }}>
            <DynamicIcon name="IconHistory" className="size-3.5" />
            View runs
          </Button>
          {canManage && (
            <Button size="xs" variant="secondary" className="px-1.5 text-danger-fg hover:bg-danger-muted" title="Delete flow"
              aria-label={`Delete ${r.name}`}
              onClick={async (e) => {
                e.stopPropagation()
                const waiting = await waitingCount(r.id)
                const description = waiting > 0
                  ? `${waiting} run${waiting === 1 ? ' is' : 's are'} still waiting on a delay - deleting cancels ${waiting === 1 ? 'it' : 'them'}. Run history stays under All runs for audit.`
                  : 'Run history stays under All runs for audit.'
                if (await confirm({ title: `Delete "${r.name}"?`, description, variant: 'destructive' })) {
                  act(() => adminFetch(`/admin/ext/flows/flows/${r.id}`, { method: 'DELETE' }), 'Deleted')
                }
              }}>
              <DynamicIcon name="IconTrash" className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  // Search + status + last-run recency, applied before paging.
  const filteredRows = rows.filter((r) => {
    if (flowSearch) {
      const q = flowSearch.toLowerCase()
      if (!r.name.toLowerCase().includes(q) && !(r.description ?? '').toLowerCase().includes(q)) return false
    }
    if (flowStatus === 'on' && !r.enabled) return false
    if (flowStatus === 'off' && (r.enabled || r.disabledReason)) return false
    if (flowStatus === 'auto' && !(!r.enabled && r.disabledReason)) return false
    if (flowRecency === 'never') return !r.lastRun
    if (flowRecency && RECENCY_MS[flowRecency]) {
      const t = r.lastRun ? Date.parse(r.lastRun.startedAt) || 0 : 0
      if (Date.now() - t > RECENCY_MS[flowRecency]) return false
    }
    return true
  })
  const safePage = Math.min(flowsPage, Math.max(1, Math.ceil(filteredRows.length / FLOWS_PAGE_SIZE)))
  const pagedRows = filteredRows.slice((safePage - 1) * FLOWS_PAGE_SIZE, safePage * FLOWS_PAGE_SIZE)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-3">
        {tab === 'runs' ? (
          <>
            <RunsTable
              runs={runs} total={total} loading={runsLoading} page={page} onPage={setPage}
              showFlow onOpenFlow={(flowId) => navigate(`${base}/${flowId}/canvas`)}
              toolbarLeft={<RunsToolbar filters={filters} onChange={setFilters} />}
              toolbarRight={(
                <Button size="xs" variant="ghost" onClick={reloadRuns} title="Refresh"><DynamicIcon name="IconRefresh" className="size-3.5" /></Button>
              )}
              emptyDescription={filters.status || filters.from || filters.to
                ? 'Nothing matches these filters.'
                : 'Runs from every flow show up here - completed, skipped, or failed.'}
            />
            <RunsRetentionNote days={retentionDays} />
          </>
        ) : !loading && rows.length === 0 && canManage ? (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-lg font-semibold text-fg">Automate something</p>
              <p className="text-sm text-fg-subtle mt-1">Pick a template to start from - or build from scratch.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {FLOW_TEMPLATES.map((t) => (
                <Card key={t.id} title={t.title}>
                  <Text variant="help">{t.summary}</Text>
                  <div className="mt-2 flex justify-end">
                    <Button size="xs" variant="secondary" onClick={() => useTemplate(t)}>Use template</Button>
                  </div>
                </Card>
              ))}
            </div>
            <div className="text-center pt-1">
              <Button size="sm" variant="ghost" onClick={createBlank}>Or start from a blank canvas →</Button>
            </div>
          </div>
        ) : (
          <DataList<FlowRow>
            columns={columns}
            rows={pagedRows}
            rowKey={(r) => r.id}
            loading={loading}
            onRowClick={(r) => navigate(`${base}/${r.id}/canvas`)}
            emptyState={flowSearch || flowStatus || flowRecency
              ? { title: 'No matching flows', description: 'Try clearing the search or filters.' }
              : { title: 'No flows yet', description: 'Start from a template - most automations are one trigger and one action.' }}
            searchPlaceholder="Search flows…"
            onSearchChange={(v) => { setFlowSearch(v); setFlowsPage(1) }}
            toolbarLeft={(
              <div className="flex items-center gap-2 flex-wrap">
                <FilterDropdown
                  label="Status"
                  value={flowStatus}
                  onChange={(v) => { setFlowStatus(v); setFlowsPage(1) }}
                  options={[
                    { value: '', label: 'All statuses' },
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                    { value: 'auto', label: 'Auto-disabled' },
                  ]}
                />
                <FilterDropdown
                  label="Last run"
                  value={flowRecency}
                  onChange={(v) => { setFlowRecency(v); setFlowsPage(1) }}
                  options={[
                    { value: '', label: 'Ran any time' },
                    { value: '24h', label: 'Ran in last 24 hours' },
                    { value: '7d', label: 'Ran in last 7 days' },
                    { value: '30d', label: 'Ran in last 30 days' },
                    { value: 'never', label: 'Never ran' },
                  ]}
                />
              </div>
            )}
            page={safePage}
            pageSize={FLOWS_PAGE_SIZE}
            total={filteredRows.length}
            onPageChange={setFlowsPage}
          />
        )}
        {templatesOpen && (
          <Dialog open onOpenChange={(o) => { if (!o) setTemplatesOpen(false) }}>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Start from a template</DialogTitle></DialogHeader>
              <div className="px-6 py-4 max-h-[65vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  {FLOW_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => useTemplate(t)}
                      className="text-left border border-border rounded-lg p-3.5 bg-surface hover:border-accent/50 hover:shadow-sm transition-all group"
                    >
                      <p className="text-sm font-medium text-fg group-hover:text-accent-fg transition-colors">{t.title}</p>
                      <p className="text-xs text-fg-subtle mt-1 leading-relaxed">{t.summary}</p>
                    </button>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => { setTemplatesOpen(false); void createBlank() }}>Start from a blank canvas →</Button>
                <Button variant="secondary" onClick={() => setTemplatesOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {confirmDialog}
      </div>
    </div>
  )
}
