import { lazy, Suspense, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams, useBlocker } from 'react-router-dom'
import { clsx } from 'clsx'
import * as Switch from '@radix-ui/react-switch'
import { IconChevronLeft, IconCheck, IconX, IconLoader, IconPencil, IconSearch } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { RelationPicker } from '@/components/fields/relation-picker'
import { MultiRelationPicker } from '@/components/fields/multi-relation-picker'
import { useAuthStore } from '@/lib/auth'
import { adminFetch } from '@/lib/api'
import { normalizeObjectData } from '@/lib/editor'
import { getEligibleBulkFields, evalFieldCondition, validateBulkCell } from '@/lib/bulk-edit'
import type { FieldDefinition } from '@tangen/types'

const RichTextEditor = lazy(() => import('@/components/fields/richtext'))

// ── Types ─────────────────────────────────────────────────────────────────────

interface TypeDef {
  name:   string
  label:  string
  fields: FieldDefinition[]
  admin?: { menu?: { label?: string; icon?: string } }
}

type RowResult = { kind: 'success' } | { kind: 'error'; message: string }

// ── Value normalisers ─────────────────────────────────────────────────────────

function toRelationId(v: unknown): string | null {
  if (!v) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object') return String((v as Record<string, unknown>).id ?? '') || null
  return null
}

function toRelationIds(v: unknown): string[] {
  if (!v) return []
  if (Array.isArray(v)) {
    return v.map(item =>
      typeof item === 'string' ? item : String((item as Record<string, unknown>).id ?? ''),
    ).filter(Boolean)
  }
  const id = toRelationId(v)
  return id ? [id] : []
}

