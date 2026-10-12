/**
 * File Name: submissions.tsx
 * Purpose: What people sent: one form's submissions in a list, filtered by
 *          date, exported as CSV; one submission opens in a sheet with its
 *          values, the team's labels and internal notes.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { IconCalendar, IconChevronDown, IconInbox, IconSearch, IconSurvey, IconTrash } from '@tangen/icons'
import {
  AdminPage, Button, DataList, FilterBar, Input, Label, LabelInput, Popover, PopoverContent, PopoverTrigger,
  Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Textarea, cx, toast, useCan, useConfirm, useLocaleStore,
  type DataListBulkAction, type DataListColumn, type DateFilters,
} from '@/kit'
import { formsApi, formatValue, labelMapOf, optionLabelsOf, relativeTime, type FormRow, type Submission } from '../api'
import { fieldTypeConfig } from '../field-types'
import { isValuelessField, type FormField } from '../../contract'
import { formsTabs } from './forms-list'

const PAGE_SIZE = 25

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function SubmissionSheet({ submission, labelMap, optionLabels, canWrite, onClose, onChanged }: { submission: Submission; labelMap: Record<string, string>; optionLabels: Record<string, Record<string, string>>; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [notes, setNotes] = useState(submission.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const entries = Object.entries(submission.data)
  async function saveNotes() {
    setSavingNotes(true)
    try { await formsApi.saveNotes(submission.formId, submission.id, notes); toast.success('Notes saved'); onChanged() }
    catch (e) { toast.error('Could not save notes', (e as Error).message) }
    finally { setSavingNotes(false) }
  }
  async function remove() {
    if (!(await confirm({ title: 'Delete this submission?', message: 'The submission and its values are removed for good.', confirmLabel: 'Delete', variant: 'destructive' }))) return
    setDeleting(true)
    try { await formsApi.deleteSubmission(submission.formId, submission.id); toast.success('Submission deleted'); onChanged(); onClose() }
    catch (e) { toast.error('Could not delete the submission', (e as Error).message); setDeleting(false) }
  }
  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>Submission</SheetTitle>
          <p className="mt-1 text-ui-xs text-fg-subtle">{fmt(submission.createdAt)}{submission.ipAddress ? ` · ${submission.ipAddress}` : ''} · <span className="font-mono">{submission.id.slice(0, 8)}</span></p>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {entries.length === 0 ? <p className="text-ui-sm text-fg-subtle">No values were recorded.</p> : (
            <dl className="divide-y divide-border-subtle">
              {entries.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-2.5">
                  <dt className="truncate text-ui-xs font-medium text-fg-muted">{labelMap[k] ?? k}</dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words text-ui-sm text-fg">{formatValue(v, optionLabels[k]) || <span className="text-fg-subtle">Empty</span>}</dd>
                </div>
              ))}
            </dl>
          )}
          <LabelInput entityType="submission" entityId={submission.id} canWrite={canWrite} />
          <div>
            <Label htmlFor="submission-notes" className="mb-1.5">Internal notes</Label>
            <Textarea id="submission-notes" rows={4} value={notes} disabled={!canWrite} onChange={(e) => setNotes(e.currentTarget.value)} placeholder="For your team. Never shown to the person who submitted." />
            {canWrite && <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" isLoading={savingNotes} disabled={notes === (submission.notes ?? '')} onClick={saveNotes}>Save notes</Button></div>}
          </div>
        </SheetBody>
        <SheetFooter>
          {canWrite && <Button variant="destructive" size="sm" isLoading={deleting} onClick={remove}>Delete</Button>}
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
      {confirmDialog}
    </Sheet>
  )
}

type LabelOp = 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends'
type SortConfig = { field: string; direction: 'asc' | 'desc' }

/** The columns the list shows for a form: the fields flagged for it, else the first three that hold a value. */
export function listFieldsOf(fields: FormField[] | undefined): FormField[] {
  const valued = (fields ?? []).filter((f) => !isValuelessField(f.type))
  const flagged = valued.filter((f) => f.showInList)
  return flagged.length > 0 ? flagged : valued.slice(0, 3)
}

