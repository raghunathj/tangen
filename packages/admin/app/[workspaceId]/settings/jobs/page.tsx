/**
 * File Name: page.tsx
 * Purpose: Settings → Jobs & Cron — the Cron Manager (admin-created
 *          schedule entries incl. URL triggers), the read-only code-defined
 *          jobs, and the unified run history. Built on @/kit.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Writes gated by manage:cron (route-enforced too).
 *          Code jobs are code-owned — this page never edits them.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, useCan, useSettingsWidth,
  Button, Badge, Input, Select, SelectItem, Card, Text, Label, InlineCode,
  DataList, ListChip, ListFilter, ListFilterChips, activeFilters, clearedFilters,
  useKitQuery, fromAdminRoute, useConfirm, toast,
  Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetFooter,
  type DataListColumn, type ListFilterFacet, type ListFilterValue,
  useRealtime, useRealtimeStatus,
} from '@/kit'
import { DynamicIcon } from '@/components/dynamic-icon'
import { runDetail } from '@/lib/run-detail'
import { IconRefresh, IconClock, IconTable, IconListChecks, IconStack, IconCalendar } from '@tangen/icons'

interface CronRow {
  id: string
  name: string
  schedule: string
  timezone?: string | null
  action: { type: 'url'; url?: string; method?: string; headers?: Record<string, string>; body?: string; secret?: string } | { type: 'task'; taskId?: string }
  enabled: boolean
}

interface RunRow {
  id: number
  kind: string
  name: string
  status: string
  startedAt: string
  durationMs: number | null
  error: string | null
  /** Which go this was, for a task the queue retried. */
  attempt: number | null
  meta: Record<string, unknown> | null
}

function RetryButton({ run}: { run: RunRow; }) {
  const [busy, setBusy] = useState(false)
  if (run.kind !== 'task' || run.status !== 'error') return null
  return (
    <Button size="xs" variant="ghost" disabled={busy} title="Re-enqueue this task with the same payload"
      onClick={async () => {
        setBusy(true)
        try {
          await adminFetch(`/admin/jobs/runs/${run.id}/retry`, { method: 'POST' })
          toast.success('Task re-enqueued')
        } catch (e) {
          toast.error('Retry failed', (e as Error).message)
        } finally { setBusy(false) }
      }}>Retry</Button>
  )
}

type HeaderRow = { name: string; value: string }

const emptyDraft = {
  name: '', schedule: 'every 30m', timezone: '', type: 'url' as 'url' | 'task',
  url: '', method: 'POST', headers: [] as HeaderRow[], body: '', taskId: '', secret: '',
}

/** Two pages with their own URLs (settings/jobs, settings/jobs/runs), listed
 *  as a tree under Jobs & Cron in the settings sidebar. */
export default function JobsSettingsPage({ view = 'schedules' }: { view?: 'schedules' | 'runs' }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { hasCapability } = useCan()
  const canManage = hasCapability('manage:cron' as never)
  const tab = view
  // Bumped by the header's "New schedule" action - Schedules opens its editor.
  const [newTick, setNewTick] = useState(0)

  // Header chrome: title + tabs in the secondary bar, create action on the
  // Schedules tab - same pattern as Forms and Flows.
  usePageHeader({
    breadcrumbs: [
      { label: 'Settings', href: `/${workspaceId}/settings` },
      { label: 'Jobs & Cron', href: `/${workspaceId}/settings/jobs` },
      { label: view === 'runs' ? 'Runs' : 'Schedules' },
    ],
    icon: <DynamicIcon name="IconClock" className="size-4" />,
    description: view === 'runs' ? 'Task, scheduled-job and cron executions, kept for 30 days' : 'Every schedule in one place - cron entries and code-defined jobs',
    actions: tab === 'schedules' && canManage ? (
      <Button size="xs" className="gap-1" onClick={() => setNewTick((t) => t + 1)}>
        <DynamicIcon name="IconPlus" className="size-3.5" /> New schedule
      </Button>
    ) : undefined,
  }, [view, canManage, workspaceId])

  // Both views are TABLES - six columns of ids, dates and statuses - so they
  // get the wide settings column rather than the 900px one meant for cards
  // (the user, 2026-09-20).
  useSettingsWidth('wide')

  return (
    <div className="space-y-6">
      {tab === 'schedules' && <Schedules canManage={canManage} newTick={newTick} />}
      {tab === 'runs' && <RunsList />}
    </div>
  )
}