function richtextPreview(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  const content = (v as any).content
  if (!Array.isArray(content)) return ''
  for (const node of content) {
    const text = (Array.isArray((node as any).content) ? (node as any).content : [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => String(c.text ?? ''))
      .join('')
    if (text) return text
  }
  return ''
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function CellInput({
  field, value, onChange, error, disabled, workspaceId,
}: {
  field:       FieldDefinition
  value:       unknown
  onChange:    (v: unknown) => void
  error:       string | null
  disabled:    boolean
  workspaceId: string
}) {
  const [richtextOpen,  setRichtextOpen]  = useState(false)
  const [richtextDraft, setRichtextDraft] = useState<unknown>(value)

  const baseInput = clsx(
    'w-full text-sm rounded border bg-surface px-2 py-1.5 outline-none transition',
    error
      ? 'border-danger/40 ring-1 ring-danger/25 focus:ring-red-400'
      : 'border-border focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25',
    disabled && 'opacity-40 cursor-not-allowed bg-surface-sunken',
  )

  const { fieldType, config } = field

  if (fieldType === 'boolean') {
    return (
      <div className="flex items-center">
        <Switch.Root
          aria-label={field.label}
          checked={!!value}
          onCheckedChange={checked => onChange(checked)}
          disabled={disabled}
          className="relative flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-surface-hover transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus:ring-offset-2 data-[state=checked]:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Switch.Thumb className="pointer-events-none block h-5 w-5 translate-x-0 rounded-full bg-surface shadow ring-0 transition-transform data-[state=checked]:translate-x-5" />
        </Switch.Root>
      </div>
    )
  }

  if (fieldType === 'select') {
    return (
      <select
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value || null)}
        disabled={disabled}
        className={clsx(baseInput, 'pr-6')}
      >
        <option value="">-</option>
        {(config.options ?? []).map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  if (fieldType === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : []
    const options  = config.options ?? []
    return (
      <div className={clsx(
        'flex flex-wrap gap-1 min-h-[32px] rounded border px-2 py-1',
        error ? 'border-danger/40 ring-1 ring-danger/25' : 'border-border',
        disabled && 'opacity-40 bg-surface-sunken',
      )}>
        {options.map(o => {
          const on = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(on ? selected.filter(v => v !== o.value) : [...selected, o.value])}
              className={clsx(
                'px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors',
                on ? 'bg-accent-muted text-accent-fg border border-accent/30'
                   : 'bg-surface-hover text-fg-muted border border-border hover:bg-surface-hover',
                disabled && 'cursor-not-allowed',
              )}
            >
              {o.label}
            </button>
          )
        })}
        {!options.length && <span className="text-xs text-fg-faint self-center">No options</span>}
      </div>
    )
  }

  if (fieldType === 'date') {
    return (
      <input
        type={config.includeTime ? 'datetime-local' : 'date'}
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value || null)}
        disabled={disabled}
        className={baseInput}
      />
    )
  }

  if (fieldType === 'number') {
    return (
      <input
        type="number"
        value={value == null ? '' : String(value)}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
        className={baseInput}
      />
    )
  }

  if (fieldType === 'relation' && !config.many) {
    return (
      <div className={clsx(disabled && 'pointer-events-none opacity-40')}>
        <RelationPicker
          workspaceId={workspaceId}
          targetType={config.targetType ?? ''}
          value={toRelationId(value)}
          onChange={id => onChange(id)}
        />
      </div>
    )
  }

  if (fieldType === 'relation' && config.many) {
    return (
      <div className={clsx(disabled && 'pointer-events-none opacity-40')}>
        <MultiRelationPicker
          workspaceId={workspaceId}
          targetType={config.targetType ?? ''}
          value={toRelationIds(value)}
          onChange={ids => onChange(ids)}
        />
      </div>
    )
  }

  if (fieldType === 'richtext') {
    const preview = richtextPreview(value)
    return (
      <>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setRichtextDraft(value); setRichtextOpen(true) }}
          className={clsx(
            'w-full min-h-[36px] text-left text-sm rounded border px-2 py-1.5 transition-colors flex items-center gap-2',
            error ? 'border-danger/40 bg-danger-muted' : 'border-border hover:border-accent/30 bg-surface',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          {preview
            ? <span className="line-clamp-1 flex-1 text-fg">{preview}</span>
            : <span className="flex-1 text-fg-subtle italic">Click to edit…</span>}
          <IconPencil className="size-3 text-fg-subtle shrink-0" />
        </button>
        <Dialog open={richtextOpen} onOpenChange={setRichtextOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit - {field.label}</DialogTitle>
            </DialogHeader>
            <div className="min-h-[240px] border border-border rounded-lg overflow-hidden">
              <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading editor…</div>}>
                <RichTextEditor
                  key={richtextOpen ? 'open' : 'closed'}
                  value={richtextDraft ?? null}
                  onChange={v => setRichtextDraft(v)}
                  workspaceId={workspaceId}
                  toolbar="basic"
                  media={config.media ?? false}
                />
              </Suspense>
            </div>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => setRichtextOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => { onChange(richtextDraft); setRichtextOpen(false) }}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  if (fieldType === 'textarea') {
    return (
      <textarea
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
        className={clsx(baseInput, 'resize-none leading-tight')}
      />
    )
  }

  const inputType = fieldType === 'email' ? 'email'
    : fieldType === 'url'   ? 'url'
    : fieldType === 'phone' ? 'tel'
    : 'text'

  return (
    <input
      type={inputType}
      value={String(value ?? '')}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={baseInput}
    />
  )
}

// Muted striped placeholder — condition not met for this row
function GatedCell({ reason }: { reason: string }) {
  return (
    <div
      title={reason}
      className="w-full h-8 rounded cursor-not-allowed border border-dashed border-border bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_4px,#e5e7eb_4px,#e5e7eb_8px)]"
    />
  )
}

// ── Columns picker ────────────────────────────────────────────────────────────

