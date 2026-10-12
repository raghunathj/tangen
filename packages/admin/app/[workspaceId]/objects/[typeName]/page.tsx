

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { DynamicIcon } from '@/components/dynamic-icon'
import { IconPlus, IconFileText, IconSearch, IconCopy, IconCheck, IconClock } from '@tangen/icons'
import { ICON_FOR } from '@/components/schema-builder/field-types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { TableRoot, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/table'
import { useAuthStore } from '@/lib/auth'
import { usePresenceWatch } from '@/lib/realtime'
import { RowPresence } from '@/components/object-list/RowPresence'
import { useCan } from '@/lib/use-can'
import { toast } from '@/lib/toast'
import { adminFetch } from '@/lib/api'
import { useLifecycleActions, isAvailable } from '@/lib/lifecycle-actions'
import type { LifecycleActionId } from '@tangen/types'
import { cachedAdminGet } from '@/lib/api-cache'
import { copyToClipboard } from '@/lib/clipboard'
import { useLocaleStore } from '@/lib/locale'
import { localeColor } from '@/components/i18n/localized-field-inputs'
import { usePageHeader } from '@/lib/page-header'
import { normalizeObjectData } from '@/lib/editor'
import { buildStaticUrl } from '@/lib/media'
import { type LabelFilterOp } from '@/components/object-list/filter-bar'
import { ViewDropdown } from '@/components/object-list/view-dropdown'
import { FilterBar } from '@/components/object-list/filter-bar'
import { SaveViewDialog } from '@/components/object-list/save-view-dialog'
import type { FilterState, SavedView, FilterableField, FieldFilter, DateFilters } from '@/components/object-list/types'
import type { ListViewColumns } from '@tangen/types'
import { activeFields } from '@tangen/types'
import { FILTERABLE_FIELD_TYPES } from '@/components/object-list/types'
import { format, parseISO } from 'date-fns'
import { TaxonomyTree } from '@/components/taxonomy/TaxonomyTree'
import { AdminDataList, type RowAction } from '@/components/admin-data-list'
import { ViewBar, type DataListColumn } from '@tangen/ui'
import { APP_BULK_ACTIONS } from '@/lib/app-ui-registry'
import { useExtensionInstalled } from '@/components/extension-page-gate'

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = 'all' | 'draft' | 'published' | 'archived'

interface ObjectRow {
  id: string
  title: string | null
  status: string
  updated_at: string
  published_at: string | null
  scheduled_at: string | null
  published_values: Record<string, unknown> | string | null
  _has_draft_app_data?: boolean
  [key: string]: unknown
}

interface FieldDef {
  name: string
  label: string
  fieldType: string
  config: {
    admin?: { showInFilter?: boolean; listDisplayField?: string }
    options?: { label: string; value: string }[]
    targetType?: string
    many?: boolean
  }
}

interface TypeDef {
  name: string
  label: string
  singleton?: boolean
  fields?: FieldDef[]
  admin?: {
    menu?: { icon?: string; label?: string }
    taxonomy?: { hierarchical?: boolean; orderable?: boolean; parentType?: string }
    listView?: {
      columns?: ListViewColumns
      defaultSort?: { field: string; direction: 'asc' | 'desc' }
      perPage?: number
    }
  }
}

/**
 * The server's draft-changes rule (K3): every member read carries
 * `hasDraftChanges`, computed from the live values and the published snapshot
 * (translations included when the read asked for every locale). Panel data
 * (an extension's draft, e.g. SEO) rides on `_has_draft_app_data`.
 */
function rowHasDraftChanges(row: ObjectRow): boolean {
  if (row.status !== 'published') return false
  if (row._has_draft_app_data) return true
  return (row as Record<string, unknown>).hasDraftChanges === true
}

function StatusCell({ row, fieldTypes }: { row: ObjectRow; fieldTypes: Map<string, string> }) {
  const { status, scheduled_at } = row
  const hasDraftChanges = rowHasDraftChanges(row)

  if (status === 'scheduled') {
    const dateStr = scheduled_at
      ? new Date(scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : null
    return (
      <span className="group relative inline-flex items-center gap-1.5 text-ui-xs font-medium text-accent-fg">
        <span className="size-1.5 shrink-0 rounded-full bg-accent" />
        Scheduled
        {dateStr && (
          <>
            <svg className="size-3 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-max max-w-[180px] -translate-x-1/2 whitespace-nowrap rounded-control bg-surface-inverted px-2 py-1 text-ui-2xs font-normal text-fg-inverted opacity-0 transition-opacity motion-fast group-hover:opacity-100">
              {dateStr}
            </span>
          </>
        )}
      </span>
    )
  }
  if (status === 'published') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-success-fg">
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
          Published
        </span>
        {hasDraftChanges && (
          <span className="text-ui-2xs font-normal text-warning-fg" title="Changes in draft">Draft changes</span>
        )}
      </span>
    )
  }
  if (status === 'archived') {
    return (
      <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-fg-subtle">
        <span className="size-1.5 shrink-0 rounded-full bg-fg-faint" />
        Archived
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-ui-xs font-medium text-fg-muted">
      <span className="size-1.5 shrink-0 rounded-full bg-fg-subtle" />
      Draft
    </span>
  )
}

/**
 * Status change modal content — rendered inside AdminDataList's Dialog shell via rowActions.
 * Receives the ObjectRow and an onSave callback; manages its own value/saving state.
 */
function StatusChangeModalContent({ row, onClose, onSave }: {
  row: ObjectRow
  onClose: () => void
  onSave: (newStatus: string) => Promise<void>
}) {
  const [value, setValue] = useState<'draft' | 'published' | 'archived'>(
    (row.status ?? 'draft') as 'draft' | 'published' | 'archived'
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try { await onSave(value) } finally { setSaving(false) }
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit</DialogTitle>
        <DialogDescription>
          Change the status for <span className="font-medium text-fg">"{row.title ?? 'Untitled'}"</span>.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-1">
        {([
          { value: 'draft',     label: 'Draft',     dotClass: 'bg-fg-faint',  textClass: 'text-fg-muted' },
          { value: 'published', label: 'Published', dotClass: 'bg-success', textClass: 'text-success-fg' },
          { value: 'archived',  label: 'Archived',  dotClass: 'bg-fg-faint',  textClass: 'text-fg-subtle' },
        ] as const).map(({ value: v, label, dotClass, textClass }) => (
          <label
            key={v}
            className={clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors',
              value === v ? 'border-accent/30 bg-accent-muted' : 'border-border bg-surface hover:bg-surface-sunken',
            )}
          >
            <input
              type="radio"
              name="row-status"
              value={v}
              checked={value === v}
              onChange={() => setValue(v)}
              className="form-radio size-4 text-accent-fg"
            />
            <span className={clsx('size-2 rounded-full shrink-0', dotClass)} />
            <span className={clsx('text-sm font-medium', textClass)}>{label}</span>
          </label>
        ))}
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}

