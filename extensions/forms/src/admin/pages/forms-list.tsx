/**
 * File Name: forms-list.tsx
 * Purpose: The Forms home: every form of the workspace with its state and
 *          how many submissions it holds. New forms start from a name or
 *          from a brief; a form opens in the builder.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconInbox, IconMoreHorizontal, IconPlus, IconSparkles, IconSurvey, IconTrash } from '@tangen/icons'
import {
  AdminPage, Badge, Button, DataList, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  FilterDropdown, Input, Label, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, toast, useCan, useCapabilities, useConfirm, type DataListColumn,
} from '@/kit'
import { formsApi, relativeTime, type FormRow } from '../api'
import { GenerateDialog, type GeneratedDefinition } from '../builder/generate-dialog'

const PAGE_SIZE = 20

export function formsTabs(base: string) {
  return [
    { id: 'forms', label: 'Forms', href: base, icon: <IconSurvey aria-hidden /> },
    { id: 'submissions', label: 'Submissions', href: `${base}/submissions`, icon: <IconInbox aria-hidden /> },
  ]
}

export function FormsListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { hasCapability } = useCan()
  const canManage = hasCapability('forms:manage' as never)
  // AI is offered only where the workspace has it on (the capability store) and the member may use it.
  const capabilities = useCapabilities(workspaceId)
  const canAI = canManage && capabilities.isOn('ai') && hasCapability('use:ai' as never)
  const base = `/${workspaceId}/extensions/forms`
  const { confirm, confirmDialog } = useConfirm()

  const [rows, setRows] = useState<FormRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true)
    try { setRows(await formsApi.list()) }
    catch (e) { toast.error('Could not load forms', (e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    let list = rows
    if (status) list = list.filter((f) => (status === 'live' ? f.isLive : !f.isLive))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q))
    return list
  }, [rows, status, search])
  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

  async function create() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const row = await formsApi.create(name)
      setCreateOpen(false)
      setNewName('')
      navigate(`${base}/${row.id}`)
    } catch (e) {
      toast.error('Could not create the form', (e as Error).message)
    } finally {
      setCreating(false)
    }
  }
  async function createFromDraft(def: GeneratedDefinition) {
    try {
      const row = await formsApi.create(String(def.name ?? 'New form'))
      await formsApi.patch(row.id, { fields: def.fields ?? [], settings: { ...(def.settings ?? {}), steps: def.steps ?? undefined } })
      navigate(`${base}/${row.id}`)
    } catch (e) {
      toast.error('Could not create the form', (e as Error).message)
    }
  }
  async function remove(form: FormRow) {
    if (!(await confirm({ title: `Delete ${form.name}?`, message: `Its ${form.submissionCount ?? 0} submissions go with it. This cannot be undone.`, confirmLabel: 'Delete', variant: 'destructive' }))) return
    try {
      await formsApi.remove(form.id)
      setRows((prev) => prev.filter((f) => f.id !== form.id))
      toast.success('Form deleted')
    } catch (e) {
      toast.error('Could not delete the form', (e as Error).message)
    }
  }

  const columns = useMemo<DataListColumn<FormRow>[]>(() => [
    {
      key: 'name', header: 'Name',
      cell: (f) => (
        <div className="min-w-0">
          <p className="truncate text-ui-sm font-medium text-fg">{f.name}</p>
          <p className="truncate font-mono text-ui-2xs text-fg-subtle">{f.slug}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', className: 'w-36',
      cell: (f) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant={f.isLive ? 'success' : 'neutral'}>{f.isLive ? 'Live' : 'Draft'}</Badge>
          {f.source === 'code' && <Badge variant="info" title="Defined in app/forms">Code</Badge>}
        </span>
      ),
    },
    { key: 'submissions', header: 'Submissions', className: 'w-32', cell: (f) => <span className="text-ui-sm text-fg-muted">{f.submissionCount ?? 0}</span> },
    { key: 'updated', header: 'Updated', className: 'w-32', cell: (f) => <span className="text-ui-xs text-fg-subtle" title={new Date(f.updatedAt).toLocaleString()}>{relativeTime(f.updatedAt)}</span> },
    {
      // One menu per row, not a bare delete: what you can do with the form, the
      // destructive thing last and out of the way of a stray click.
      key: 'actions', header: '', className: 'w-12',
      cell: (f: FormRow) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Menu>
            <MenuTrigger asChild>
              <Button size="xs" variant="ghost" aria-label={`Actions for ${f.name}`} icon={<IconMoreHorizontal className="size-3.5" />} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => navigate(`${base}/submissions?form=${encodeURIComponent(f.id)}`)}>
                <IconInbox aria-hidden />
                View submissions
              </MenuItem>
              {canManage && (
                <>
                  <MenuSeparator />
                  <MenuItem destructive disabled={f.source === 'code'} onSelect={() => { void remove(f) }}>
                    <IconTrash aria-hidden />
                    Delete
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      ),
    } satisfies DataListColumn<FormRow>,
  ], [canManage]) // eslint-disable-line react-hooks/exhaustive-deps

  const actions: ReactNode = canManage ? (
    <div className="flex items-center gap-2">
      {canAI && <Button size="xs" variant="secondary" icon={<IconSparkles className="size-3.5" />} onClick={() => setGenOpen(true)}>Describe a form</Button>}
      <Button size="xs" icon={<IconPlus className="size-3.5" />} onClick={() => setCreateOpen(true)}>New form</Button>
    </div>
  ) : null

  return (
    <AdminPage title="Forms" icon={<IconSurvey className="size-4" />} description="Collect submissions from your site" tabs={formsTabs(base)} actions={actions} flush access={{ capability: 'forms:read' }}>
      <DataList<FormRow>
        columns={columns}
        rows={paged}
        rowKey={(f) => f.id}
        loading={loading}
        onRowClick={(f) => navigate(`${base}/${f.id}`)}
        search={search}
        searchPlaceholder="Search forms"
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        toolbarLeft={<FilterDropdown label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: 'All forms' }, { value: 'live', label: 'Live' }, { value: 'draft', label: 'Draft' }]} />}
        page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage}
        filtered={Boolean(search || status)}
        emptyState={{
          icon: <IconSurvey className="size-6" />,
          title: 'No forms yet',
          description: canManage ? 'A contact form, a sign-up, a request for a demo: start with a name.' : 'Nothing has been created yet.',
          action: canManage ? <Button size="sm" icon={<IconPlus className="size-3.5" />} onClick={() => setCreateOpen(true)}>New form</Button> : undefined,
        }}
        filteredEmptyState={{ title: 'No forms match', description: 'Try another name or clear the filter.' }}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setNewName('') }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New form</DialogTitle>
            <DialogDescription>Name it the way your site will refer to it.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="new-form-name" className="mb-1">Name</Label>
            <Input id="new-form-name" autoFocus value={newName} onChange={(e) => setNewName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create() }} placeholder="Contact us" />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} isLoading={creating} disabled={!newName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} current={null} onApply={(def) => { void createFromDraft(def) }} />
      {confirmDialog}
    </AdminPage>
  )
}
