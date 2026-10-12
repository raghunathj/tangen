

import { apiUrl } from '@/lib/api-origin'
import { Badge, Button, Callout, Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, EmptyState, FilterBar, Input, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Skeleton, type FieldFilter, type FilterableField } from '@/kit'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { IconCode, IconPencil, IconEye, IconEyeOff, IconTrash, IconSearch, IconSparkles, IconWarning, IconCopy, IconCheck, IconChevronRight, IconMoreHorizontal } from '@tangen/icons'
import { toast } from '@/lib/toast'
import { DeleteTypeDialog } from '@/components/schema-builder/delete-type-dialog'
import { PushOverlay } from '@/components/schema-builder/push-overlay'
import { NamedIcon } from '@/components/schema-builder/icon-picker'
import { saveSchemaType, deleteSchemaType, waitForPush, notifyTypesChanged } from '@/lib/schema-save'
import { referringRelationFields } from '@/lib/schema-builder-model'
import { useAuthStore } from '@/lib/auth'
import { adminFetch } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import { fieldTypeLabel, fieldConfigSummary, SYSTEM_FIELDS } from '@/lib/schema-display'
import { NewTypeModal } from '@/components/schema-builder/new-type-modal'
import { BuildWithAiModal } from '@/components/schema-builder/build-with-ai-modal'
import { usePageHeader } from '@/lib/page-header'
import type { FieldType, FieldConfig } from '@tangen/types'

/** The last push recorded for this environment, as GET /types/health reports it. */
interface LastPush {
  status: 'running' | 'applied' | 'failed'
  startedAt: string
  finishedAt: string | null
  cliVersion: string | null
  gitSha: string | null
  error: string | null
  summary: string
}

interface ApiField {
  name: string
  label: string
  fieldType: FieldType
  config: FieldConfig
  required: boolean
  position: number
}

interface ApiType {
  id?: string
  name: string
  label: string
  singleton: boolean
  disabled?: boolean
  /** The extension that provisioned this type. Null/absent = the site's own schema code declares it. */
  providedBy?: string | null
  admin: {
    listView?: { columns?: string[] }
    editorView?: { main?: string[]; sidebar?: string[] }
    menu?: { icon?: string; label?: string; order?: number; show?: boolean }
  }
  fields: ApiField[]
}

/** Renders `text` with every case-insensitive occurrence of `q` wrapped in a
 *  highlight, so a search match is easy to spot in a row. Empty `q` is a no-op. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim()
  if (!needle) return <>{text}</>
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  const nl = needle.toLowerCase()
  let i = 0
  let n = 0
  while (i < text.length) {
    const hit = lower.indexOf(nl, i)
    if (hit === -1) { parts.push(text.slice(i)); break }
    if (hit > i) parts.push(text.slice(i, hit))
    parts.push(<mark key={n++} className="rounded-sm bg-warning-muted px-0.5 text-fg">{text.slice(hit, hit + needle.length)}</mark>)
    i = hit + needle.length
  }
  return <>{parts}</>
}

// A subtle, tokenised accent for a handful of families, neutral otherwise, so
// the field-type chips read on the Lightfield surface without a rainbow.
const FIELD_TYPE_TONE: Partial<Record<FieldType, 'accent' | 'success' | 'warning' | 'info'>> = {
  text: 'accent', email: 'accent', url: 'accent', phone: 'accent', textarea: 'accent', richtext: 'accent',
  number: 'warning', date: 'info', boolean: 'success',
  select: 'warning', multiselect: 'warning',
  relation: 'info', object: 'info', media: 'info',
}

function FieldTypeChip({ fieldType }: { fieldType: FieldType }) {
  const tone = FIELD_TYPE_TONE[fieldType]
  const cls = tone === 'accent' ? 'bg-accent-muted text-accent-fg'
    : tone === 'success' ? 'bg-success-muted text-success-fg'
    : tone === 'warning' ? 'bg-warning-muted text-warning-fg'
    : tone === 'info' ? 'bg-info-muted text-info-fg'
    : 'bg-surface-hover text-fg-muted'
  return <span className={clsx('inline-flex items-center rounded-sm px-1.5 py-0.5 text-ui-2xs font-medium', cls)}>{fieldTypeLabel(fieldType)}</span>
}

function FieldRow({ field, system = false, disabled = false, q = '' }: { field: { name: string; label: string; fieldType: FieldType; config: FieldConfig; required?: boolean }; system?: boolean; disabled?: boolean; q?: string }) {
  const summary = fieldConfigSummary(field.fieldType, field.config ?? {})
  return (
    <div className={clsx(
      'flex items-center gap-3 px-4 py-2.5 text-sm border-b border-border last:border-0',
      (system || disabled) && 'opacity-60',
    )}>
      {!system && <CopyName name={field.name} />}
      <div className="w-36 shrink-0">
        <span className={clsx('font-mono text-xs', disabled ? 'text-fg-subtle line-through' : 'text-fg-muted')}><Highlight text={field.name} q={q} /></span>
      </div>
      <div className="w-36 shrink-0 text-fg truncate"><Highlight text={field.label} q={q} /></div>
      <div className="w-28 shrink-0">
        <FieldTypeChip fieldType={field.fieldType} />
      </div>
      <div className="flex-1 min-w-0 text-ui-xs text-fg-subtle truncate">{summary}</div>
      {disabled && <Badge variant="warning">Disabled</Badge>}
      {field.required && !disabled && <Badge variant="neutral">Required</Badge>}
    </div>
  )
}

const IS_DEV = import.meta.env.DEV

/** The schema list's own filters (no content-object system filters): the type's
 *  state and whether it is a single-entry (singleton) type. */