// Returns the human-readable label from an expanded relation value.
// value may be a full object (depth:1) or a raw ID string (fallback).
function resolveRelationLabel(value: unknown, displayField: string): string {
  if (!value) return '-'
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return String(obj[displayField] ?? obj.title ?? obj.id ?? '-')
  }
  return String(value)
}

function RelationCell({
  value, displayField, targetType, workspaceId, targetDisabled,
}: {
  value: unknown; displayField: string; targetType: string
  workspaceId: string; targetDisabled?: boolean
}) {
  const obj = (value && typeof value === 'object') ? value as Record<string, unknown> : null
  const id  = obj ? String(obj.id ?? '') : (typeof value === 'string' ? value : '')
  const label = resolveRelationLabel(value, displayField)

  // TL-4: the target type is disabled — the stored id stays, nothing resolves
  if (targetDisabled && id) {
    return <span className="text-xs text-fg-subtle italic" title={id}>Temporarily unavailable</span>
  }

  if (!id || label === '-') return <span className="text-fg-subtle">-</span>

  // A record chip (the grid benchmark): an initial in one of four muted
  // tones chosen by the id, so the same record always wears the same one.
  return (
    <a
      href={`/${workspaceId}/objects/${targetType}/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={label}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-control bg-surface-sunken pl-1 pr-2 text-ui text-fg transition-colors motion-fast hover:bg-surface-hover"
    >
      <span aria-hidden className={clsx('flex size-4 shrink-0 items-center justify-center rounded-xs text-ui-2xs font-medium uppercase', CHIP_TONES[hashTone(id)])}>
        {label.trim().charAt(0)}
      </span>
      <span className="truncate">{label}</span>
    </a>
  )
}

const CHIP_TONES = [
  'bg-accent-muted text-accent-fg',
  'bg-success-muted text-success-fg',
  'bg-warning-muted text-warning-fg',
  'bg-info-muted text-info-fg',
] as const
function hashTone(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % CHIP_TONES.length
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Converts a field name to a readable column header when no explicit label is set.
// updated_at → "Last updated"; readingMinutes → "Reading Minutes"; cover_image → "Cover Image"
function autoLabel(name: string): string {
  // The storage spellings get their editorial labels; a camelCase name reads
  // as itself in Title Case (Updated At), which the layout lane relies on.
  if (name === 'updated_at') return 'Last updated'
  if (name === 'created_at') return 'Created'
  if (name === 'published_at') return 'Published'
  if (name === 'id') return 'ID'
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Resolves stored value(s) to their human-readable option labels.
// select: "technology" → "Technology"
// multiselect: ["featured", "breaking"] → "Featured, Breaking"
function resolveSelectLabel(
  value: unknown,
  options: { label: string; value: string }[],
  isMulti: boolean,
): string {
  if (value == null || value === '') return '-'
  const lookup = new Map(options.map(o => [o.value, o.label]))
  if (isMulti) {
    const vals = Array.isArray(value) ? (value as string[]) : []
    return vals.length ? vals.map(v => lookup.get(v) ?? v).join(', ') : '-'
  }
  return lookup.get(String(value)) ?? String(value)
}

function fmtDate(iso: string) {
  try { return format(parseISO(iso), 'MMM d, yyyy') } catch { return iso }
}

// ── List cell components ───────────────────────────────────────────────────────

// Title + shortened ID with a hover-copy button
function TitleCell({ title, id }: { title: string; id: string }) {
  const [copied, setCopied] = useState(false)
  const short = id.slice(0, 8)
  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    void copyToClipboard(id, 'ID copied')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  // One line (spec §16: 36px rows). The id is a quiet chip that reveals on
  // row hover or keyboard focus, with its copy button right beside it.
  return (
    <div className="flex min-w-0 max-w-[320px] items-center gap-2">
      <span className="truncate font-medium text-fg" title={title}>{title || '-'}</span>
      <span className="inline-flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity motion-fast group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <span className="rounded-xs bg-surface-sunken px-1 font-mono text-ui-2xs font-normal text-fg-subtle" title={id}>{short}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy ID'}
          title={copied ? 'Copied!' : 'Copy ID'}
          className="flex size-5 items-center justify-center rounded-xs text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          {copied
            ? <IconCheck className="size-3 text-success" aria-hidden />
            : <IconCopy className="size-3" aria-hidden />}
        </button>
      </span>
    </div>
  )
}

// Boolean: green check for true, gray dash for false
/** Title stacked per selected locale — color dot + translation (or a gray dash). */
function MultiLocaleTitleCell({
  row, locales, localeList, defaultLocale,
}: {
  row: ObjectRow
  locales: string[]
  localeList: { code: string; label: string }[]
  defaultLocale: string
}) {
  const orderedCodes = localeList.map(l => l.code)
  const i18n = (row as Record<string, unknown>).i18n as Record<string, { __title?: string }> | undefined
  return (
    <div className="space-y-1 py-0.5 max-w-[260px]">
      {locales.map(code => {
        const def = localeList.find(l => l.code === code)
        const color = localeColor(code, orderedCodes)
        const title = code === defaultLocale
          ? String(row.title ?? '')
          : (i18n?.[code]?.__title ?? '')
        return (
          <div key={code} className="flex items-center gap-1.5 min-w-0" title={def?.label ?? code}>
            <span className={clsx('size-1.5 rounded-full shrink-0', color.dot)} />
            {title ? (
              <span className="text-sm text-fg truncate" title={title}>{title}</span>
            ) : (
              <span className="text-xs text-fg-faint italic">not translated</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BooleanCell({ value }: { value: unknown }) {
  const isTrue = value === true || value === 'true' || value === 1
  return isTrue
    ? (
      <span className="inline-flex items-center gap-1 text-ui-xs font-medium text-success-fg">
        <IconCheck className="size-3.5" aria-hidden /> Yes
      </span>
    )
    : <span className="select-none text-ui-sm text-fg-subtle">-</span>
}

// Media: small thumbnail for images, generic file indicator for others
function MediaCell({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return (
    <span className="inline-flex items-center gap-1 text-[11px] text-fg-faint">
      <IconFileText className="size-4 shrink-0" />
      No file
    </span>
  )
  const asset = value as { id: string; thumbnailPath?: string | null; mimeType?: string; altText?: string | null; filename?: string }
  const isImage = asset.mimeType?.startsWith('image/')
  if (!isImage || !asset.thumbnailPath) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted max-w-[120px]">
        <IconFileText className="size-4 shrink-0 text-fg-subtle" />
        <span className="truncate" title={asset.filename}>{asset.filename ?? '-'}</span>
      </span>
    )
  }
  return (
    <img
      // Static CDN path (the row already carries thumbnailPath) - the
      // /media/file?variant=_thumb route costs a DB lookup per row.
      src={buildStaticUrl(asset.thumbnailPath)}
      alt={asset.altText ?? asset.filename ?? ''}
      loading="lazy"
      decoding="async"
      width={48}
      height={32}
      className="h-8 w-12 rounded object-cover bg-surface-hover"
    />
  )
}

const MAX_VISIBLE_TAGS = 2

// Multiselect: pills, max 2 visible, "+N more" hover/click opens a fixed-position popover
function MultiTagsCell({ values, options }: { values: unknown; options: { label: string; value: string }[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState<{ top: number; left: number } | null>(null)
  const triggerRef      = useRef<HTMLButtonElement>(null)
  const timerRef        = useRef<ReturnType<typeof setTimeout>>()

  const lookup   = useMemo(() => new Map(options.map(o => [o.value, o.label])), [options])
  const vals     = Array.isArray(values) ? (values as string[]) : []
  // Each entry: { display, orphaned }
  const entries  = vals.map(v => ({ display: lookup.get(v) ?? v, orphaned: !lookup.has(v), raw: v }))

  function openPopover() {
    clearTimeout(timerRef.current)
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.top, left: r.left })
    }
    setOpen(true)
  }
  function closePopover() {
    timerRef.current = setTimeout(() => { setOpen(false); setPos(null) }, 120)
  }
  function keepOpen() { clearTimeout(timerRef.current) }

  if (!entries.length) return <span className="text-fg-subtle">-</span>

  const visible  = entries.slice(0, MAX_VISIBLE_TAGS)
  const overflow = entries.slice(MAX_VISIBLE_TAGS)

  function tagClass(orphaned: boolean) {
    return orphaned
      ? 'inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-warning-muted text-warning-fg border border-warning/40 line-through shrink-0'
      : 'inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-surface-hover text-fg shrink-0'
  }

  return (
    <div className="flex items-center gap-1 flex-nowrap" onClick={e => e.stopPropagation()}>
      {visible.map((entry, i) => (
        <span key={i} title={entry.orphaned ? `"${entry.raw}" is no longer a valid option` : entry.display}
          className={tagClass(entry.orphaned)}>
          {entry.orphaned && <span className="mr-0.5 no-underline not-italic">⚠</span>}
          {entry.display}
        </span>
      ))}
      {overflow.length > 0 && (
        <>
          <button
            ref={triggerRef}
            onMouseEnter={openPopover}
            onMouseLeave={closePopover}
            onClick={open ? () => { setOpen(false); setPos(null) } : openPopover}
            className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-surface-hover text-fg-muted hover:bg-surface-hover whitespace-nowrap shrink-0"
          >
            +{overflow.length} more
          </button>
          {open && pos && createPortal(
            <div
              onMouseEnter={keepOpen}
              onMouseLeave={closePopover}
              style={{
                position: 'fixed',
                top:  pos.top,
                left: pos.left,
                transform: 'translateY(calc(-100% - 6px))',
              }}
              className="z-[9999] bg-surface border border-border rounded-xl shadow-xl p-2 flex flex-wrap gap-1 max-w-[240px]"
            >
              {entries.map((entry, i) => (
                <span key={i} title={entry.orphaned ? `"${entry.raw}" is no longer a valid option` : entry.display}
                  className={clsx(tagClass(entry.orphaned), 'max-w-[210px] truncate')}>
                  {entry.display}
                </span>
              ))}
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ObjectListPage() {
  const params = useParams() as { workspaceId: string; typeName: string }
  const { can } = useCan()
  const canWrite = can('write', 'objects', params.typeName)
  const canDelete = can('delete', 'objects', params.typeName)
  // K2: the bulk status menu offers what the server's action policy says
  // this actor may do to objects of this type (grants, base-language rights,
  // an extension's type-level publish policy); the bundle is the fallback.
  const { actions: typeActions } = useLifecycleActions(params.typeName, null)
  const typeAllows = useCallback((id: LifecycleActionId) => (typeActions ? isAvailable(typeActions, id, { forType: true }) : true), [typeActions])
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { accessToken, member } = useAuthStore()
  // Realtime row presence: ONE subscription per type (the per-type aggregate),
  // never one per row; each row selects its own people (RowPresence).
  usePresenceWatch(`objects:${params.typeName}`, { enabled: !!params.typeName })
  const localeEnabled = useLocaleStore((st) => st.enabled)
  const localeList = useLocaleStore((st) => st.locales)
  const localeDefault = useLocaleStore((st) => st.defaultLocale)

  const [typeDef, setTypeDef]       = useState<TypeDef | null>(null)
  const [rows, setRows]             = useState<ObjectRow[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const lastQueryRef = useRef<{ key: string; at: number }>({ key: '', at: 0 })
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const porterInstalled = useExtensionInstalled('porter')

  // Filter state — initialised from URL query params so links/refreshes preserve state
  const [statusFilter, setStatusFilter] = useState<Status>(
    (searchParams.get('status') as Status) || 'all'
  )
  const [search, setSearch]             = useState(searchParams.get('q') || '')
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('q') || '')
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>(() => {
    try { return JSON.parse(searchParams.get('filters') || '[]') } catch { return [] }
  })
  const [dateFilters, setDateFilters]   = useState<DateFilters>(() => {
    try { return JSON.parse(searchParams.get('dates') || '{}') } catch { return {} }
  })
  const [localeFilters, setLocaleFilters] = useState<string[]>(() =>
    (searchParams.get('locales') ?? '').split(',').map(c => c.trim()).filter(Boolean))
  const [labelFilters, setLabelFilters] = useState<string[]>(() =>
    (searchParams.get('labels') ?? '').split(',').map(c => c.trim()).filter(Boolean))
  const [labelsOp, setLabelsOp] = useState<LabelFilterOp>((searchParams.get('labelsop') as LabelFilterOp) || 'all')
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get('view'))
  const [page, setPage]                 = useState(() => Math.max(1, parseInt(searchParams.get('page') || '1', 10)))
  const [pageJump, setPageJump]         = useState(() => searchParams.get('page') || '1')
  // Seed from the last resolved schema perPage for this type so the very first
  // fetch uses the right limit (no 10-row flash, no wasted second query). The
  // schema value still wins when the typeDef arrives.
  const [pageLimit, setPageLimit]       = useState(() => {
    const cached = Number(sessionStorage.getItem(`tangen.list.perPage.${params.typeName}`))
    return cached >= 5 && cached <= 50 ? cached : 10
  })
  // Same seeding as pageLimit: remember the schema's defaultSort per type so
  // the first fetch is already sorted correctly (no unsorted flash + refetch).
  const [sortConfig, setSortConfig]     = useState<{ field: string; direction: 'asc' | 'desc' } | undefined>(() => {
    try {
      const raw = sessionStorage.getItem(`tangen.list.sort.${params.typeName}`)
      return raw ? JSON.parse(raw) : undefined
    } catch { return undefined }
  })
  const [selectedIds, setSelectedIds]   = useState<string[]>([])

  // Sync all filter/page state back to URL params (replace so history stays clean)
  useEffect(() => {
    const p: Record<string, string> = {}
    if (statusFilter !== 'all') p.status = statusFilter
    if (search.trim()) p.q = search.trim()
    if (page > 1) p.page = String(page)
    if (activeViewId) p.view = activeViewId
    if (fieldFilters.length > 0) p.filters = JSON.stringify(fieldFilters)
    const hasDate = Object.values(dateFilters).some(Boolean)
    if (hasDate) p.dates = JSON.stringify(dateFilters)
    if (localeFilters.length > 0) p.locales = localeFilters.join(',')
    if (labelFilters.length > 0) { p.labels = labelFilters.join(','); if (labelsOp !== 'all') p.labelsop = labelsOp }
    setSearchParams(p, { replace: true })
  }, [statusFilter, search, page, activeViewId, fieldFilters, dateFilters, localeFilters, labelFilters, labelsOp, setSearchParams])

  const label = typeDef?.admin?.menu?.label ?? typeDef?.label ?? params.typeName

  // Singletons never show a list — land straight in the one editor
  // (existing row when there is one, otherwise the pre-titled New form).
  useEffect(() => {
    if (!typeDef?.singleton) return
    let alive = true
    adminFetch<{ data: { id: string }[] }>(
      `/objects/${params.typeName}/query`,
      { method: 'POST', body: JSON.stringify({ limit: 1, offset: 0, status: 'any' }) })
      .then((r) => {
        if (!alive) return
        const existing = r.data?.[0]?.id
        navigate(`/${params.workspaceId}/objects/${params.typeName}/${existing ?? 'new'}`, { replace: true })
      })
      .catch(() => {
        if (alive) navigate(`/${params.workspaceId}/objects/${params.typeName}/new`, { replace: true })
      })
    return () => { alive = false }
  }, [typeDef?.singleton, params.workspaceId, params.typeName, navigate])

  // Page chrome: type name (+icon) is the screen title; New CTA in the header
  usePageHeader({
    loading: !typeDef,
    title: label,
    icon: typeDef?.admin?.menu?.icon ? <DynamicIcon name={typeDef.admin.menu.icon} className="size-4" /> : undefined,
    description: (typeDef?.admin as any)?.description,
    actions: canWrite ? (
      <Button icon={<IconPlus className="size-[15px]" />} size="xs" onClick={() =>
        navigate(`/${params.workspaceId}/objects/${params.typeName}/new`)
      }>
        New {label}
      </Button>
    ) : null,
  }, [label, typeDef, params.workspaceId, params.typeName, canWrite])

  // Normalise each column entry to { name, label } — string entries get an auto-generated label.
  const columnDefs = useMemo(() => {
    const configured = typeDef?.admin?.listView?.columns ?? []
    // title and status are always fixed; extra columns max 5
    const extra = configured
      .filter(c => { const n = typeof c === 'string' ? c : c.name; return n !== 'title' && n !== 'status' })
      .slice(0, 5)
      .map(c => typeof c === 'string' ? { name: c, label: autoLabel(c) } : c)
    return [
      { name: 'title', label: 'Title' },
      { name: 'status', label: 'Status' },
      ...(extra.length ? extra : [{ name: 'updated_at', label: autoLabel('updated_at') }]),
    ]
  }, [typeDef])

  // Debounce search — show skeleton as soon as the debounce fires (not while typing).
  // Skip when nothing changed: on mount this would set loading=true with no
  // refetch to clear it (fast/empty lists lose the 300ms race → stuck skeleton).
  useEffect(() => {
    if (search === debouncedSearch) return
    const t = setTimeout(() => { setLoading(true); setDebouncedSearch(search) }, 300)
    return () => clearTimeout(t)
  }, [search, debouncedSearch])

  // Keep the jump input in sync when page changes (filter reset, Next/Prev, etc.)
  useEffect(() => { setPageJump(String(page)) }, [page])

  // Map of relation field name → { targetType, displayField } for list rendering
  const [disabledTypes, setDisabledTypes] = useState<Set<string>>(new Set())

  const relationFieldMap = useMemo(() => {
    if (!typeDef?.fields) return new Map<string, { targetType: string; displayField: string }>()
    return new Map(
      typeDef.fields
        .filter(f => f.fieldType === 'relation' && f.config.targetType)
        .map(f => [f.name, {
          targetType:   f.config.targetType!,
          displayField: f.config.admin?.listDisplayField ?? 'title',
        }])
    )
  }, [typeDef])

  // Map of select/multiselect field name → { isMulti, options } for label resolution
  const selectFieldMap = useMemo(() => {
    if (!typeDef?.fields) return new Map<string, { isMulti: boolean; options: { label: string; value: string }[] }>()
    return new Map(
      typeDef.fields
        .filter(f => (f.fieldType === 'select' || f.fieldType === 'multiselect') && f.config.options?.length)
        .map(f => [f.name, {
          isMulti:  f.fieldType === 'multiselect',
          options:  f.config.options!,
        }])
    )
  }, [typeDef])

  const relationFieldNames = useMemo(() =>
    new Set(typeDef?.fields?.filter(f => f.fieldType === 'relation').map(f => f.name) ?? [])
  , [typeDef])

  const fieldTypes = useMemo(() =>
    new Map<string, string>(typeDef?.fields?.map(f => [f.name, f.fieldType]) ?? [])
  , [typeDef])

  const booleanFieldSet = useMemo(() =>
    new Set(typeDef?.fields?.filter(f => f.fieldType === 'boolean').map(f => f.name) ?? [])
  , [typeDef])

  const mediaFieldSet = useMemo(() =>
    new Set(typeDef?.fields?.filter(f => f.fieldType === 'media').map(f => f.name) ?? [])
  , [typeDef])

  // Taxonomy detection
  const isTaxonomyHierarchical = !!(typeDef?.admin?.taxonomy?.hierarchical)
  const isTaxonomyOrderable    = !!(typeDef?.admin?.taxonomy?.orderable)
  // Find the self-referential parent field (relation with targetType === typeName, many:false)
  const taxonomyParentField = useMemo(() => {
    if (!isTaxonomyHierarchical || !typeDef?.fields) return null
    return typeDef.fields.find(
      f => f.fieldType === 'relation'
        && f.config.targetType === params.typeName
        && !f.config.many,
    )?.name ?? null
  }, [typeDef, params.typeName, isTaxonomyHierarchical])

  // Derive filterable fields
  const filterableFields: FilterableField[] = useMemo(() => {
    if (!typeDef?.fields) return []
    return typeDef.fields
      .filter((f) => f.config?.admin?.showInFilter && FILTERABLE_FIELD_TYPES.has(f.fieldType))
      .map((f) => ({
        name: f.name,
        label: f.label,
        fieldType: f.fieldType,
        options: f.config.options,
        targetType: f.config.targetType,
      }))
  }, [typeDef])

  // Column definitions for DataList — rebuilt when field maps or schema change
  const columns = useMemo<DataListColumn<ObjectRow>[]>(() => {
    const nonStatus = columnDefs.filter(c => c.name !== 'status')
    // Every default field may be a column and a sort (2026-09-13): the
    // timestamps in either spelling, id and slug. The API sorts by any of them.
    const SYSTEM_DATE: Record<string, 'created_at' | 'updated_at' | 'published_at'> = {
      created_at: 'created_at', createdAt: 'created_at',
      updated_at: 'updated_at', updatedAt: 'updated_at',
      published_at: 'published_at', publishedAt: 'published_at',
    }
    const isSystem = (name: string) => name in SYSTEM_DATE || name === 'id' || name === 'slug' || name === 'title'
    const iconFor = (name: string) => {
      if (name in SYSTEM_DATE) return IconClock
      return ICON_FOR[fieldTypes.get(name) ?? (name === 'title' || name === 'slug' || name === 'id' ? 'text' : '')] ?? ICON_FOR.text!
    }
    const result: DataListColumn<ObjectRow>[] = nonStatus.map(col => ({
      key: col.name,
      header: col.label,
      icon: (() => { const Icon = iconFor(col.name); return <Icon /> })(),
      sortKey: isSystem(col.name) ? col.name : undefined,
      cell: (row) => {
        const relInfo    = relationFieldMap.get(col.name)
        const selectInfo = selectFieldMap.get(col.name)
        const isBoolean  = booleanFieldSet.has(col.name)
        const isMedia    = mediaFieldSet.has(col.name)
        if (col.name === 'title') {
          if (localeFilters.length > 1) {
            return (
              <MultiLocaleTitleCell
                row={row}
                locales={localeFilters}
                localeList={localeList}
                defaultLocale={localeDefault}
              />
            )
          }
          return (
            <span className="inline-flex items-center">
              <TitleCell title={String(row.title ?? '')} id={row.id} />
              <RowPresence typeSlug={params.typeName as string} objectId={row.id} currentMemberId={member?.memberId ?? null} />
            </span>
          )
        }
        if (col.name in SYSTEM_DATE) {
          const key = SYSTEM_DATE[col.name]!
          const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
          const iso = (row[key] ?? row[camel]) as string | null | undefined
          return <span className="text-ui-sm text-fg-muted tabular-nums">{iso ? formatDate(iso) : '-'}</span>
        }
        if (col.name === 'slug' || col.name === 'id') {
          return <span className="font-mono text-ui-xs text-fg-muted">{String(row[col.name] ?? '-')}</span>
        }
        if (relInfo) {
          return (
            <RelationCell
              value={row[col.name]}
              displayField={relInfo.displayField}
              targetType={relInfo.targetType}
              targetDisabled={disabledTypes.has(relInfo.targetType)}
              workspaceId={params.workspaceId}
            />
          )
        }
        if (isBoolean) return <BooleanCell value={row[col.name]} />
        if (isMedia)   return <MediaCell   value={row[col.name]} />
        if (selectInfo?.isMulti) return <MultiTagsCell values={row[col.name]} options={selectInfo.options} />
        if (selectInfo) {
          const rawVal = row[col.name]
          if (rawVal == null || rawVal === '') return <span className="text-fg-subtle">-</span>
          const lookup = new Map(selectInfo.options.map(o => [o.value, o.label]))
          const optLabel = lookup.get(String(rawVal))
          if (optLabel) return <span className="text-fg">{optLabel}</span>
          return (
            <span title={`"${rawVal}" is no longer a valid option`}
              className="inline-flex items-center gap-0.5 rounded-sm bg-warning-muted px-1.5 py-0.5 text-ui-2xs text-warning-fg line-through ring-1 ring-inset ring-warning/25">
              ⚠ {String(rawVal)}
            </span>
          )
        }
        const numeric = ['number', 'currency', 'rating', 'range'].includes(fieldTypes.get(col.name) ?? '')
        return <span className={numeric ? 'text-fg tabular-nums' : 'text-fg'}>{String(row[col.name] ?? '-')}</span>
      },
    }))
    result.push({
      key: 'status',
      header: 'Status',
      icon: (() => { const Icon = ICON_FOR.select!; return <Icon /> })(),
      cell: (row) => <StatusCell row={row} fieldTypes={fieldTypes} />,
    })
    return result
  }, [fieldTypes, columnDefs, relationFieldMap, selectFieldMap, booleanFieldSet, mediaFieldSet, relationFieldNames, params.workspaceId, params.typeName, member?.memberId, localeFilters, localeList, localeDefault])

  // Fetch objects
  const fetchObjects = useCallback(async () => {
    if (!accessToken) { setLoading(false); return }
    setLoading(true)

    const query: Record<string, unknown> = {}
    if (debouncedSearch.trim()) query.title = { contains: debouncedSearch.trim() }

    // A date-only 'to' bound ('2026-08-02') casts to MIDNIGHT against
    // timestamp columns, so a same-day range matched nothing published during
    // that day. Push it to end-of-day; date-only columns truncate it back.
    // Minute-precision bounds ('...T14:30') get ':59.999' so the chosen
    // minute itself is inclusive.
    const endOfDay = (d: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59.999`
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d) ? `${d}:59.999`
      : d

    if (dateFilters.publishedAtFrom || dateFilters.publishedAtTo) {
      const cond: Record<string, string> = {}
      if (dateFilters.publishedAtFrom) cond.gte = dateFilters.publishedAtFrom
      if (dateFilters.publishedAtTo)   cond.lte = endOfDay(dateFilters.publishedAtTo)
      query.published_at = cond
    }
    if (dateFilters.createdAtFrom || dateFilters.createdAtTo) {
      const cond: Record<string, string> = {}
      if (dateFilters.createdAtFrom) cond.gte = dateFilters.createdAtFrom
      if (dateFilters.createdAtTo)   cond.lte = endOfDay(dateFilters.createdAtTo)
      query.created_at = cond
    }

    for (const f of fieldFilters) {
      if (f.operator === 'range') {
        const val = f.value as { from?: string; to?: string }
        const cond: Record<string, string> = {}
        if (val.from) cond.gte = val.from
        if (val.to)   cond.lte = typeof val.to === 'string' ? endOfDay(val.to) : val.to
        query[f.fieldName] = cond
      } else if (f.operator === 'between') {
        const val = f.value as { from?: number; to?: number }
        const cond: Record<string, number> = {}
        if (val.from != null) cond.gte = val.from
        if (val.to   != null) cond.lte = val.to
        if (Object.keys(cond).length > 0) query[f.fieldName] = cond
      } else if (f.operator === 'in') {
        query[f.fieldName] = { in: f.value }
      } else {
        query[f.fieldName] = { [f.operator]: f.value }
      }
    }

    // Operational-labels filter — substring ops send a single value, set ops the array
    if (labelFilters.length > 0) {
      const sub = labelsOp === 'contains' || labelsOp === 'starts' || labelsOp === 'ends'
      query.labels = { [labelsOp]: sub ? labelFilters[0] : labelFilters }
    }

    // If the modal has a status field filter, let it control status via the query object
    const hasStatusFieldFilter = fieldFilters.some(f => f.fieldName === 'status')

    // Map camelCase system field names the schema uses to the snake_case the API expects
    const body: Record<string, unknown> = {
      limit: pageLimit,
      offset: (page - 1) * pageLimit,
      depth: 1,
      status: hasStatusFieldFilter ? 'any' : (statusFilter === 'all' ? 'any' : statusFilter),
      // Locales filter — one locale overlays the rows; several attach per-row
      // i18n maps so the title column can stack every selected language
      ...(localeFilters.length > 0 ? { locale: localeFilters.join(',') } : {}),
    }
    if (sortConfig) {
      body.sort = {
        // The API sorts by the content model's names (Phase 6A, Unit 5), which
        // is what the table already holds: no translation to columns here.
        field:     sortConfig.field,
        direction: sortConfig.direction,
      }
    }
    if (Object.keys(query).length > 0) body.query = query

    // Burst dedupe: mount fires this 2-3x (StrictMode double-mount + a late
    // dep hydrating) with an IDENTICAL body - skip repeats within a short
    // window. Different bodies (any real filter/page change) always fetch.
    const requestKey = `${params.typeName}:${JSON.stringify(body)}`
    if (lastQueryRef.current.key === requestKey && Date.now() - lastQueryRef.current.at < 400) {
      return
    }
    lastQueryRef.current = { key: requestKey, at: Date.now() }

    try {
      const res = await adminFetch<{ data: ObjectRow[]; meta: { total: number } }>(
        `/objects/${params.typeName}/query`, { method: 'POST', body: JSON.stringify(body) },
      )
      setRows(res.data.map(r => normalizeObjectData(r) as ObjectRow)); setTotal(res.meta.total)
    } catch {
      setRows([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [accessToken, params.typeName, statusFilter, debouncedSearch, fieldFilters, dateFilters, page, pageLimit, sortConfig, localeFilters, labelFilters, labelsOp])

  useEffect(() => { fetchObjects() }, [fetchObjects])

  /**
   * Bulk status change through POST /objects/bulk-update.
   *
   * These actions used to PATCH each id with `{ status }` alone, which the
   * update route rejects outright - it only accepts title, slug and schema
   * fields, so every click 422'd with "No updatable fields provided". The
   * bulk route is the one built for this: it validates each object, writes
   * the published snapshot, runs content hooks (so a review gate can refuse
   * one), and reports per-object failures instead of leaving N parallel
   * requests to fail independently and silently.
   */
  const bulkStatus = useCallback(async (ids: string[], status: 'published' | 'draft' | 'archived') => {
    try {
      const res = await adminFetch<{ updated: number; failed: number; errors?: Array<{ id: string; message: string }> }>(
        '/objects/bulk-update',
        { method: 'POST', body: JSON.stringify({ type: params.typeName, ids, fields: { status } }) },
      )
      if (res.failed > 0) {
        const first = res.errors?.[0]?.message
        const label = status === 'published' ? 'publish' : status === 'draft' ? 'unpublish' : 'archive'
        toast.error(
          `Could not ${label} ${res.failed} of ${ids.length}`,
          first ? `${first}${res.failed > 1 ? ' (and others)' : ''}` : undefined,
        )
      }
    } catch (e) {
      toast.error('Bulk update failed', (e as Error).message)
    } finally {
      fetchObjects()
    }
  }, [params.typeName, fetchObjects])

  const loadSavedViews = useCallback(async () => {
    adminFetch<{ data: SavedView[] }>('/saved-views', undefined, { typeName: params.typeName })
      .then((r) => setSavedViews(r.data)).catch(() => setSavedViews([]))
  }, [params.typeName])

  // Fire typeDef + savedViews in parallel alongside the initial objects fetch — no waterfall
  useEffect(() => {
    if (!accessToken) return

    cachedAdminGet<{ data: { name: string; disabled?: boolean }[] }>('/types')
      .then((r) => setDisabledTypes(new Set((r.data ?? []).filter((t) => t.disabled).map((t) => t.name))))
      .catch(() => {})
    adminFetch<{ data: TypeDef }>(`/types/${params.typeName}`)
      .then((r) => {
        // Soft-disabled fields are hidden from the list (kept in schema/data).
        setTypeDef({ ...r.data, fields: activeFields(r.data.fields ?? []) })

        const newSort = r.data.admin?.listView?.defaultSort
        try {
          if (newSort) sessionStorage.setItem(`tangen.list.sort.${params.typeName}`, JSON.stringify(newSort))
          else sessionStorage.removeItem(`tangen.list.sort.${params.typeName}`)
        } catch { /* private mode */ }
        // Use functional update to avoid triggering re-render when sort hasn't changed
        setSortConfig(prev =>
          JSON.stringify(prev) === JSON.stringify(newSort) ? prev : (newSort ?? undefined)
        )

        const rawLimit = r.data.admin?.listView?.perPage
        const newLimit = rawLimit != null ? Math.min(50, Math.max(5, rawLimit)) : 10
        try { sessionStorage.setItem(`tangen.list.perPage.${params.typeName}`, String(newLimit)) } catch { /* private mode */ }
        setPageLimit(newLimit)
      }).catch(() => {})

    loadSavedViews()

  // fetchObjects intentionally excluded — state changes (sortConfig, pageLimit) auto-trigger refetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, params.typeName, loadSavedViews])


  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFiltersChange(newFieldFilters: FieldFilter[], newDateFilters: DateFilters) {
    setLoading(true)
    setFieldFilters(newFieldFilters)
    setDateFilters(newDateFilters)
    setActiveViewId(null)
    setPage(1)
    if (newFieldFilters.some(f => f.fieldName === 'status')) setStatusFilter('all')
  }

  function handleClearAll() {
    setLoading(true)
    setSearch(''); setDebouncedSearch('')
    setFieldFilters([]); setDateFilters({}); setLocaleFilters([])
    setStatusFilter('all'); setActiveViewId(null); setPage(1)
  }

  function handleLocalesChange(codes: string[]) {
    setLoading(true)
    setLocaleFilters(codes)
    setActiveViewId(null)
    setPage(1)
  }

  async function handleUpdateView() {
    if (!activeViewId) return
    const filters: FilterState = { status: statusFilter, search, dateFilters, fieldFilters, locales: localeFilters }
    await adminFetch(`/saved-views/${activeViewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ filters }),
    })
    await loadSavedViews()
  }

  function handleSelectView(view: SavedView) {
    setLoading(true)
    const f = view.filters
    setStatusFilter(f.status ?? 'all')
    setSearch(f.search ?? ''); setDebouncedSearch(f.search ?? '')
    setFieldFilters(f.fieldFilters ?? [])
    setDateFilters(f.dateFilters ?? {})
    setLocaleFilters(f.locales ?? [])
    setActiveViewId(view.id)
    setPage(1)
  }

  async function handleSaveView(name: string, visibility: 'private' | 'shared') {
    const filters: FilterState = { status: statusFilter, search, dateFilters, fieldFilters, locales: localeFilters }
    await adminFetch('/saved-views', {
      method: 'POST',
      body: JSON.stringify({ name, visibility, typeName: params.typeName, filters }),
    })
    await loadSavedViews()
  }

  async function handleDeleteView(id: string) {
    await adminFetch(`/saved-views/${id}`, { method: 'DELETE' })
    if (activeViewId === id) handleClearAll()
    await loadSavedViews()
  }

  const handleTaxonomyReorder = useCallback(async (updates: { id: string; position: number }[]) => {
    await Promise.all(updates.map(({ id, position }) =>
      adminFetch(`/objects/${params.typeName}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ position }),
      })
    ))
  }, [])

  /**
   * Gated per ACTION, not as a whole list. The built-in ones change content,
   * so they need write - but an app or extension can contribute a bulk action
   * a reader may legitimately run (export a selection, queue a report), and a
   * blanket `if (!canWrite) return []` hid those too. Selection itself is
   * offered only when something can act on it, so a viewer with no actions
   * does not get checkboxes that lead nowhere.
   */
  const bulkActions = useMemo(() => {
    const customActions = APP_BULK_ACTIONS[params.typeName] ?? []
    const writeActions = !canWrite ? [] : [
      { type: 'section' as const, key: '_sys', label: 'System' },
      {
        type: 'group' as const,
        key: 'change-status',
        label: 'Change status',
        children: [
          ...(typeAllows('publish') ? [{
            key: 'publish',
            label: 'Publish',
            onClick: (ids: string[]) => bulkStatus(ids, 'published'),
          }] : []),
          ...(typeAllows('unpublish') ? [{
            key: 'unpublish',
            label: 'Unpublish',
            onClick: (ids: string[]) => bulkStatus(ids, 'draft'),
          }] : []),
          ...(typeAllows('archive') ? [{
            key: 'archive',
            label: 'Archive',
            variant: 'destructive' as const,
            onClick: (ids: string[]) => bulkStatus(ids, 'archived'),
          }] : []),
        ],
      },
      {
        type: 'action' as const,
        key: 'bulk-edit',
        label: 'Edit fields',
        onClick: (ids: string[]) => {
          navigate(`/${params.workspaceId}/objects/${params.typeName}/bulk-edit?ids=${ids.join(',')}`)
          return Promise.resolve()
        },
      },
    ]
    return [
      ...writeActions,
      ...(customActions.length > 0 ? [
        { type: 'section' as const, key: '_custom', label: 'Custom' },
        ...customActions,
      ] : []),
    ]
  }, [params.workspaceId, params.typeName, navigate, fetchObjects, member?.role, canWrite, bulkStatus, typeAllows])

  const rowActions = useMemo<RowAction<ObjectRow>[]>(() => {
    const actions: RowAction<ObjectRow>[] = []
    if (canWrite) actions.push(
      {
        type: 'modal',
        key: 'edit',
        label: 'Edit',
        renderModal: (row, onClose) => (
          <StatusChangeModalContent
            row={row}
            onClose={onClose}
            onSave={async (newStatus) => {
              // Same dead end the bulk buttons had: a status-only PATCH is
              // rejected by the update route. One id through the bulk route,
              // which validates, snapshots and runs the gate.
              await bulkStatus([row.id], newStatus as 'published' | 'draft' | 'archived')
            }}
          />
        ),
      },
    )

    if (canDelete) actions.push({
      type: 'confirm',
      key: 'delete',
      label: 'Delete',
      variant: 'destructive',
      title: (row) => `Delete "${row.title ?? 'Untitled'}"?`,
      message: 'This will archive the item and remove it from all queries. You can restore it by changing its status.',
      confirmLabel: 'Delete',
      onConfirm: async (row) => {
        await adminFetch(`/objects/${params.typeName}/${row.id}`, { method: 'DELETE' })
        fetchObjects()
      },
    })

    return actions
  }, [params.typeName, params.workspaceId, fetchObjects, member?.role, porterInstalled, canWrite, canDelete, bulkStatus])

  const hasPublishedDate = !!(dateFilters.publishedAtFrom || dateFilters.publishedAtTo)
  const hasCreatedDate   = !!(dateFilters.createdAtFrom   || dateFilters.createdAtTo)
  const hasActiveFilters = !!(
    search.trim() || fieldFilters.length > 0 || localeFilters.length > 0 || labelFilters.length > 0 ||
    hasPublishedDate || hasCreatedDate || statusFilter !== 'all'
  )

  const hasUnsavedChanges = !!activeViewId && (() => {
    const view = savedViews.find(v => v.id === activeViewId)
    if (!view) return false
    const s = view.filters
    return s.status !== statusFilter || s.search !== search ||
      JSON.stringify(s.fieldFilters ?? []) !== JSON.stringify(fieldFilters) ||
      JSON.stringify(s.dateFilters ?? {}) !== JSON.stringify(dateFilters) ||
      JSON.stringify(s.locales ?? []) !== JSON.stringify(localeFilters)
  })()

  const taxonomyFilterProps = {
    activeFilters: fieldFilters,
    dateFilters,
    filterableFields,
    localeOptions: localeEnabled ? localeList : undefined,
    activeLocales: localeFilters,
    defaultLocale: localeDefault,
    onLocalesChange: localeEnabled ? handleLocalesChange : undefined,
    onFiltersChange: handleFiltersChange,
    labelType: params.typeName,
    activeLabels: labelFilters,
    activeLabelOp: labelsOp,
    onLabelsChange: (v: string[], op: LabelFilterOp) => { setLabelFilters(v); setLabelsOp(op); setPage(1) },
  }

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Both listings are flush and fill the column (calibration, "Lists"):
          the table scrolls in its own viewport, the taxonomy tree in its own. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {(isTaxonomyHierarchical && taxonomyParentField) ? (
          // ── Taxonomy: hierarchical drag-drop tree ──────────────────────────
          <>
            <ViewBar
              left={(
                <ViewDropdown
                  status={statusFilter}
                  onStatusChange={(s) => { setLoading(true); setStatusFilter(s); setActiveViewId(null); setPage(1) }}
                  savedViews={savedViews}
                  activeViewId={activeViewId}
                  hasActiveFilters={hasActiveFilters}
                  onSelectView={handleSelectView}
                  onClearActiveView={() => setActiveViewId(null)}
                  onSaveView={() => setSaveDialogOpen(true)}
                  onDeleteView={handleDeleteView}
                  currentMemberId={member?.memberId}
                  count={total}
                  collectionLabel={label}
                />
              )}
              right={<FilterBar mode="button" {...taxonomyFilterProps} />}
              search={{
                value: search,
                onChange: (v) => { setSearch(v); setActiveViewId(null); setPage(1); if (!v) { setLoading(true); setDebouncedSearch('') } },
                placeholder: `Search ${label.toLowerCase()}…`,
              }}
              filterRow={(hasActiveFilters || hasUnsavedChanges) ? (
                <>
                  <FilterBar mode="chips" {...taxonomyFilterProps} />
                  {hasUnsavedChanges
                    ? <Button size="xs" onClick={handleUpdateView}>Update view</Button>
                    : <Button size="xs" variant="secondary" className="text-accent-fg" onClick={() => setSaveDialogOpen(true)}>Save as new view</Button>}
                </>
              ) : undefined}
            />
            {/* Shrinkable, never stretched: the pagination follows a short tree
                and pins under a long one, as the table's does. */}
            <div className="min-h-0 overflow-y-auto">
              {loading ? (
                <div className="divide-y divide-border animate-pulse">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <div key={i} className="flex h-11 items-center gap-4 px-3">
                      <div className="h-4 bg-surface-hover rounded" style={{ width: `${48 + (i % 3) * 15}%` }} />
                      <div className="h-5 w-16 bg-surface-hover rounded-full" />
                      <div className="ml-auto h-4 w-24 bg-surface-hover rounded" />
                    </div>
                  ))}
                </div>
              ) : rows.length > 0 ? (
                <TaxonomyTree
                  rows={rows as any[]}
                  parentField={taxonomyParentField}
                  orderable={isTaxonomyOrderable}
                  workspaceId={params.workspaceId}
                  typeName={params.typeName}
                  onReorder={handleTaxonomyReorder}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                  <IconFileText className="size-10 text-fg-faint" />
                  <div className="text-center">
                    <p className="text-sm text-fg-muted mb-1">
                      {hasActiveFilters
                        ? `No ${label.toLowerCase()} match the current filters.`
                        : `No ${label.toLowerCase()} yet.`}
                    </p>
                    {!hasActiveFilters && <p className="text-xs text-fg-subtle">Click the button above to get started.</p>}
                  </div>
                  {hasActiveFilters && (
                    <button onClick={handleClearAll} className="text-xs text-accent-fg hover:text-accent-fg transition-colors">
                      Clear filters
                    </button>
                  )}
                  {!hasActiveFilters && canWrite && (
                    <Button icon={<IconPlus className="size-3.5" />} size="xs" onClick={() =>
                      navigate(`/${params.workspaceId}/objects/${params.typeName}/new`)
                    }>
                      New {label}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {!loading && total > 0 && (() => {
              const totalPages = Math.ceil(total / pageLimit)
              const from = (page - 1) * pageLimit + 1
              const to = Math.min(page * pageLimit, total)
              return (
                <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
                  <p className="text-xs text-fg-subtle">
                    {totalPages > 1
                      ? `Showing ${from}–${to} of ${total} record${total !== 1 ? 's' : ''}`
                      : `${total} record${total !== 1 ? 's' : ''} total`}
                  </p>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        disabled={page <= 1}
                        onClick={() => { setLoading(true); setPage(p => p - 1) }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-surface text-fg-muted hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Previous
                      </button>
                      <div className="flex items-center gap-1 text-xs text-fg-muted tabular-nums">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pageJump}
                          onChange={e => setPageJump(e.target.value.replace(/\D/g, ''))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const n = Math.max(1, Math.min(totalPages, parseInt(pageJump, 10) || page))
                              setPageJump(String(n))
                              if (n !== page) { setLoading(true); setPage(n) }
                              ;(e.target as HTMLInputElement).blur()
                            }
                          }}
                          onBlur={() => {
                            const n = Math.max(1, Math.min(totalPages, parseInt(pageJump, 10) || page))
                            setPageJump(String(n))
                            if (n !== page) { setLoading(true); setPage(n) }
                          }}
                          className="w-10 text-center py-0.5 text-xs border border-border rounded-md outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 bg-surface"
                        />
                        <span>/ {totalPages}</span>
                      </div>
                      <button
                        disabled={page >= totalPages}
                        onClick={() => { setLoading(true); setPage(p => p + 1) }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-surface text-fg-muted hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}

            <SaveViewDialog
              open={saveDialogOpen}
              onClose={() => setSaveDialogOpen(false)}
              onSave={handleSaveView}
            />
          </>
        ) : (
          // ── Standard listing ────────────────────────────────────────────────
          <AdminDataList<ObjectRow>
            collectionLabel={typeDef?.label}
            activeLocales={localeFilters}
            onLocalesChange={handleLocalesChange}
            labelType={params.typeName}
            activeLabels={labelFilters}
            activeLabelOp={labelsOp}
            onLabelsChange={(v, op) => { setLabelFilters(v); setLabelsOp(op); setPage(1) }}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={loading}
            onRowClick={(row) => navigate(`/${params.workspaceId}/objects/${params.typeName}/${row.id}`)}
            page={page}
            pageSize={pageLimit}
            total={total}
            onPageChange={(n) => setPage(n)}
            search={search}
            searchPlaceholder={`Search ${label.toLowerCase()}…`}
            onSearchChange={(value) => {
              setSearch(value)
              setActiveViewId(null)
              setPage(1)
              if (!value) setDebouncedSearch('')
            }}
            sortConfig={sortConfig}
            onSortChange={(sort) => setSortConfig(sort)}
            selectable={bulkActions.length > 0}
            selectedIds={selectedIds}
            onSelectionChange={(ids) => setSelectedIds(ids)}
            bulkActions={bulkActions}
            typeName={params.typeName}
            componentContext={{ workspaceId: params.workspaceId, typeName: params.typeName }}
            rowActions={rowActions}
            emptyState={{
              icon: <IconFileText className="size-10 text-fg-faint" />,
              title: hasActiveFilters
                ? `No ${label.toLowerCase()} match the current filters.`
                : `No ${label.toLowerCase()} yet.`,
              description: hasActiveFilters ? undefined : 'Click the button above to get started.',
              action: hasActiveFilters ? (
                <button onClick={handleClearAll} className="text-xs text-accent-fg hover:text-accent-fg transition-colors">
                  Clear filters
                </button>
              ) : canWrite ? (
                <Button icon={<IconPlus className="size-3.5" />} size="xs" onClick={() =>
                  navigate(`/${params.workspaceId}/objects/${params.typeName}/new`)
                }>
                  New {label}
                </Button>
              ) : undefined,
            }}
            status={statusFilter}
            onStatusChange={(s) => { setLoading(true); setStatusFilter(s); setActiveViewId(null); setPage(1) }}
            savedViews={savedViews}
            activeViewId={activeViewId}
            filterableFields={filterableFields}
            activeFilters={fieldFilters}
            dateFilters={dateFilters}
            onFiltersChange={handleFiltersChange}
            hasActiveFilters={hasActiveFilters}
            hasUnsavedChanges={hasUnsavedChanges}
            onSelectView={handleSelectView}
            onClearActiveView={() => setActiveViewId(null)}
            onSaveView={handleSaveView}
            onUpdateView={handleUpdateView}
            onDeleteView={handleDeleteView}
          />
        )}
      </div>

    </div>
  </>
  )
}
