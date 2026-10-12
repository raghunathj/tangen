/**
 * File Name: experiments.tsx
 * Purpose: The Experiments admin page - two tabs: A/B experiments (list,
 *          start, stop) and timed takeovers (list, schedule, cancel), both
 *          backed by the extension's member admin routes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Built on @/kit only. Object ids are entered directly
 *          (copy them from the editor's Variants panel). No em dashes in
 *          UI copy.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  usePageHeader, adminFetch, useCan,
  Button, Badge, Text, DataList, Input, Label, useConfirm, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  type DataListColumn,
} from '@/kit'
import { DynamicIcon } from '@/kit'

interface ExperimentRow {
  experimentId: string
  typeName: string
  baseObjectId: string
  variantObjectId: string
  split: number
  status: 'running' | 'stopped'
  startedAt: string
  stoppedAt?: string
}

interface TakeoverRow {
  takeoverId: string
  typeName: string
  objectId: string
  variantObjectId: string
  startAt: string
  endAt: string
  status: 'scheduled' | 'active' | 'done' | 'cancelled' | 'blocked'
  reason?: string
  createdAt: string
}

const TAKEOVER_BADGE: Record<TakeoverRow['status'], { variant: 'success' | 'warning' | 'neutral' | 'error' | 'default'; label: string }> = {
  scheduled: { variant: 'default', label: 'Scheduled' },
  active: { variant: 'success', label: 'Active' },
  done: { variant: 'neutral', label: 'Done' },
  cancelled: { variant: 'neutral', label: 'Cancelled' },
  blocked: { variant: 'error', label: 'Blocked' },
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')
const localToISO = (local: string) => (local ? new Date(local).toISOString() : '')

function IdCell({ id }: { id: string }) {
  return <code className="font-mono text-[11px] text-fg-muted">{id}</code>
}

export function ExperimentsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'takeovers' ? 'takeovers' : 'experiments'
  const { hasCapability } = useCan()
  const canManage = hasCapability('manage:variants' as never)
  const { confirm, confirmDialog } = useConfirm()

  const [experiments, setExperiments] = useState<ExperimentRow[]>([])
  const [takeovers, setTakeovers] = useState<TakeoverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [startOpen, setStartOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      adminFetch<{ data: ExperimentRow[] }>('/admin/ext/variants/experiments'),
      adminFetch<{ data: TakeoverRow[] }>('/admin/ext/variants/takeovers'),
    ])
      .then(([e, t]) => { setExperiments(e.data); setTakeovers(t.data) })
      .catch((e) => toast.error('Could not load experiments', (e as Error).message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(reload, [reload])

  usePageHeader({
    title: 'Experiments',
    icon: <DynamicIcon name="RiTestTubeLine" className="size-4" />,
    description: 'A/B experiments and timed takeovers on your content',
    tabs: [{ id: 'experiments', label: 'Experiments' }, { id: 'takeovers', label: 'Takeovers' }],
    activeTab: tab,
    onTabChange: (id) => setSearchParams(id === 'takeovers' ? { tab: 'takeovers' } : {}, { replace: true }),
    actions: canManage ? (
      tab === 'experiments'
        ? <Button size="sm" onClick={() => setStartOpen(true)}>Start experiment</Button>
        : <Button size="sm" onClick={() => setScheduleOpen(true)}>Schedule takeover</Button>
    ) : undefined,
  }, [tab, canManage])

  const stopExperiment = async (r: ExperimentRow) => {
    if (!(await confirm({
      title: 'Stop this experiment?',
      message: 'Every visitor goes back to the base object. The record stays here for reference.',
    }))) return
    try {
      await adminFetch(`/admin/ext/variants/experiments/${r.experimentId}/stop`, { method: 'POST' })
      toast.success('Experiment stopped')
      reload()
    } catch (e) { toast.error('Could not stop the experiment', (e as Error).message) }
  }

  const cancelTakeover = async (r: TakeoverRow) => {
    const live = r.status === 'active'
    if (!(await confirm({
      title: 'Cancel this takeover?',
      message: live
        ? 'The takeover is live: cancelling reverts the object to its snapshot right away.'
        : 'The scheduled apply and revert will not run.',
      variant: 'destructive',
    }))) return
    try {
      await adminFetch(`/admin/ext/variants/takeovers/${r.takeoverId}/cancel`, { method: 'POST' })
      toast.success(live ? 'Takeover cancelled and reverted' : 'Takeover cancelled')
      reload()
    } catch (e) { toast.error('Could not cancel the takeover', (e as Error).message) }
  }

  const experimentColumns: DataListColumn<ExperimentRow>[] = [
    { key: 'typeName', header: 'Type', cell: (r) => <span className="text-sm font-medium text-fg">{r.typeName}</span> },
    { key: 'baseObjectId', header: 'Base', cell: (r) => <IdCell id={r.baseObjectId} /> },
    { key: 'variantObjectId', header: 'Variant', cell: (r) => <IdCell id={r.variantObjectId} /> },
    { key: 'split', header: 'Split', cell: (r) => <span className="text-xs text-fg-muted">{100 - r.split}% base / {r.split}% variant</span> },
    {
      key: 'status', header: 'Status',
      cell: (r) => r.status === 'running' ? <Badge variant="success">Running</Badge> : <Badge variant="neutral">Stopped</Badge>,
    },
    { key: 'startedAt', header: 'Started', cell: (r) => <span className="text-xs text-fg-subtle">{fmt(r.startedAt)}</span> },
    {
      key: 'ops', header: '',
      cell: (r) => r.status === 'running' && canManage ? (
        <div className="flex justify-end">
          <Button size="xs" variant="secondary" onClick={(e) => { e.stopPropagation(); stopExperiment(r) }}>Stop</Button>
        </div>
      ) : null,
    },
  ]

  const takeoverColumns: DataListColumn<TakeoverRow>[] = [
    { key: 'typeName', header: 'Type', cell: (r) => <span className="text-sm font-medium text-fg">{r.typeName}</span> },
    { key: 'objectId', header: 'Target', cell: (r) => <IdCell id={r.objectId} /> },
    { key: 'variantObjectId', header: 'Variant', cell: (r) => <IdCell id={r.variantObjectId} /> },
    {
      key: 'window', header: 'Window',
      cell: (r) => <span className="text-xs text-fg-muted">{fmt(r.startAt)} → {fmt(r.endAt)}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (r) => {
        const meta = TAKEOVER_BADGE[r.status]
        return (
          <span title={r.status === 'blocked' ? r.reason : undefined}>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </span>
        )
      },
    },
    {
      key: 'ops', header: '',
      cell: (r) => (r.status === 'scheduled' || r.status === 'active') && canManage ? (
        <div className="flex justify-end">
          <Button size="xs" variant="secondary" className="text-danger-fg hover:bg-danger-muted"
            onClick={(e) => { e.stopPropagation(); cancelTakeover(r) }}>
            Cancel
          </Button>
        </div>
      ) : null,
    },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-6 space-y-3">
        {tab === 'experiments' ? (
          <>
            <DataList<ExperimentRow>
              columns={experimentColumns}
              rows={experiments}
              rowKey={(r) => r.experimentId}
              loading={loading}
              emptyState={{
                title: 'No experiments yet',
                description: 'Create a variant from an object\'s Variants panel, publish both sides, then start an experiment here.',
              }}
            />
            <Text variant="help">
              Your frontend fetches running experiments from the key route and buckets visitors with the SDK's pickVariant helper. Blocked or draft objects never enter an experiment: both sides must be published to start.
            </Text>
          </>
        ) : (
          <>
            <DataList<TakeoverRow>
              columns={takeoverColumns}
              rows={takeovers}
              rowKey={(r) => r.takeoverId}
              loading={loading}
              emptyState={{
                title: 'No takeovers yet',
                description: 'Schedule one to swap a variant\'s content onto an object for a time window - it reverts itself when the window ends.',
              }}
            />
            <Text variant="help">
              Apply and revert ride the background queue, so timing resolves within seconds, not milliseconds. A takeover blocked by another extension (for example a review gate) is marked Blocked with the reason.
            </Text>
          </>
        )}
      </div>

      {startOpen && <StartExperimentDialog onClose={() => setStartOpen(false)} onDone={() => { setStartOpen(false); reload() }} />}
      {scheduleOpen && <ScheduleTakeoverDialog onClose={() => setScheduleOpen(false)} onDone={() => { setScheduleOpen(false); reload() }} />}
      {confirmDialog}
    </div>
  )
}

function StartExperimentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [typeName, setTypeName] = useState('')
  const [baseObjectId, setBaseObjectId] = useState('')
  const [variantObjectId, setVariantObjectId] = useState('')
  const [split, setSplit] = useState('50')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try {
      await adminFetch('/admin/ext/variants/experiments/start', {
        method: 'POST',
        body: JSON.stringify({ typeName, baseObjectId, variantObjectId, split: Number(split) }),
      })
      toast.success('Experiment started')
      onDone()
    } catch (e) {
      toast.error('Could not start the experiment', (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Start an experiment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Content type</Label>
            <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. page" />
          </div>
          <div>
            <Label>Base object id</Label>
            <Input value={baseObjectId} onChange={(e) => setBaseObjectId(e.target.value)} placeholder="The object visitors see today" />
          </div>
          <div>
            <Label>Variant object id</Label>
            <Input value={variantObjectId} onChange={(e) => setVariantObjectId(e.target.value)} placeholder="Created from the editor's Variants panel" />
          </div>
          <div>
            <Label>Variant split (%)</Label>
            <Input type="number" min={0} max={100} value={split} onChange={(e) => setSplit(e.target.value)} />
            <p className="mt-1 text-xs text-fg-subtle">Percentage of visitors who see the variant. Both objects must be published.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={start} disabled={busy || !typeName || !baseObjectId || !variantObjectId}>
            {busy ? 'Starting…' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleTakeoverDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [typeName, setTypeName] = useState('')
  const [objectId, setObjectId] = useState('')
  const [variantObjectId, setVariantObjectId] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [busy, setBusy] = useState(false)

  const schedule = async () => {
    setBusy(true)
    try {
      await adminFetch('/admin/ext/variants/takeovers', {
        method: 'POST',
        body: JSON.stringify({ typeName, objectId, variantObjectId, startAt: localToISO(startAt), endAt: localToISO(endAt) }),
      })
      toast.success('Takeover scheduled')
      onDone()
    } catch (e) {
      toast.error('Could not schedule the takeover', (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule a takeover</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Content type</Label>
            <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. page" />
          </div>
          <div>
            <Label>Target object id</Label>
            <Input value={objectId} onChange={(e) => setObjectId(e.target.value)} placeholder="The object to take over (e.g. the homepage)" />
          </div>
          <div>
            <Label>Variant object id</Label>
            <Input value={variantObjectId} onChange={(e) => setVariantObjectId(e.target.value)} placeholder="The content to apply during the window" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Starts</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <Label>Ends</Label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-fg-subtle">
            At the start the variant's field values are written onto the target and published; at the end the snapshot taken now is restored. The current draft values are the snapshot.
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={schedule} disabled={busy || !typeName || !objectId || !variantObjectId || !startAt || !endAt}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