// ── Schedules: admin cron entries + code-defined jobs, one list ───────────────

interface CodeScheduled { id: string; schedule: string; timezone?: string | null; paused?: boolean; pausedReason?: string | null; failStreak?: number }

/**
 * What the PLATFORM runs for itself, on its own timers: retention, the
 * AI-image reaper and the hourly connection health sweep. Read-only: there is
 * no queue, no retry and no pause, because a platform that stops checking its
 * own connections when somebody clicks pause is worse than one that cannot be
 * paused (the user, 2026-09-20: "auto check every 1 hour is happening right??
 * if yes why is it no present in jobs & crons?").
 */
interface HousekeepingRow {
  task: string
  label: string
  everyMs: number
  lastRun: { status: string; startedAt: string; finishedAt: string | null; durationMs: number | null; error: string | null; meta: unknown } | null
}

/** One row per schedule regardless of origin - `source` decides editability. */
interface ScheduleRow {
  id: string
  source: 'admin' | 'code'
  name: string
  schedule: string
  timezone?: string | null
  detail: string
  active: boolean
  pausedReason?: string | null
  failStreak?: number
  raw?: CronRow
}

/** Multi-select, because "everything that is not running" is two statuses. */
const SCHEDULE_FACETS: ListFilterFacet[] = [
  {
    id: 'status', label: 'Status', multiple: true, icon: <IconListChecks />,
    options: [
      { value: 'enabled', label: 'Enabled' },
      { value: 'failing', label: 'Failing' },
      { value: 'paused', label: 'Paused' },
      { value: 'auto-paused', label: 'Auto-paused' },
    ],
  },
]