const SCHEMA_FILTER_FIELDS: FilterableField[] = [
  { name: 'state', label: 'State', fieldType: 'select', options: [
    { label: 'Active', value: 'Active' },
    { label: 'Disabled', value: 'Disabled' },
  ] },
  { name: 'kind', label: 'Kind', fieldType: 'select', options: [
    { label: 'Singleton', value: 'Singleton' },
    { label: 'Collection', value: 'Collection' },
  ] },
]

function matchesSchemaFilters(type: ApiType, filters: FieldFilter[]): boolean {
  for (const f of filters) {
    const vals = Array.isArray(f.value) ? (f.value as string[]) : f.value ? [String(f.value)] : []
    if (vals.length === 0) continue
    const actual = f.fieldName === 'state' ? (type.disabled ? 'Disabled' : 'Active')
      : f.fieldName === 'kind' ? (type.singleton ? 'Singleton' : 'Collection')
      : null
    if (actual === null) continue
    const hit = vals.includes(actual)
    const negated = ['nin', 'ne'].includes(f.operator)
    if (negated ? hit : !hit) return false
  }
  return true
}

/** Copy a field's code name to the clipboard, with a brief check. */
function CopyName({ name }: { name: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="xs" variant="ghost" className="size-6 shrink-0 p-0"
      title={`Copy "${name}"`}
      aria-label={`Copy field name ${name}`}
      onClick={() => { void copyToClipboard(name, `Copied "${name}"`); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
      icon={copied ? <IconCheck className="size-3.5 text-success-fg" /> : <IconCopy className="size-3.5" />}
    />
  )
}

/** Read-only fields reference for a type — active fields (by position) first,
 *  disabled fields greyed at the bottom, plus the always-present system columns. */
function FieldsPanel({ type, q = '' }: { type: ApiType; q?: string }) {
  const fields = [...type.fields].sort((a, b) => {
    const ad = (a as { disabled?: boolean }).disabled ? 1 : 0
    const bd = (b as { disabled?: boolean }).disabled ? 1 : 0
    return ad !== bd ? ad - bd : a.position - b.position
  })
  return (
    <div className="border-t border-border bg-surface-sunken/30">
      {fields.length === 0 && (
        <p className="px-4 py-2.5 text-xs text-fg-subtle">No custom fields - only the system columns below.</p>
      )}
      {fields.map((f) => (
        <FieldRow key={f.name} field={f} disabled={(f as { disabled?: boolean }).disabled === true} q={q} />
      ))}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-[11px] text-fg-subtle border-t border-border/60">
        <span className="font-medium text-fg-muted">System columns:</span>
        <span className="font-mono">id</span>
        {SYSTEM_FIELDS.map((sf) => <span key={sf.name} className="font-mono">{sf.name}</span>)}
      </div>
    </div>
  )
}

function TypeRow({ type, issueCount = 0, onShowIssues, expanded = false, onToggleExpand, onView, onEdit, onToggleDisabled, onDelete, q = '' }: { type: ApiType; issueCount?: number; onShowIssues?: () => void; expanded?: boolean; onToggleExpand?: () => void; onView?: () => void; onEdit?: () => void; onToggleDisabled?: () => void; onDelete?: () => void; q?: string }) {
  const hasMenu = Boolean(onView || onEdit || onToggleDisabled || onDelete)
  return (
    <div className="rounded-card border border-border bg-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <Button
          size="xs" variant="ghost" className="-ml-1 size-6 shrink-0 p-0"
          onClick={onToggleExpand} aria-label={expanded ? 'Hide fields' : 'Show fields'} aria-expanded={expanded} title={expanded ? 'Hide fields' : 'Show fields'}
          icon={<IconChevronRight className={clsx('size-4 transition-transform motion-fast', expanded && 'rotate-90')} />}
        />
        <NamedIcon name={type.admin?.menu?.icon} className="size-4 shrink-0 text-fg-subtle" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={clsx('truncate text-ui-sm font-medium', type.disabled ? 'text-fg-muted' : 'text-fg')}><Highlight text={type.label} q={q} /></span>
          <span className="truncate font-mono text-ui-xs text-fg-subtle"><Highlight text={type.name} q={q} /></span>
          {type.singleton && <Badge variant="neutral">Singleton</Badge>}
          {type.disabled && <Badge variant="warning">Disabled</Badge>}
          {/* Provisioned by an extension: no schema file for it in this project, and none missing. */}
          {type.providedBy && <Badge variant="neutral">{`from ${type.providedBy}`}</Badge>}
          {issueCount > 0 && (
            <Button
              size="xs" variant="ghost" onClick={onShowIssues}
              title={`${issueCount} schema issue${issueCount > 1 ? 's' : ''} - open for details`}
              aria-label={`${issueCount} schema issue${issueCount > 1 ? 's' : ''}`}
              className="h-5 shrink-0 gap-1 rounded-sm bg-warning-muted px-1.5 text-ui-2xs font-medium text-warning-fg hover:bg-warning-muted"
              icon={<IconWarning className="size-3.5" />}
            >
              {issueCount}
            </Button>
          )}
        </div>
        {hasMenu && (
          <div onClick={(e) => e.stopPropagation()}>
            <Menu>
              <MenuTrigger asChild>
                <Button size="xs" variant="ghost" aria-label={`Actions for ${type.label}`} icon={<IconMoreHorizontal className="size-4" />} />
              </MenuTrigger>
              <MenuContent align="end">
                {onView && <MenuItem onSelect={onView}><IconEye aria-hidden />View content</MenuItem>}
                {onEdit && <MenuItem onSelect={onEdit}><IconPencil aria-hidden />Edit schema</MenuItem>}
                {onToggleDisabled && (
                  <MenuItem onSelect={onToggleDisabled}>
                    {type.disabled ? <IconEye aria-hidden /> : <IconEyeOff aria-hidden />}
                    {type.disabled ? 'Enable' : 'Disable'}
                  </MenuItem>
                )}
                {onDelete && (
                  <>
                    <MenuSeparator />
                    <MenuItem destructive onSelect={onDelete}><IconTrash aria-hidden />Delete</MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          </div>
        )}
      </div>
      {expanded && <FieldsPanel type={type} q={q} />}
    </div>
  )
}

export default function SchemaViewerPage() {
  const params = useParams<{ workspaceId: string }>()
  const [toggling, setToggling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ApiType | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>([])
  const accessToken = useAuthStore((s) => s.accessToken)
  const [types, setTypes] = useState<ApiType[]>([])
  const [typeHealth, setTypeHealth] = useState<Record<string, { tableExists: boolean; issues?: string[] }>>({})
  // The last push recorded in the per-environment ledger (schema_pushes) - shown
  // under the mode banner so "did the last push finish" is never a guess.
  const [lastPush, setLastPush] = useState<LastPush | null>(null)
  const [healthModal, setHealthModal] = useState<ApiType | null>(null)
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const toggleExpand = (name: string) => setExpandedTypes((prev) => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Whether the builder may write schema files (dev + writable source). The
  // visual builder (SB-3+) unlocks when this is true; read-only otherwise.
  const [schemaWritable, setSchemaWritable] = useState(false)
  const [tab, setTab] = useState<'schemas' | 'components' | 'globals'>('schemas')
  const [newKind, setNewKind] = useState<'type' | 'component' | 'global' | null>(null)
  const navigate = useNavigate()

  async function exportSchema() {
    try {
      const res = await fetch(apiUrl(`/api/v1/admin/schema/export`), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'tangen-schema-export.ts'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      toast.error('Export failed', e instanceof Error ? e.message : undefined)
    }
  }

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: ApiType[] }>('/types')
      .then((r) => setTypes(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    adminFetch<{ data: Record<string, { tableExists: boolean; issues?: string[] }>; lastPush?: LastPush | null }>('/types/health')
      .then((r) => { setTypeHealth(r.data); setLastPush(r.lastPush ?? null) })
      .catch(() => {})
  }, [accessToken])

  // Alphabetical, searchable listing. Search matches the type (label or code
  // name) AND its fields (name or label), so "price" surfaces a type that has a
  // price field; such a type auto-expands so the match is visible. Filters
  // narrow by state and kind.
  const { visibleTypes, fieldMatched } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fieldMatched = new Set<string>()
    const list = [...types]
      .sort((a, b) => a.label.localeCompare(b.label))
      .filter((t) => matchesSchemaFilters(t, fieldFilters))
      .filter((t) => {
        if (!q) return true
        if (t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) return true
        const inField = (t.fields ?? []).some((f) => f.name.toLowerCase().includes(q) || (f.label ?? '').toLowerCase().includes(q))
        if (inField) fieldMatched.add(t.name)
        return inField
      })
    return { visibleTypes: list, fieldMatched }
  }, [types, search, fieldFilters])
  const filtersActive = fieldFilters.length > 0

  /** Health issues for a type — table-missing note (last push didn't finish) plus
   *  any dangling-reference validation messages. Shown behind the row's ⚠ icon. */
  function issuesFor(name: string): string[] {
    const h = typeHealth[name]
    if (!h) return []
    const out: string[] = []
    if (h.tableExists === false) out.push(`Table missing - the last push didn't finish. Fix the errors and push again (tangen doctor lists everything that drifted).`)
    for (const iss of h.issues ?? []) out.push(iss)
    return out
  }

  /** TL-5: permanent delete — typed confirmation, then delete + push --confirm. */
  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await deleteSchemaType(deleting.name)
      toast.success(`"${deleting.label}" deleted - dropping its table…`)
      setDeleting(null)
      const outcome = await waitForPush(res.pushId)
      if (outcome.status === 'failed') {
        // Most common cause: relation fields elsewhere still target this type (push restrict)
        toast.error('Removed from code, but the drop was refused', outcome.output?.slice(-300))
      } else if (outcome.status === 'ok') {
        toast.success('Table dropped')
      } else {
        toast.error('Push is taking unusually long - check the schema list in a moment')
      }
      const r = await adminFetch<{ data: ApiType[] }>('/types')
      setTypes(r.data)
      notifyTypesChanged()
    } catch (e) {
      toast.error('Delete failed', e instanceof Error ? e.message : undefined)
    } finally {
      setDeleteBusy(false)
    }
  }

  /** TL-4: soft delete toggle — rewrites the type with the flag flipped, then pushes. */
  async function toggleDisabled(t: ApiType) {
    setToggling(t.name)
    try {
      const res = await saveSchemaType({
        id: t.id ?? `oty_${t.name}`,
        name: t.name,
        label: t.label,
        disabled: !t.disabled,
        admin: t.admin ?? {},
        fields: [...t.fields].sort((a, b) => a.position - b.position).map((f) => ({
          name: f.name, label: f.label, fieldType: f.fieldType, config: f.config ?? {}, required: f.required,
        })),
      })
      toast.success(t.disabled ? `"${t.label}" enabled` : `"${t.label}" disabled - content APIs now answer 404`)
      const outcome = await waitForPush(res.pushId)
      if (outcome.status === 'failed') toast.error('Saved to code, but push failed', outcome.output?.slice(0, 200))
      const r = await adminFetch<{ data: ApiType[] }>('/types')
      setTypes(r.data)
      notifyTypesChanged()
    } catch (e) {
      toast.error('Toggle failed', e instanceof Error ? e.message : undefined)
    } finally {
      setToggling(null)
    }
  }

  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: { schemaWritable?: boolean } }>('/admin/ui-config')
      .then((r) => setSchemaWritable(r.data?.schemaWritable === true))
      .catch(() => setSchemaWritable(false))
  }, [accessToken])

  const [components, setComponents] = useState<{ name: string; label?: string; fields?: unknown[] }[]>([])
  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: { name: string; label?: string; fields?: unknown[] }[] }>('/admin/schema/components')
      .then((r) => setComponents(r.data ?? []))
      .catch(() => setComponents([]))
  }, [accessToken])

  const [globals, setGlobals] = useState<{ name: string; label?: string; fields?: unknown[] }[]>([])
  useEffect(() => {
    if (!accessToken) return
    adminFetch<{ data: { name: string; label?: string; fields?: unknown[] }[] }>('/admin/schema/globals')
      .then((r) => setGlobals(r.data ?? []))
      .catch(() => setGlobals([]))
  }, [accessToken])

  const startNew = (kind: 'type' | 'component' | 'global') => setNewKind(kind)
  const [aiOpen, setAiOpen] = useState(false)

  const newAction: Record<'schemas' | 'components' | 'globals', { kind: 'type' | 'component' | 'global'; label: string }> = {
    schemas: { kind: 'type', label: 'Create New Content Type' },
    components: { kind: 'component', label: 'New Component' },
    globals: { kind: 'global', label: 'New Global' },
  }

  // Layout-owned header: title + tabs (in the crumb bar) + per-tab action.
  usePageHeader({
    title: 'Schemas & Components',
    icon: <IconCode className="size-4" />,
    tabs: [
      { id: 'schemas', label: 'Content Types' },
      { id: 'components', label: 'Reusable Components' },
      { id: 'globals', label: 'Globals' },
    ],
    activeTab: tab,
    onTabChange: (id) => setTab(id as 'schemas' | 'components' | 'globals'),

    actions: schemaWritable ? (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={exportSchema} title="Download the whole schema as a TypeScript file">Export .ts</Button>
        {false && (   /* #33: Build-with-AI paused - prefer terminal agents/MCP */
        <Button size="sm" variant="secondary" onClick={() => setAiOpen(true)} icon={<IconSparkles className="size-3.5 text-accent" />}>Build with AI</Button>
        )}
        <Button size="sm" onClick={() => startNew(newAction[tab].kind)}>{newAction[tab].label}</Button>
      </div>
    ) : null,
  }, [tab, schemaWritable, search, types.length, components.length, globals.length])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <DeleteTypeDialog
        type={deleting}
        cascade={deleting ? referringRelationFields(types as never, deleting.name, components as never) : []}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
      <PushOverlay
        show={!!toggling || deleteBusy}
        label={deleteBusy ? 'Deleting type and dropping its table…' : 'Applying change…'}
      />
      <Dialog open={!!healthModal} onOpenChange={(o) => { if (!o) setHealthModal(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconWarning className="size-4 text-warning-fg" />
              Schema issues - {healthModal?.label}
            </DialogTitle>
            <DialogDescription>
              Fix these so “{healthModal?.name}” builds and serves correctly.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
            {(healthModal ? issuesFor(healthModal.name) : []).map((iss, i) => (
              <Callout key={i} variant="warning">
                <span className="min-w-0 break-words">{iss}</span>
              </Callout>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setHealthModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BuildWithAiModal open={aiOpen} onOpenChange={setAiOpen} kind={newAction[tab].kind} />
      <NewTypeModal
        open={!!newKind}
        onOpenChange={(o) => { if (!o) setNewKind(null) }}
        title={newKind === 'component' ? 'New reusable component' : newKind === 'global' ? 'New global' : 'New content type'}
        showIcon={newKind !== 'component'}
        showSingleton={newKind === 'type'}
        nameHint={newKind === 'component' ? 'hero_banner' : newKind === 'global' ? 'site_settings' : 'blog_post'}
        labelHint={newKind === 'component' ? 'Hero Banner' : newKind === 'global' ? 'Site Settings' : 'Blog Post'}
        onContinue={(meta) => {
          const kind = newKind
          setNewKind(null)
          const base = `/${params.workspaceId}/schema`
          navigate(
            kind === 'component' ? `${base}/components/new`
              : kind === 'global' ? `${base}/globals/new`
              : `${base}/new`,
            { state: { meta } },
          )
        }}
      />

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Mode + last push: one status strip, not two stacked banners. */}
          <Callout variant={schemaWritable ? 'success' : 'info'} className="mb-5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span>{schemaWritable
                ? 'Dev mode - create and edit here; changes write to app/ and push.'
                : 'Read-only - this is a build/production runtime. Run the site with bun run dev to edit the schema visually.'}</span>
              {lastPush && (
                <span className={clsx('text-ui-xs', lastPush.status === 'failed' ? 'text-danger-fg' : 'text-fg-subtle')}>
                  Last push: {lastPush.summary}
                </span>
              )}
            </div>
          </Callout>

          {tab === 'schemas' && (
            <>
              {loading && <Skeleton variant="rows" rows={3} />}
              {error && <Callout variant="danger">{error}</Callout>}
              {!loading && !error && types.length === 0 && (
                <EmptyState icon={<IconCode className="size-6" />} title="No content types yet"
                  description={schemaWritable ? 'Run tangen push to register your schema, or create a type above.' : 'No content types have been set up yet.'} />
              )}
              {!loading && !error && types.length > 0 && (
                <div className="flex flex-col gap-2">
                  {/* View bar: a full-width search with the filter icon at its right (the API Manager pattern). */}
                  <div className="mb-1 flex items-center gap-2">
                    <div className="flex-1">
                      <Input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search types and fields…" icon={<IconSearch className="size-3.5" />} aria-label="Search types and fields" />
                    </div>
                    <FilterBar mode="icon" activeFilters={fieldFilters} dateFilters={{}} filterableFields={SCHEMA_FILTER_FIELDS} systemFilters={false} onFiltersChange={(f) => setFieldFilters(f)} />
                  </div>
                  {filtersActive && (
                    <div className="mb-1">
                      <FilterBar mode="chips" activeFilters={fieldFilters} dateFilters={{}} filterableFields={SCHEMA_FILTER_FIELDS} systemFilters={false} onFiltersChange={(f) => setFieldFilters(f)} />
                    </div>
                  )}
                  {visibleTypes.map((t) => (
                    <TypeRow
                      key={t.name}
                      type={t}
                      issueCount={issuesFor(t.name).length}
                      onShowIssues={() => setHealthModal(t)}
                      q={search}
                      expanded={expandedTypes.has(t.name) || fieldMatched.has(t.name)}
                      onToggleExpand={() => toggleExpand(t.name)}
                      onView={() => navigate(`/${params.workspaceId}/objects/${t.name}`)}
                      // An extension owns this type's definition. The builder
                      // writes app/content-objects/<name>/schema.ts, so
                      // offering Edit or Delete here would silently create a
                      // site OVERRIDE (or ask to drop a table the extension
                      // still needs) instead of changing the extension.
                      onEdit={schemaWritable && !t.providedBy ? () => navigate(`/${params.workspaceId}/schema/${t.name}/edit`) : undefined}
                      onToggleDisabled={schemaWritable && toggling !== t.name ? () => toggleDisabled(t) : undefined}
                      onDelete={schemaWritable && !t.providedBy ? () => setDeleting(t) : undefined}
                    />
                  ))}
                  {visibleTypes.length === 0 && (
                    <EmptyState title="No types match" description={search ? `Nothing matches "${search}".` : 'No types match the filters.'} />
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'components' && (
            components.length === 0 ? (
              <EmptyState title="No reusable components yet" description={schemaWritable ? 'Use New Component to define one.' : undefined} />
            ) : (
              <div className="flex flex-col gap-2">
                {components.map((c) => (
                  <div key={c.name} className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-ui-sm font-medium text-fg">{c.label ?? c.name}</span>
                      <span className="ml-2 font-mono text-ui-xs text-fg-subtle">{c.name}</span>
                    </div>
                    <span className="text-ui-xs text-fg-subtle">{c.fields?.length ?? 0} fields</span>
                    {schemaWritable && (
                      <Button size="xs" variant="ghost" onClick={() => navigate(`/${params.workspaceId}/schema/components/${c.name}/edit`)} icon={<IconPencil className="size-3.5" />}>Edit</Button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'globals' && (
            globals.length === 0 ? (
              <EmptyState title="No globals yet" description={schemaWritable ? 'Use New Global to define one.' : undefined} />
            ) : (
              <div className="flex flex-col gap-2">
                {globals.map((g) => (
                  <div key={g.name} className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-ui-sm font-medium text-fg">{g.label ?? g.name}</span>
                      <span className="ml-2 font-mono text-ui-xs text-fg-subtle">{g.name}</span>
                    </div>
                    <span className="text-ui-xs text-fg-subtle">{g.fields?.length ?? 0} fields</span>
                    {schemaWritable && (
                      <Button size="xs" variant="ghost" onClick={() => navigate(`/${params.workspaceId}/schema/globals/${g.name}/edit`)} icon={<IconPencil className="size-3.5" />}>Edit</Button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