function ColumnsPicker({
  fields, visibleKeys, onChange,
}: {
  fields:      FieldDefinition[]
  visibleKeys: Set<string>
  onChange:    (keys: Set<string>) => void
}) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const ref                   = useRef<HTMLDivElement>(null)
  const searchRef             = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    if (open) {
      document.addEventListener('mousedown', onOutside)
      // Focus the search input when the picker opens
      requestAnimationFrame(() => searchRef.current?.focus())
    }
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  function toggle(name: string) {
    const next = new Set(visibleKeys)
    if (next.has(name)) { next.delete(name) } else { next.add(name) }
    onChange(next)
  }

  const filtered = search.trim()
    ? fields.filter(f => f.label.toLowerCase().includes(search.toLowerCase()))
    : fields

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
        Columns
        <svg className="ml-1.5 size-3 opacity-60" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 8L2 4h8L6 8z" />
        </svg>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-border bg-surface shadow-xl z-40 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search fields…"
                className="w-full pl-8 pr-3 h-7 text-sm border border-border rounded-md outline-none focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25 bg-surface"
              />
            </div>
          </div>
          {/* Field list */}
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-fg-subtle text-center py-3">No fields match</p>
            ) : (
              filtered.map(f => (
                <label
                  key={f.name}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-surface-sunken"
                >
                  {/* form-checkbox required for @tailwindcss/forms strategy:"class" */}
                  <input
                    type="checkbox"
                    checked={visibleKeys.has(f.name)}
                    onChange={() => toggle(f.name)}
                    className="form-checkbox size-3.5 rounded border-border-strong text-accent-fg focus-visible:ring-focus/25 cursor-pointer"
                  />
                  <span className="text-sm text-fg">{f.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BulkEditPage() {
  const params         = useParams() as { workspaceId: string; typeName: string }
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const { accessToken } = useAuthStore()

  // IDs come from ?ids=id1,id2,… so the URL is shareable and survives reload
  const ids = useMemo(() => {
    const raw = searchParams.get('ids') ?? ''
    return raw ? raw.split(',').filter(Boolean) : []
  }, [searchParams])

  const [typeDef, setTypeDef] = useState<TypeDef | null>(null)
  const [rows, setRows]       = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  const [changes, setChanges] = useState<Record<string, Record<string, unknown>>>({})
  const [errors, setErrors]   = useState<Record<string, Record<string, string>>>({})
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [saving, setSaving]   = useState(false)

  const eligibleFields = useMemo(
    () => getEligibleBulkFields(typeDef?.fields ?? []),
    [typeDef],
  )

  const hasDirty = useMemo(() =>
    Object.values(changes).some(r => Object.keys(r).length > 0), [changes])
  const hasErrors = useMemo(() =>
    Object.values(errors).some(r => Object.keys(r).length > 0), [errors])

  // ── Unsaved-changes guard ──────────────────────────────────────────────────

  // Block in-app navigation when there are dirty changes
  const blocker = useBlocker(hasDirty && !saving)

  // Block browser refresh / tab close
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasDirty])

  // ── Column visibility ──────────────────────────────────────────────────────

  const lsKey = `tangen-bulk-edit-cols-${params.typeName}`
  const [visibleKeys, setVisibleKeys]         = useState<Set<string>>(new Set())
  const [colsInitialised, setColsInitialised] = useState(false)

  useEffect(() => {
    if (colsInitialised || eligibleFields.length === 0) return
    const stored = localStorage.getItem(lsKey)
    if (stored) {
      try {
        const parsed = new Set(JSON.parse(stored) as string[])
        setVisibleKeys(new Set(eligibleFields.map(f => f.name).filter(n => parsed.has(n))))
      } catch { /* ignore */ }
    } else {
      setVisibleKeys(new Set(eligibleFields.map(f => f.name)))
    }
    setColsInitialised(true)
  }, [eligibleFields, colsInitialised, lsKey])

  function handleVisibilityChange(keys: Set<string>) {
    setVisibleKeys(keys)
    localStorage.setItem(lsKey, JSON.stringify([...keys]))
  }

  const visibleFields = useMemo(
    () => eligibleFields.filter(f => visibleKeys.has(f.name)),
    [eligibleFields, visibleKeys],
  )

  // ── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken || ids.length === 0) { setLoading(false); return }
    Promise.all([
      adminFetch<{ data: TypeDef }>(`/types/${params.typeName}`),
      adminFetch<{ data: Record<string, unknown>[] }>(
        `/objects/${params.typeName}/query`,
        { method: 'POST', body: JSON.stringify({
          limit:  ids.length,
          offset: 0,
          depth:  1,
          query:  { id: { in: ids } },
        }) },
      ),
    ])
      .then(([typeRes, objRes]) => {
        setTypeDef(typeRes.data)
        setRows(objRes.data.map(r => normalizeObjectData(r) as Record<string, unknown>))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [accessToken, params.typeName, ids])

  // ── Cell editing ───────────────────────────────────────────────────────────

  const handleCellChange = useCallback((rowId: string, fieldName: string, value: unknown) => {
    const field = eligibleFields.find(f => f.name === fieldName)
    if (!field) return

    setChanges(prev => ({ ...prev, [rowId]: { ...prev[rowId], [fieldName]: value } }))

    const err = validateBulkCell(field, value)
    setErrors(prev => {
      const rowErrors = { ...prev[rowId] }
      if (err) { rowErrors[fieldName] = err } else { delete rowErrors[fieldName] }
      return { ...prev, [rowId]: rowErrors }
    })

    setResults(prev => {
      if (!prev[rowId]) return prev
      const next = { ...prev }; delete next[rowId]; return next
    })
  }, [eligibleFields])

  // ── Save: PATCH each row individually (rows have different values) ──────────

  async function handleSave() {
    if (hasErrors || !hasDirty) return
    setSaving(true)
    setResults({})

    const dirtyEntries = Object.entries(changes).filter(([, v]) => Object.keys(v).length > 0)
    const newResults: Record<string, RowResult> = {}

    await Promise.allSettled(
      dirtyEntries.map(async ([id, fields]) => {
        try {
          await adminFetch(
            `/objects/${params.typeName}/${id}`,
            { method: 'PATCH', body: JSON.stringify(fields) },
          )
          newResults[id] = { kind: 'success' }
        } catch (err) {
          newResults[id] = {
            kind:    'error',
            message: err instanceof Error ? err.message : 'Failed to save',
          }
        }
      }),
    )

    setResults(newResults)

    const savedById: Record<string, Record<string, unknown>> = {}
    for (const [id, fields] of dirtyEntries) {
      if (newResults[id]?.kind === 'success') savedById[id] = fields
    }

    setChanges(prev => {
      const next = { ...prev }
      for (const id of Object.keys(savedById)) delete next[id]
      return next
    })

    // Merge saved values back into base rows so cells don't revert to stale fetched data
    if (Object.keys(savedById).length > 0) {
      setRows(prev => prev.map(row => {
        const saved = savedById[row.id as string]
        return saved ? { ...row, ...saved } : row
      }))
    }

    setSaving(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const label  = typeDef?.admin?.menu?.label ?? typeDef?.label ?? params.typeName
  const rowMap = new Map(rows.map(r => [r.id as string, r]))
  const failCount = Object.values(results).filter(r => r.kind === 'error').length

  if (!loading && ids.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-fg-muted">
        <p className="text-sm">No items selected. Add <code>?ids=id1,id2,…</code> to the URL.</p>
        <button onClick={() => navigate(-1)} className="text-xs text-accent-fg hover:underline">← Go back</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Unsaved-changes confirmation dialog ──────────────────────── */}
      {blocker.state === 'blocked' && (
        <Dialog open onOpenChange={() => blocker.reset()}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Unsaved changes</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-fg-muted">
              You have unsaved changes. If you leave now, they'll be lost.
            </p>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => blocker.reset()}>
                Stay and keep editing
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => blocker.proceed()}
                className="bg-danger hover:bg-danger-fg focus:ring-red-500"
              >
                Leave without saving
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg transition-colors"
        >
          <IconChevronLeft className="size-4" />
          Back
        </button>
        <div className="h-4 w-px bg-surface-hover" />
        <h1 className="text-sm font-semibold text-fg">
          {loading ? 'Loading…' : `Editing ${ids.length} ${label}${ids.length !== 1 ? 's' : ''}`}
        </h1>
        {hasDirty && !saving && (
          <span className="text-[11px] text-warning-fg font-medium">• Unsaved changes</span>
        )}
        <div className="flex-1" />
        {!loading && eligibleFields.length > 0 && (
          <ColumnsPicker
            fields={eligibleFields}
            visibleKeys={visibleKeys}
            onChange={handleVisibilityChange}
          />
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={saving || !hasDirty || hasErrors}
          onClick={handleSave}
        >
          {saving
            ? <span className="inline-flex items-center gap-1.5">
                <IconLoader className="size-3.5 animate-spin" />Saving…
              </span>
            : 'Save'}
        </Button>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="p-6 animate-pulse space-y-3">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-10 bg-surface-hover rounded-lg" />)}
          </div>
        ) : eligibleFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-fg-subtle gap-2">
            <p className="text-sm">No editable fields found for <strong>{label}</strong>.</p>
            <p className="text-xs">Add flat fields (text, number, select, relation…) to the schema.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken sticky top-0 z-10">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide whitespace-nowrap sticky left-0 bg-surface-sunken border-r border-border min-w-[200px]">
                    Title
                  </th>
                  {visibleFields.map(f => (
                    <th
                      key={f.name}
                      className="px-3 py-2.5 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide whitespace-nowrap min-w-[180px]"
                    >
                      {f.label}
                      {f.required && <span className="ml-0.5 text-danger">*</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 w-10 shrink-0" />
                </tr>
              </thead>
              <tbody>
                {ids.map(id => {
                  const baseRow    = rowMap.get(id) ?? {}
                  const rowChanges = changes[id] ?? {}
                  const rowErrors  = errors[id]  ?? {}
                  const rowResult  = results[id]
                  const hasRowErr  = Object.keys(rowErrors).length > 0

                  return (
                    <tr
                      key={id}
                      className={clsx(
                        'border-b border-border transition-colors',
                        hasRowErr                    && 'border-l-2 border-l-red-400',
                        rowResult?.kind === 'success' && 'bg-success-muted',
                        rowResult?.kind === 'error'   && 'bg-danger-muted',
                      )}
                    >
                      {/* Title - sticky, editable */}
                      <td className="px-3 py-2 sticky left-0 bg-surface border-r border-border whitespace-nowrap">
                        <input
                          type="text"
                          value={String(('title' in rowChanges ? rowChanges.title : baseRow.title) ?? '')}
                          onChange={e => {
                            const v = e.target.value
                            setChanges(prev => ({ ...prev, [id]: { ...prev[id], title: v } }))
                            setResults(prev => {
                              if (!prev[id]) return prev
                              const next = { ...prev }; delete next[id]; return next
                            })
                          }}
                          disabled={saving}
                          className="w-full text-sm font-medium text-fg bg-transparent border-0 border-b border-transparent focus-visible:border-focus-border focus:outline-none focus:ring-0 px-0 py-0.5 transition-colors disabled:opacity-40"
                          placeholder="Untitled"
                        />
                      </td>

                      {visibleFields.map(f => {
                        const condMet    = evalFieldCondition(f, baseRow, rowChanges)
                        const currentVal = f.name in rowChanges ? rowChanges[f.name] : baseRow[f.name]
                        const cellError  = rowErrors[f.name] ?? null

                        if (!condMet) {
                          const cv     = f.config.admin?.conditionalVisibility
                          const reason = cv ? `Requires "${cv.field}" = "${cv.value}"` : 'Condition not met'
                          return (
                            <td key={f.name} className="px-2 py-1.5">
                              <GatedCell reason={reason} />
                            </td>
                          )
                        }

                        return (
                          <td key={f.name} className="px-2 py-1.5 align-top">
                            <CellInput
                              field={f}
                              value={currentVal}
                              onChange={v => handleCellChange(id, f.name, v)}
                              error={cellError}
                              disabled={saving}
                              workspaceId={params.workspaceId}
                            />
                            {cellError && (
                              <p className="text-[10px] text-danger-fg mt-0.5 leading-tight">{cellError}</p>
                            )}
                          </td>
                        )
                      })}

                      <td className="px-2 py-1.5 text-center align-middle">
                        {rowResult?.kind === 'success' && (
                          <IconCheck className="size-4 text-success mx-auto" />
                        )}
                        {rowResult?.kind === 'error' && (
                          <span title={rowResult.message}>
                            <IconX className="size-4 text-danger-fg mx-auto" />
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Footer: error summary ────────────────────────────────────────── */}
      {(hasErrors || failCount > 0) && (
        <div className="shrink-0 border-t border-red-100 bg-danger-muted px-6 py-2.5 flex items-center gap-3">
          <IconX className="size-4 text-danger-fg shrink-0" />
          <p className="text-xs text-danger-fg">
            {hasErrors
              ? 'Fix the highlighted errors before saving.'
              : `${failCount} row${failCount !== 1 ? 's' : ''} failed to save - fix errors and try again.`}
          </p>
        </div>
      )}
    </div>
  )
}