/** Which form: the view switcher of this list, searchable since a workspace can hold many. */
function FormSwitcher({ forms, value, count, onChange }: { forms: FormRow[]; value: string; count: number; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const current = forms.find((f) => f.id === value)
  const shown = forms.filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()) || f.slug.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ('') }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="submissions-form-picker" className="h-7 min-w-0 max-w-72 shrink gap-1.5 px-1.5 font-medium text-fg data-[state=open]:bg-surface-selected">
          <IconSurvey className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">{current?.name ?? (forms.length ? 'Choose a form' : 'No forms yet')}</span>
          {current && <span className="shrink-0 font-normal text-fg-subtle tabular-nums">{`· ${count}`}</span>}
          <IconChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border-subtle p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Search forms" icon={<IconSearch className="size-3.5" />} aria-label="Search forms" />
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {shown.map((f) => (
            <Button key={f.id} variant="ghost" size="sm" className={cx('w-full justify-start rounded-none px-3 font-normal', f.id === value && 'bg-surface-sunken')} onClick={() => { onChange(f.id); setOpen(false) }}>
              <span className="truncate">{f.name}</span>
              <span className="ml-auto pl-3 text-ui-2xs text-fg-subtle">{f.submissionCount ?? 0}</span>
            </Button>
          ))}
          {shown.length === 0 && <p className="px-3 py-6 text-center text-ui-xs text-fg-subtle">No form matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function SubmissionsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [params, setParams] = useSearchParams()
  const { hasCapability } = useCan()
  const canWrite = hasCapability('forms:submissions' as never)
  const base = `/${workspaceId}/extensions/forms`
  const { confirm, confirmDialog } = useConfirm()
  const localeEnabled = useLocaleStore((s) => s.enabled)
  const localeList = useLocaleStore((s) => s.locales)
  const localeDefault = useLocaleStore((s) => s.defaultLocale)

  const [forms, setForms] = useState<FormRow[]>([])
  const [formId, setFormId] = useState(params.get('form') ?? '')
  const [from, setFrom] = useState(params.get('from') ?? '')
  const [to, setTo] = useState(params.get('to') ?? '')
  const [labels, setLabels] = useState<string[]>((params.get('labels') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const [labelsOp, setLabelsOp] = useState<LabelOp>((params.get('labelsop') as LabelOp) || 'all')
  const [locales, setLocales] = useState<string[]>((params.get('locales') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const [search, setSearch] = useState(params.get('q') ?? '')
  // No sort is the inbox's natural order, newest first; the URL keeps an explicit asc or desc.
  const [sort, setSort] = useState<SortConfig | undefined>(() => {
    const dir = params.get('sort')
    return dir === 'asc' || dir === 'desc' ? { field: 'createdAt', direction: dir } : undefined
  })
  const [rows, setRows] = useState<Submission[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [detail, setDetail] = useState<Submission | null>(null)

  useEffect(() => {
    formsApi.list().then((list) => {
      setForms(list)
      setFormId((cur) => cur || list[0]?.id || '')
    }).catch(() => {})
  }, [])
  const form = forms.find((f) => f.id === formId)
  const labelMap = useMemo(() => labelMapOf(form?.fields), [form])
  const optionLabels = useMemo(() => optionLabelsOf(form?.fields), [form])
  const listFields = useMemo(() => listFieldsOf(form?.fields), [form])

  // The filter as the API reads it, and as the URL keeps it.
  const filter = useMemo(() => {
    const q: Record<string, string> = {}
    if (from) q.from = from
    if (to) q.to = to
    if (labels.length) { q.labels = labels.join(','); q.labelsOp = labelsOp }
    if (locales.length) q.locales = locales.join(',')
    if (search.trim()) q.q = search.trim()
    if (sort?.field === 'createdAt') q.sort = sort.direction
    return q
  }, [from, to, labels, labelsOp, locales, search, sort])
  useEffect(() => {
    const next: Record<string, string> = {}
    if (formId) next.form = formId
    for (const [k, v] of Object.entries(filter)) next[k === 'labelsOp' ? 'labelsop' : k] = v
    setParams(next, { replace: true })
  }, [formId, filter, setParams])

  const load = useCallback(async (p = 1) => {
    if (!formId) { setRows([]); setTotal(0); return }
    setLoading(true)
    try {
      const res = await formsApi.submissions(formId, { ...filter, limit: String(PAGE_SIZE), offset: String((p - 1) * PAGE_SIZE) })
      setRows(res.data)
      setTotal(res.meta.total)
    } catch (e) {
      toast.error('Could not load submissions', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [formId, filter])
  useEffect(() => { setPage(1); setSelected([]); void load(1) }, [load])

  async function download(extra: Record<string, unknown> = {}) {
    if (!formId) return
    try {
      const blob = await formsApi.exportCsv(formId, { ...filter, ...extra })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${form?.slug ?? 'form'}-submissions.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error('Could not export', (e as Error).message)
    }
  }

  async function removeMany(ids: string[]) {
    if (!formId || ids.length === 0) return
    if (!(await confirm({ title: `Delete ${ids.length === 1 ? 'this submission' : `${ids.length} submissions`}?`, message: 'They and their values are removed for good.', confirmLabel: 'Delete', variant: 'destructive' }))) return
    try {
      await Promise.all(ids.map((id) => formsApi.deleteSubmission(formId, id)))
      toast.success(ids.length === 1 ? 'Submission deleted' : `${ids.length} submissions deleted`)
      setSelected([])
      await load(page)
    } catch (e) {
      toast.error('Could not delete', (e as Error).message)
    }
  }

  const columns = useMemo<DataListColumn<Submission>[]>(() => [
    ...listFields.map((f) => {
      const Icon = fieldTypeConfig(f.type)?.icon
      return {
        key: `f:${f.name}`, header: f.label || f.name, icon: Icon ? <Icon className="size-3.5" /> : undefined,
        cell: (s: Submission) => <span className="text-ui-sm text-fg">{formatValue(s.data[f.name], optionLabels[f.name])}</span>,
      } satisfies DataListColumn<Submission>
    }),
    {
      key: 'notes', header: 'Notes', className: 'w-48',
      cell: (s) => <span className="truncate text-ui-xs text-fg-subtle">{s.notes ?? ''}</span>,
    },
    { key: 'when', header: 'Created', sortKey: 'createdAt', icon: <IconCalendar className="size-3.5" />, className: 'w-36', cell: (s) => <span className="text-ui-xs text-fg-subtle" title={fmt(s.createdAt)}>{relativeTime(s.createdAt)}</span> },
  ], [listFields, optionLabels])

  const bulkActions: DataListBulkAction[] = canWrite ? [
    { key: 'export', label: 'Export CSV', type: 'action', onClick: (ids) => download({ ids }) },
    { key: 'delete', label: 'Delete', type: 'action', variant: 'destructive', icon: <IconTrash className="size-3.5" />, onClick: (ids) => removeMany(ids) },
  ] : [{ key: 'export', label: 'Export CSV', type: 'action', onClick: (ids) => download({ ids }) }]

  const filtered = Boolean(from || to || labels.length || locales.length)
  const dateFilters: DateFilters = { createdAtFrom: from || undefined, createdAtTo: to || undefined }
  // The platform's filter bar: the received date, labels and (where localization is on) the locale; no field filters yet.
  const filterBarProps = {
    activeFilters: [], filterableFields: [], dateFilters, systemFilterKinds: ['created_date' as const],
    onFiltersChange: (_f: unknown, d: DateFilters) => { setFrom(d.createdAtFrom ?? ''); setTo(d.createdAtTo ?? '') },
    localeOptions: localeEnabled ? localeList : undefined, activeLocales: locales, defaultLocale: localeDefault,
    onLocalesChange: localeEnabled ? setLocales : undefined,
    labelType: 'entity:submission', activeLabels: labels, activeLabelOp: labelsOp,
    onLabelsChange: (l: string[], o: LabelOp) => { setLabels(l); setLabelsOp(o) },
  }

  return (
    <AdminPage title="Forms" icon={<IconSurvey className="size-4" />} description="Collect submissions from your site" tabs={formsTabs(base)} flush access={{ capability: 'forms:submissions' }}>
      <DataList<Submission>
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        loading={loading}
        onRowClick={setDetail}
        search={search}
        searchPlaceholder={form ? `Search ${form.name} submissions` : 'Search submissions'}
        onSearchChange={setSearch}
        sortConfig={sort}
        onSortChange={(s) => setSort(s?.field === 'createdAt' ? s : undefined)}
        selectable={rows.length > 0}
        selectedIds={selected}
        onSelectionChange={setSelected}
        bulkActions={bulkActions}
        toolbarLeft={<FormSwitcher forms={forms} value={formId} count={total} onChange={setFormId} />}
        toolbarRight={<FilterBar mode="button" {...filterBarProps} />}
        filterRow={filtered ? <FilterBar mode="chips" {...filterBarProps} /> : undefined}
        page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(p) => { setPage(p); void load(p) }}
        filtered={filtered || Boolean(search.trim())}
        emptyState={{ icon: <IconInbox className="size-6" />, title: formId ? 'No submissions yet' : 'No forms yet', description: formId ? 'They appear here as soon as the form is live and someone sends it.' : 'Create a form first.', action: total > 0 ? undefined : undefined }}
        filteredEmptyState={{ title: 'No submissions match', description: 'Try another search or clear the filters.' }}
      />
      {detail && <SubmissionSheet submission={detail} labelMap={labelMap} optionLabels={optionLabels} canWrite={canWrite} onClose={() => setDetail(null)} onChanged={() => load(page)} />}
      {confirmDialog}
    </AdminPage>
  )
}