function Schedules({ canManage, newTick }: { canManage: boolean; newTick: number }) {
  const [cronRows, setCronRows] = useState<CronRow[]>([])
  const [defs, setDefs] = useState<{ scheduled: CodeScheduled[]; tasks: Array<{ id: string }>; housekeeping?: HousekeepingRow[] }>({ scheduled: [], tasks: [] })
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CronRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<ListFilterValue>({})
  const [page, setPage] = useState(1)
  const { confirm, confirmDialog } = useConfirm()

  // Header "New schedule" action bumps newTick - open a blank editor.
  useEffect(() => {
    if (newTick > 0) { setEditing(null); setEditorOpen(true) }
  }, [newTick])

  const reload = useCallback(() => {
    Promise.all([
      adminFetch<{ data: CronRow[] }>('/admin/cron').then((r) => r.data).catch(() => [] as CronRow[]),
      adminFetch<{ data: { scheduled: CodeScheduled[]; tasks: Array<{ id: string }>; housekeeping?: HousekeepingRow[] } }>('/admin/jobs/definitions')
        .then((r) => r.data).catch(() => ({ scheduled: [], tasks: [] })),
    ])
      .then(([cron, d]) => { setCronRows(cron); setDefs(d) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(reload, [reload])

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn()
      toast.success(okMsg)
      reload()
    } catch (e) {
      toast.error('Failed', (e as Error).message)
    }
  }

  async function toggleCodeJob(id: string, paused: boolean) {
    setBusy(id)
    try {
      await adminFetch(`/admin/jobs/${id}/${paused ? 'resume' : 'pause'}`, { method: 'POST' })
      setDefs((d) => ({ ...d, scheduled: d.scheduled.map((j) => (j.id === id ? { ...j, paused: !paused } : j)) }))
      toast.success(paused ? 'Job resumed' : 'Job paused')
    } catch (e: any) {
      toast.error('Could not update job', e?.message)
    } finally { setBusy(null) }
  }

  const rows: ScheduleRow[] = [
    ...cronRows.map((r): ScheduleRow => ({
      id: `admin:${r.id}`, source: 'admin', name: r.name, schedule: r.schedule, timezone: r.timezone,
      detail: r.action.type === 'url'
        ? `${(r.action.method ?? 'POST')} ${(r.action as { url?: string }).url ?? ''}`
        : `task: ${(r.action as { taskId?: string }).taskId ?? ''}`,
      active: r.enabled, raw: r,
    })),
    ...defs.scheduled.map((j): ScheduleRow => ({
      id: `code:${j.id}`, source: 'code', name: j.id, schedule: j.schedule, timezone: j.timezone,
      detail: 'app/jobs/',
      active: j.paused !== true, pausedReason: j.pausedReason, failStreak: j.failStreak,
    })),
  ]

  // enabled | paused | auto-paused | failing - drives the filter + badge
  const statusOf = (r: ScheduleRow): string => {
    if (!r.active && r.pausedReason) return 'auto-paused'
    if (!r.active) return 'paused'
    if ((r.failStreak ?? 0) >= 2) return 'failing'
    return 'enabled'
  }

  // Several statuses at once, kept or dropped: "everything that is not
  // running" reads either way round.
  const statusPick = activeFilters(SCHEDULE_FACETS, filters).find((a) => a.facet.id === 'status')
  const picked = statusPick ? (statusPick.value as string[]) : []
  const filtered = rows.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    if (picked.length > 0 && picked.includes(statusOf(r)) === (statusPick!.op === 'not-in')) return false
    return true
  })
  const PAGE = 10
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE)))
  const paged = filtered.slice((safePage - 1) * PAGE, safePage * PAGE)

  const columns: DataListColumn<ScheduleRow>[] = [
    {
      key: 'name', header: 'Name',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-fg">{r.name}</span>
          {r.source === 'code' && <span title="Defined in app/jobs/ - edit in code"><Badge variant="neutral">Code</Badge></span>}
        </span>
      ),
    },
    {
      key: 'schedule', header: 'Schedule',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <InlineCode>{r.schedule}</InlineCode>
          {r.timezone && <span className="text-xs text-fg-subtle" title="Cron fields evaluate in this timezone">{r.timezone}</span>}
        </span>
      ),
    },
    { key: 'detail', header: 'Action', cell: (r) => <span className="text-xs text-fg-muted truncate max-w-[220px] inline-block">{r.detail}</span> },
    {
      key: 'active', header: 'Status',
      cell: (r) => {
        switch (statusOf(r)) {
          case 'auto-paused': return <span title={r.pausedReason ?? undefined}><Badge variant="error">Auto-paused</Badge></span>
          case 'paused': return <Badge variant="warning">Paused</Badge>
          case 'failing': return <span title={`${r.failStreak} consecutive failures in this environment - auto-pauses at 5`}><Badge variant="error">Failing ×{r.failStreak}</Badge></span>
          default: return <Badge variant="success">Enabled</Badge>
        }
      },
    },
    {
      key: 'ops', header: '',
      cell: (r) => {
        if (!canManage) return null
        if (r.source === 'code') {
          // Code-owned: logic is not editable here - pause/resume only
          return (
            <div className="flex gap-1.5 justify-end">
              <Button size="xs" variant="secondary" className="gap-1" disabled={busy === r.name}
                title={r.active ? 'Pause in THIS environment only' : 'Resume in this environment'}
                onClick={() => toggleCodeJob(r.name, !r.active)}>
                <DynamicIcon name={r.active ? 'IconPlayerPause' : 'IconPlayerPlay'} className="size-3.5" />
                {r.active ? 'Pause' : 'Resume'}
              </Button>
            </div>
          )
        }
        const c = r.raw!
        return (
          <div className="flex gap-1.5 justify-end">
            <Button size="xs" variant="secondary" onClick={() => act(
              () => adminFetch(`/admin/cron/${c.id}/run`, { method: 'POST' }), `"${c.name}" triggered`,
            )}>Run now</Button>
            <Button size="xs" variant="secondary" className="gap-1" onClick={() => act(
              () => adminFetch(`/admin/cron/${c.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !c.enabled }) }),
              c.enabled ? 'Paused' : 'Enabled',
            )}>
              <DynamicIcon name={c.enabled ? 'IconPlayerPause' : 'IconPlayerPlay'} className="size-3.5" />
              {c.enabled ? 'Pause' : 'Enable'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => { setEditing(c); setEditorOpen(true) }}>Edit</Button>
            <Button size="xs" variant="ghost" onClick={async () => {
              if (await confirm({ title: `Delete "${c.name}"?`, variant: 'destructive' })) {
                await act(() => adminFetch(`/admin/cron/${c.id}`, { method: 'DELETE' }), 'Deleted')
              }
            }}>Delete</Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <DataList
          chrome="framed"
          columns={columns}
          rows={paged}
          rowKey={(r) => r.id}
          loading={loading}
          search={search}
          searchPlaceholder="Search by name…"
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          toolbarLeft={(
            <>
              <ListChip icon={<IconClock />} label="Schedules" count={filtered.length} />
              <Button size="sm" variant="ghost" icon={<IconRefresh />} aria-label="Refresh schedules" title="Refresh" onClick={() => reload()} />
            </>
          )}
          toolbarRight={<ListFilter facets={SCHEDULE_FACETS} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} />}
          filterRow={activeFilters(SCHEDULE_FACETS, filters).length
            ? <ListFilterChips facets={SCHEDULE_FACETS} value={filters} onChange={(next) => { setFilters(next); setPage(1) }} />
            : undefined}
          filtered={search.trim() !== '' || activeFilters(SCHEDULE_FACETS, filters).length > 0}
          page={safePage}
          pageSize={PAGE}
          total={filtered.length}
          onPageChange={setPage}
          emptyState={{ title: 'No schedules yet', description: 'Create one to trigger a URL or enqueue a task on a schedule - code-defined jobs from app/jobs/ appear here too.' }}
          filteredEmptyState={{
            title: 'No schedule matches these filters',
            description: 'Clear the filters, or search for another name.',
            action: <Button size="sm" variant="secondary" onClick={() => { setFilters(clearedFilters(SCHEDULE_FACETS)); setSearch(''); setPage(1) }}>Clear filters</Button>,
          }}
      />
      {(defs.housekeeping?.length ?? 0) > 0 && (
        <Card title="Platform housekeeping">
          <Text variant="help" className="mb-2">
            What Tangen runs for itself, on its own timers. Read-only: there is no queue, no retry and no pause,
            because a platform that stops checking its own connections when someone pauses a job is worse than one that cannot be paused.
          </Text>
          <ul className="divide-y divide-border-subtle">
            {defs.housekeeping!.map((h) => {
              const every = h.everyMs >= 86_400_000 ? `every ${Math.round(h.everyMs / 86_400_000)}d` : `every ${Math.round(h.everyMs / 3_600_000)}h`
              const run = h.lastRun
              // "checked: 3 · ok: 2 · failed: 1" - whatever counts the pass kept.
              const numbers = run?.meta && typeof run.meta === 'object'
                ? Object.entries(run.meta as Record<string, unknown>)
                    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')
                : ''
              return (
                <li key={h.task} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-fg">{h.label}</span>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {every}
                      {run
                        ? ` · last ran ${new Date(run.startedAt).toLocaleString()}${run.durationMs !== null ? ` in ${run.durationMs}ms` : ''}`
                        : ' · no run recorded yet in this workspace'}
                      {run?.error ? ` · ${run.error}` : ''}
                    </p>
                    {/* The pass's own numbers, where it keeps any. */}
                    {numbers !== '' && <p className="mt-0.5 text-xs text-fg-muted">{numbers}</p>}
                  </div>
                  {run
                    ? <Badge variant={run.status === 'ok' ? 'success' : 'error'}>{run.status === 'ok' ? 'Ran' : 'Failed'}</Badge>
                    : <Badge variant="neutral">Not seen yet</Badge>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      {defs.tasks.length > 0 && (
        <Card title={`Available tasks (${defs.tasks.length})`}>
          <Text variant="help" className="mb-2">defineTask ids you can run on a schedule via "Enqueue a task".</Text>
          <div className="flex flex-wrap gap-2">
            {defs.tasks.map((t) => <Badge key={t.id} variant="neutral">{t.id}</Badge>)}
          </div>
        </Card>
      )}
      {editorOpen && (
        <CronEditor
          existing={editing}
          onClose={(saved) => { setEditorOpen(false); if (saved) reload() }}
        />
      )}
      {confirmDialog}
    </div>
  )
}

function CronEditor({ existing, onClose }: { existing: CronRow | null; onClose: (saved: boolean) => void }) {
  const [draft, setDraft] = useState(() => existing ? {
    name: existing.name,
    schedule: existing.schedule,
    timezone: existing.timezone ?? '',
    type: existing.action.type,
    url: (existing.action as { url?: string }).url ?? '',
    method: (existing.action as { method?: string }).method ?? 'POST',
    headers: Object.entries((existing.action as { headers?: Record<string, string> }).headers ?? {})
      .map(([name, value]): HeaderRow => ({ name, value })),
    body: (existing.action as { body?: string }).body ?? '',
    taskId: (existing.action as { taskId?: string }).taskId ?? '',
    secret: '',
  } : { ...emptyDraft })
  const [saving, setSaving] = useState(false)
  const patch = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }))

  const save = async () => {
    setSaving(true)
    try {
      const headerMap = Object.fromEntries(
        draft.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value]),
      )
      const sendsBody = draft.method !== 'GET' && draft.body.trim() !== ''
      const action = draft.type === 'url'
        ? {
            type: 'url', url: draft.url, method: draft.method,
            ...(Object.keys(headerMap).length ? { headers: headerMap } : {}),
            ...(sendsBody ? { body: draft.body } : {}),
            ...(draft.secret ? { secret: draft.secret } : {}),
          }
        : { type: 'task', taskId: draft.taskId }
      const body = JSON.stringify({ name: draft.name, schedule: draft.schedule, timezone: draft.timezone.trim() || null, action })
      if (existing) await adminFetch(`/admin/cron/${existing.id}`, { method: 'PATCH', body })
      else await adminFetch('/admin/cron', { method: 'POST', body })
      toast.success(existing ? 'Cron entry updated' : 'Cron entry created')
      onClose(true)
    } catch (e) {
      toast.error('Save failed', (e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(false) }}>
      <SheetContent>
        <SheetHeader><SheetTitle>{existing ? 'Edit cron entry' : 'New cron entry'}</SheetTitle></SheetHeader>
        <SheetBody>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="cron-name" required>Name</Label>
            <Input id="cron-name" value={draft.name} onChange={(e) => patch({ name: e.currentTarget.value })} placeholder="Nightly report ping" />
          </div>
          <div>
            <Label htmlFor="cron-schedule" required>Schedule</Label>
            <Input id="cron-schedule" value={draft.schedule} onChange={(e) => patch({ schedule: e.currentTarget.value })} placeholder="every 30m or 0 6 * * *" />
            <Text variant="help" className="mt-1">"every Nm/Nh" or 5-field cron, evaluated in the timezone below.</Text>
          </div>
          <div>
            <Label htmlFor="cron-timezone">Timezone (optional)</Label>
            <Input id="cron-timezone" value={draft.timezone} onChange={(e) => patch({ timezone: e.currentTarget.value })} placeholder="Asia/Kolkata" />
            <Text variant="help" className="mt-1">IANA name - leave blank for the API server's local time. Intervals ("every Nm") ignore this.</Text>
          </div>
          <div>
            <Label>Action</Label>
            <Select value={draft.type} onValueChange={(v: string) => patch({ type: v as 'url' | 'task' })}>
              <SelectItem value="url">Trigger a URL</SelectItem>
              <SelectItem value="task">Enqueue a task</SelectItem>
            </Select>
          </div>
          {draft.type === 'url' ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Select value={draft.method} onValueChange={(v: string) => patch({ method: v })}>
                  {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </Select>
                <div className="col-span-3">
                  <Input value={draft.url} onChange={(e) => patch({ url: e.currentTarget.value })} placeholder="https://example.com/api/rebuild" />
                </div>
              </div>
              <div>
                <Label>Custom headers (optional)</Label>
                <Text variant="help" className="mb-2">Sent with every trigger - e.g. an Authorization bearer token. The X-Tangen-Signature header is reserved for the signing secret.</Text>
                <div className="space-y-2">
                  {draft.headers.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <Input className="w-2/5" value={h.name} placeholder="Header name"
                        onChange={(e) => patch({ headers: draft.headers.map((row, j) => (j === i ? { ...row, name: e.currentTarget.value } : row)) })} />
                      <Input className="flex-1" value={h.value} placeholder="Value"
                        onChange={(e) => patch({ headers: draft.headers.map((row, j) => (j === i ? { ...row, value: e.currentTarget.value } : row)) })} />
                      <Button size="sm" variant="ghost" title="Remove header"
                        onClick={() => patch({ headers: draft.headers.filter((_, j) => j !== i) })}>
                        <DynamicIcon name="IconX" className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button size="xs" variant="secondary" className="gap-1"
                    onClick={() => patch({ headers: [...draft.headers, { name: '', value: '' }] })}>
                    <DynamicIcon name="IconPlus" className="size-3" /> Add header
                  </Button>
                </div>
              </div>
              {draft.method !== 'GET' && (
                <div>
                  <Label htmlFor="cron-body">JSON body (optional)</Label>
                  <textarea
                    id="cron-body"
                    rows={4}
                    value={draft.body}
                    onChange={(e) => patch({ body: e.currentTarget.value })}
                    placeholder={'{"run": true}'}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm text-fg font-mono focus:outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 resize-none"
                  />
                  <Text variant="help" className="mt-1">Must be valid JSON. Leave blank to send an empty body.</Text>
                </div>
              )}
              <div>
                <Label htmlFor="cron-secret">Signing secret {existing ? '(leave blank to keep current)' : '(optional)'}</Label>
                <div className="flex gap-2">
                  <Input id="cron-secret" value={draft.secret} onChange={(e) => patch({ secret: e.currentTarget.value })} placeholder="Lets the receiver verify requests are from you" />
                  <Button size="sm" variant="secondary" onClick={async () => {
                    const r = await adminFetch<{ data: { secret: string } }>('/admin/cron/secret', { method: 'POST' })
                    patch({ secret: r.data.secret })
                  }}>Generate</Button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="cron-task" required>Task id</Label>
              <Input id="cron-task" value={draft.taskId} onChange={(e) => patch({ taskId: e.currentTarget.value })} placeholder="reindex-content (from app/jobs/tasks)" />
            </div>
          )}
        </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={save} isLoading={saving} loadingText="Saving…">Save entry</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ── Runs ──────────────────────────────────────────────────────────────────────

/**
 * Runs are kept for 30 days, so a window covers the whole history an operator
 * can ask about - and a window inside the Filter menu is the same control as
 * every other facet, where two date fields in the bar were not.
 */
const STARTED_WINDOW: Record<string, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
}

const RUN_FACETS: ListFilterFacet[] = [
  {
    id: 'status', label: 'Status', multiple: true, icon: <IconListChecks />,
    options: [{ value: 'ok', label: 'Succeeded' }, { value: 'error', label: 'Failed' }],
  },
  {
    id: 'kind', label: 'Kind', multiple: true, icon: <IconStack />,
    options: [
      { value: 'task', label: 'Tasks' },
      { value: 'scheduled', label: 'Scheduled jobs' },
      { value: 'cron', label: 'Cron' },
      { value: 'housekeeping', label: 'Platform housekeeping' },
    ],
  },
  {
    id: 'started', label: 'Started', icon: <IconCalendar />,
    options: [
      { value: 'any', label: 'Any time' },
      { value: '1h', label: 'The last hour' },
      { value: '24h', label: 'The last 24 hours' },
      { value: '7d', label: 'The last 7 days' },
      { value: '30d', label: 'The last 30 days' },
    ],
  },
]

function RunsList() {
  const [filters, setFilters] = useState<ListFilterValue>({})
  const active = activeFilters(RUN_FACETS, filters)
  const source = fromAdminRoute<RunRow>('/admin/jobs/runs')
  // One place turns the facets into the route's query: kind and status take a
  // comma-separated list, and the window becomes a `from` instant.
  const queryFilters = useMemo(() => {
    const out: Record<string, string> = {}
    for (const { facet, value, op } of activeFilters(RUN_FACETS, filters)) {
      if (facet.id === 'started') {
        const ms = STARTED_WINDOW[String(value)]
        if (ms) out.from = new Date(Date.now() - ms).toISOString()
        continue
      }
      out[facet.id] = Array.isArray(value) ? value.join(',') : value
      // "Is none of" - the route reads the operator beside the values.
      if (op === 'not-in') out[`${facet.id}Op`] = 'not-in'
    }
    return out
  }, [filters])
  const q = useKitQuery((query) => source({ ...query, filters: queryFilters }), { initialPageSize: 25 })

  useEffect(() => { q.setFilters(queryFilters) }, [queryFilters])

  // Realtime R2: every job.run.* on the `jobs` topic refetches the list, so a
  // run that just finished appears without the manual refresh (which stays).
  useRealtime('jobs', () => { q.refetch() }, { onResync: () => q.refetch() })
  const realtimeStatus = useRealtimeStatus()
  const live = realtimeStatus === 'open'

  const columns: DataListColumn<RunRow>[] = [
    { key: 'kind', header: 'Kind', cell: (r) => <Badge variant="neutral">{r.kind}</Badge> },
    { key: 'name', header: 'Name', cell: (r) => <span className="font-medium text-fg">{r.name}</span> },
    {
      key: 'status', header: 'Status',
      cell: (r) => <Badge variant={r.status === 'ok' ? 'success' : 'error'}>{r.status}</Badge>,
    },
    { key: 'startedAt', header: 'Started', cell: (r) => <span className="text-xs text-fg-muted tabular-nums">{new Date(r.startedAt).toLocaleString()}</span> },
    { key: 'durationMs', header: 'Duration', cell: (r) => <span className="text-xs text-fg-muted tabular-nums">{r.durationMs != null ? `${r.durationMs} ms` : '-'}</span> },
    {
      key: 'error', header: 'Result',
      cell: (r) => {
        const d = runDetail(r)
        if (!d) return null
        return (
          <span
            className={`inline-block max-w-[240px] truncate text-xs ${d.failed ? 'text-danger' : 'text-fg-subtle'}`}
            title={d.text}
          >
            {d.text}
          </span>
        )
      },
    },
    { key: 'retry', header: '', cell: (r) => <RetryButton run={r} /> },
  ]

  return (
    <div className="space-y-3">
      <DataList
          chrome="framed"
          columns={columns}
          rows={q.rows}
          rowKey={(r) => String(r.id)}
          loading={q.loading}
          page={q.query.page}
          pageSize={q.query.pageSize}
          total={q.total}
          onPageChange={q.setPage}
          search={q.query.search ?? ''}
          searchPlaceholder="Search by name…"
          onSearchChange={(v) => q.setSearch(v)}
          toolbarLeft={(
            <>
              <ListChip icon={<IconTable />} label="Runs" count={q.total} />
              <Button size="sm" variant="ghost" icon={<IconRefresh />} aria-label="Refresh runs" title="Refresh" onClick={() => q.refetch()} />
              {/* Whether a finished run appears by itself, next to the button
                  that fetches it by hand. */}
              <span className="flex items-center gap-1 text-[11px] text-fg-subtle" title={live ? 'Runs appear as they finish' : `Realtime ${realtimeStatus}: refresh to see new runs`}>
                <span className={live ? 'inline-block h-1.5 w-1.5 rounded-full bg-success' : 'inline-block h-1.5 w-1.5 rounded-full bg-fg-faint'} aria-hidden="true" />
                {live ? 'Live' : 'Not live'}
              </span>
            </>
          )}
          toolbarRight={<ListFilter facets={RUN_FACETS} value={filters} onChange={setFilters} />}
          filterRow={active.length
            ? <ListFilterChips facets={RUN_FACETS} value={filters} onChange={setFilters} />
            : undefined}
          filtered={active.length > 0}
          emptyState={{ title: 'No runs', description: 'Task, scheduled-job, and cron executions land here.' }}
          filteredEmptyState={{
            title: 'No run matches these filters',
            description: 'Clear the filters, or search for another name.',
            action: <Button size="sm" variant="secondary" onClick={() => setFilters(clearedFilters(RUN_FACETS))}>Clear filters</Button>,
          }}
      />
      <Text variant="help">Runs are kept for 30 days - older runs are removed automatically.</Text>
    </div>
  )
}
