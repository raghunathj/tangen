

import { useState, useEffect, useRef, useCallback } from 'react'
import { DatePicker } from '@/components/ui/date-picker'
import { createPortal } from 'react-dom'
import {
  IconPlus, IconX, IconSearch, IconCheck,
  IconCalendar, IconListChecks, IconArrowLeft, IconGlobe, IconHash, IconChevronRight, IconDropdownList, IconFilter } from '@tangen/icons'
import { clsx } from 'clsx'
import { adminFetch } from '@/lib/api'
import type { FieldFilter, FilterableField, DateFilters } from './types'

// ── Shared portal popover helper ──────────────────────────────────────────────

/** True when a mousedown landed inside a DatePicker's body-portaled calendar
 *  - it lives outside every popover's DOM, so without this check picking a
 *  date closed the filter popover (and the calendar rendered behind it). */
function inDatePickerPortal(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('[data-datepicker-pop]')
}

function usePopoverPos(width = 240) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Left-aligned to the trigger, unless that would run past the window (a
  // trigger at the right of the view bar): then right-aligned to it.
  function measure() {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const left = r.left + width + 8 > window.innerWidth ? Math.max(8, r.right - width) : r.left
    setPos({ top: r.bottom + 6, left })
  }

  return { triggerRef, popoverRef, pos, measure, clearPos: () => setPos(null) }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'draft',     label: 'Draft',     dot: 'bg-fg-faint' },
  { value: 'published', label: 'Published', dot: 'bg-success' },
  { value: 'archived',  label: 'Archived',  dot: 'bg-fg-faint' },
  { value: 'scheduled', label: 'Scheduled', dot: 'bg-accent' },
]

const NUMBER_OPERATORS = [
  { value: 'eq',      label: 'Equals' },
  { value: 'ne',      label: 'Does not equal' },
  { value: 'gt',      label: 'Greater than' },
  { value: 'gte',     label: 'Greater than or equal to' },
  { value: 'lt',      label: 'Less than' },
  { value: 'lte',     label: 'Less than or equal to' },
  { value: 'between', label: 'Between' },
]

const NEGATABLE_TYPES = new Set(['text', 'textarea', 'slug', 'select', 'multiselect', 'relation'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function negateOp(op: string): string {
  const M: Record<string, string> = {
    in: 'nin', nin: 'in', eq: 'ne', ne: 'eq',
    contains: 'ncontains', ncontains: 'contains',
  }
  return M[op] ?? op
}

function isNegated(op: string): boolean {
  return ['nin', 'ne', 'ncontains'].includes(op)
}

/** "Aug 2" - plus the time when one was chosen, hiding the trivial
 *  day-boundary defaults (00:00 on from, 23:59 on to) so day-only filters
 *  keep their clean labels. */
function fmtShort(d: string, trivialTime?: string): string {
  const day = new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.includes('T') ? d.split('T')[1].slice(0, 5) : ''
  return time && time !== trivialTime ? `${day} ${time}` : day
}

function tokenLabel(f: FieldFilter): string {
  const neg = isNegated(f.operator)

  if (f.fieldName === 'status') {
    const val = Array.isArray(f.value) ? f.value : [f.value]
    const verb = neg ? 'is none of' : 'is any of'
    return `Status ${verb} ${val.map(v => String(v).charAt(0).toUpperCase() + String(v).slice(1)).join(', ')}`
  }
  if (f.fieldType === 'text' || f.fieldType === 'textarea' || f.fieldType === 'slug') {
    return `${f.fieldLabel} ${neg ? "doesn't contain" : 'contains'} "${f.value}"`
  }
  if (f.fieldType === 'number') {
    if (f.operator === 'between') {
      const { from, to } = f.value as { from?: number; to?: number }
      if (from != null && to != null) return `${f.fieldLabel} between ${from} – ${to}`
      if (from != null) return `${f.fieldLabel} ≥ ${from}`
      if (to != null)   return `${f.fieldLabel} ≤ ${to}`
      return f.fieldLabel
    }
    const ops: Record<string, string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' }
    return `${f.fieldLabel} ${ops[f.operator] ?? f.operator} ${f.value}`
  }
  if (f.fieldType === 'boolean') return `${f.fieldLabel} is ${f.value ? 'Yes' : 'No'}`
  if (f.fieldType === 'select') {
    const val = Array.isArray(f.value) ? f.value as string[] : [f.value as string]
    const labels = val.map(v => f.options?.find(o => o.value === v)?.label ?? String(v))
    return `${f.fieldLabel} ${neg ? 'is none of' : 'is any of'} ${labels.join(', ')}`
  }
  if (f.fieldType === 'multiselect') {
    const val = Array.isArray(f.value) ? f.value as string[] : [f.value as string]
    const labels = val.map(v => f.options?.find(o => o.value === v)?.label ?? String(v))
    return `${f.fieldLabel} ${neg ? 'contains none of' : 'contains any of'} ${labels.join(', ')}`
  }
  if (f.fieldType === 'relation') {
    const labels = f.valueLabels ?? (Array.isArray(f.value) ? f.value as string[] : [String(f.value)])
    return `${f.fieldLabel} ${neg ? 'is none of' : 'is any of'} ${labels.slice(0, 2).join(', ')}${labels.length > 2 ? ` +${labels.length - 2}` : ''}`
  }
  if (f.fieldType === 'date' || f.operator === 'range') {
    const { from, to } = f.value as { from?: string; to?: string }
    if (from && to) return `${f.fieldLabel}: ${fmtShort(from, '00:00')} – ${fmtShort(to, '23:59')}`
    if (from) return `${f.fieldLabel} after ${fmtShort(from, '00:00')}`
    if (to) return `${f.fieldLabel} before ${fmtShort(to, '23:59')}`
  }
  return f.fieldLabel
}

function dateTokenLabel(type: 'published' | 'created', df: DateFilters): string {
  const label = type === 'published' ? 'Published' : 'Created'
  const from = type === 'published' ? df.publishedAtFrom : df.createdAtFrom
  const to   = type === 'published' ? df.publishedAtTo   : df.createdAtTo
  if (from && to) return `${label}: ${fmtShort(from, '00:00')} – ${fmtShort(to, '23:59')}`
  if (from) return `${label} after ${fmtShort(from, '00:00')}`
  if (to) return `${label} before ${fmtShort(to, '23:59')}`
  return label
}

// ── Operator footer row (Shopify-style, always at bottom of popover) ─────────

function IsNotRow({ fieldType, negated, onFlip }: { fieldType: string; negated: boolean; onFlip: () => void }) {
  let pos: string, neg: string
  if (fieldType === 'multiselect') {
    pos = 'Contains any of'; neg = 'Contains none of'
  } else if (fieldType === 'text' || fieldType === 'textarea' || fieldType === 'slug') {
    pos = 'Contains'; neg = 'Does not contain'
  } else {
    pos = 'Is any of'; neg = 'Is none of'
  }
  return (
    <div className="border-t border-border">
      {[
        { label: pos, active: !negated, activate: negated },
        { label: neg, active: negated,  activate: !negated },
      ].map(({ label, active, activate }) => (
        <button
          key={label}
          onClick={() => { if (activate) onFlip() }}
          className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-fg hover:bg-surface-sunken transition-colors"
        >
          <span className="size-3.5 shrink-0 flex items-center justify-center">
            {active && <IconCheck className="size-3.5 text-accent-fg" />}
          </span>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Relation search picker ────────────────────────────────────────────────────

function RelationPicker({
  targetType, selectedIds, selectedLabels, onChange,
}: {
  targetType: string
  selectedIds: string[]; selectedLabels: string[]
  onChange: (ids: string[], labels: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<{ id: string; title: string }[]>([])

  const doSearch = useCallback(async (q: string) => {
    try {
      const body: Record<string, unknown> = { limit: 20, offset: 0, status: 'any' }
      if (q.trim()) body.query = { title: { contains: q.trim() } }
      const res = await adminFetch<{ data: { id: string; title: string }[] }>(
        `/objects/${targetType}/query`, { method: 'POST', body: JSON.stringify(body) },
      )
      setResults(res.data.map(r => ({ id: r.id, title: r.title ?? r.id })))
    } catch { setResults([]) }
  }, [targetType])

  useEffect(() => { doSearch('') }, [doSearch])
  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 250)
    return () => clearTimeout(t)
  }, [search, doSearch])

  const selectedSet = new Set(selectedIds)
  const unselected = results.filter(r => !selectedSet.has(r.id))
  const selected = selectedIds.map((id, i) => ({ id, title: selectedLabels[i] ?? id }))

  function toggle(item: { id: string; title: string }) {
    if (selectedSet.has(item.id)) {
      const idx = selectedIds.indexOf(item.id)
      onChange(selectedIds.filter((_, i) => i !== idx), selectedLabels.filter((_, i) => i !== idx))
    } else {
      onChange([...selectedIds, item.id], [...selectedLabels, item.title])
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-subtle pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${targetType}…`}
          className="w-full pl-6 pr-2 py-1.5 text-xs border border-border rounded-md outline-none focus-visible:border-focus-border" />
      </div>
      <div className="max-h-40 overflow-y-auto space-y-0.5">
        {[...selected, ...unselected].map(item => {
          const checked = selectedSet.has(item.id)
          return (
            <label key={item.id} className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-surface-sunken cursor-pointer select-none">
              <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                {checked && <IconCheck className="size-2.5 text-white" />}
              </span>
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(item)} />
              <span className="text-xs text-fg truncate">{item.title || item.id}</span>
            </label>
          )
        })}
        {selected.length === 0 && unselected.length === 0 && (
          <p className="text-xs text-fg-subtle py-2 text-center">No results</p>
        )}
      </div>
    </div>
  )
}

// ── Per-token popover content ─────────────────────────────────────────────────

function TokenPopoverContent({
  filter, fieldDef, onChange, onClose,
}: {
  filter: FieldFilter
  fieldDef?: FilterableField
  onChange: (f: FieldFilter | null) => void  // null = remove the filter
  onClose: () => void
}) {
  const neg = isNegated(filter.operator)
  const canNegate = filter.fieldName === 'status' || (fieldDef && NEGATABLE_TYPES.has(fieldDef.fieldType ?? ''))

  // Text local state (applied on Enter / Apply button)
  const [textVal, setTextVal] = useState(() =>
    ['text', 'textarea', 'slug'].includes(filter.fieldType) ? String(filter.value ?? '') : ''
  )

  // Number local state
  const [numOp, setNumOp]   = useState(filter.operator)
  const [numVal, setNumVal] = useState(() => filter.fieldType === 'number' && filter.operator !== 'between' ? String(filter.value ?? '') : '')
  const [betweenFrom, setBetweenFrom] = useState(() => {
    if (filter.fieldType === 'number' && filter.operator === 'between') {
      return String((filter.value as { from?: number })?.from ?? '')
    }
    return ''
  })
  const [betweenTo, setBetweenTo] = useState(() => {
    if (filter.fieldType === 'number' && filter.operator === 'between') {
      return String((filter.value as { to?: number })?.to ?? '')
    }
    return ''
  })

  // Date local state
  const [dateFrom, setDateFrom] = useState(() => filter.fieldType === 'date' ? (filter.value as any)?.from ?? '' : '')
  const [dateTo,   setDateTo]   = useState(() => filter.fieldType === 'date' ? (filter.value as any)?.to   ?? '' : '')

  function flipNeg() {
    onChange({ ...filter, operator: negateOp(filter.operator) })
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  if (filter.fieldName === 'status') {
    const values = Array.isArray(filter.value) ? filter.value as string[] : []
    function toggleStatus(v: string) {
      const next = values.includes(v) ? values.filter(x => x !== v) : [...values, v]
      if (next.length === 0) { onChange(null); return }
      onChange({ ...filter, value: next })
    }
    return (
      <div>
        <div className="py-1.5 px-1">
          {STATUS_OPTIONS.map(opt => {
            const checked = values.includes(opt.value)
            return (
              <label key={opt.value} className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-surface-sunken cursor-pointer select-none">
                <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                  {checked && <IconCheck className="size-2.5 text-white" />}
                </span>
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleStatus(opt.value)} />
                <span className={clsx('size-1.5 rounded-full shrink-0', opt.dot)} />
                <span className="text-xs text-fg">{opt.label}</span>
              </label>
            )
          })}
        </div>
        <IsNotRow fieldType="select" negated={neg} onFlip={flipNeg} />
      </div>
    )
  }

  const ft = fieldDef?.fieldType

  // ── Select / Multiselect ───────────────────────────────────────────────────
  if (ft === 'select' || ft === 'multiselect') {
    const values = Array.isArray(filter.value) ? filter.value as string[] : []
    const options = fieldDef?.options ?? []
    const [search, setSearch] = useState('')
    const filtered = search ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : options

    function toggleOpt(v: string) {
      const next = values.includes(v) ? values.filter(x => x !== v) : [...values, v]
      if (next.length === 0) { onChange(null); return }
      onChange({ ...filter, value: next, operator: neg ? 'nin' : 'in' })
    }

    return (
      <div>
        <div className="px-2 pt-2 pb-1.5 space-y-1.5">
          {options.length > 8 && (
            <div className="relative">
              <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-subtle pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="w-full pl-6 pr-2 py-1.5 text-xs border border-border rounded-md outline-none focus-visible:border-focus-border" />
            </div>
          )}
          <div className="max-h-44 overflow-y-auto space-y-0.5">
            {filtered.map(opt => {
              const checked = values.includes(opt.value)
              return (
                <label key={opt.value} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded hover:bg-surface-sunken cursor-pointer select-none">
                  <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                    {checked && <IconCheck className="size-2.5 text-white" />}
                  </span>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleOpt(opt.value)} />
                  <span className="text-xs text-fg truncate">{opt.label}</span>
                </label>
              )
            })}
            {filtered.length === 0 && <p className="text-xs text-fg-subtle py-2 text-center">No matches</p>}
          </div>
        </div>
        <IsNotRow fieldType={ft ?? 'select'} negated={neg} onFlip={flipNeg} />
      </div>
    )
  }

  // ── Relation ───────────────────────────────────────────────────────────────
  if (ft === 'relation' && fieldDef?.targetType) {
    const ids    = Array.isArray(filter.value) ? filter.value as string[] : []
    const labels = filter.valueLabels ?? []
    return (
      <div>
        <div className="p-2">
          <RelationPicker
            targetType={fieldDef.targetType}
            selectedIds={ids} selectedLabels={labels}
            onChange={(nextIds, nextLabels) => {
              if (nextIds.length === 0) { onChange(null); return }
              onChange({ ...filter, value: nextIds, valueLabels: nextLabels, operator: neg ? 'nin' : 'in' })
            }}
          />
        </div>
        <IsNotRow fieldType="relation" negated={neg} onFlip={flipNeg} />
      </div>
    )
  }

  // ── Text ───────────────────────────────────────────────────────────────────
  if (ft === 'text' || ft === 'textarea' || ft === 'slug') {
    function applyText() {
      if (!textVal.trim()) { onChange(null); return }
      onChange({ ...filter, value: textVal.trim(), operator: neg ? 'ncontains' : 'contains' })
      onClose()
    }
    return (
      <div>
        <div className="p-2 space-y-1.5">
          <input autoFocus value={textVal} onChange={e => setTextVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyText() }}
            placeholder={neg ? 'Does not contain…' : 'Contains…'}
            className="w-full text-xs border border-border rounded-md px-2.5 py-1.5 outline-none focus-visible:border-focus-border" />
          <button onClick={applyText}
            className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong transition-colors">
            Apply
          </button>
        </div>
        <IsNotRow fieldType={ft ?? 'text'} negated={neg} onFlip={() => {
          const newNeg = !neg
          onChange({ ...filter, value: textVal.trim() || filter.value, operator: newNeg ? 'ncontains' : 'contains' })
        }} />
      </div>
    )
  }

  // ── Number ─────────────────────────────────────────────────────────────────
  if (ft === 'number') {
    const isBetween = numOp === 'between'
    function applyNum() {
      if (isBetween) {
        if (!betweenFrom && !betweenTo) { onChange(null); return }
        const val: { from?: number; to?: number } = {}
        if (betweenFrom) val.from = Number(betweenFrom)
        if (betweenTo)   val.to   = Number(betweenTo)
        onChange({ ...filter, operator: 'between', value: val })
      } else {
        if (numVal === '') { onChange(null); return }
        onChange({ ...filter, value: Number(numVal), operator: numOp })
      }
      onClose()
    }
    return (
      <div>
        <div className="py-1.5">
          {NUMBER_OPERATORS.map(o => (
            <button key={o.value} onClick={() => setNumOp(o.value)}
              className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-fg hover:bg-surface-sunken transition-colors">
              <span className="size-3.5 shrink-0 flex items-center justify-center">
                {numOp === o.value && <IconCheck className="size-3.5 text-accent-fg" />}
              </span>
              {o.label}
            </button>
          ))}
        </div>
        <div className="border-t border-border p-2 space-y-1.5">
          {isBetween ? (
            <div className="flex gap-1.5 items-center">
              <input type="number" value={betweenFrom} onChange={e => setBetweenFrom(e.target.value)} placeholder="From"
                className="flex-1 min-w-0 text-xs border border-border rounded-md px-2 py-1.5 outline-none focus-visible:border-focus-border" />
              <span className="text-xs text-fg-subtle shrink-0">–</span>
              <input type="number" value={betweenTo} onChange={e => setBetweenTo(e.target.value)} placeholder="To"
                className="flex-1 min-w-0 text-xs border border-border rounded-md px-2 py-1.5 outline-none focus-visible:border-focus-border" />
            </div>
          ) : (
            <input type="number" autoFocus value={numVal} onChange={e => setNumVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyNum() }} placeholder="Value"
              className="w-full text-xs border border-border rounded-md px-2.5 py-1.5 outline-none focus-visible:border-focus-border" />
          )}
          <button onClick={applyNum}
            className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong transition-colors">
            Apply
          </button>
        </div>
      </div>
    )
  }

  // ── Boolean ────────────────────────────────────────────────────────────────
  if (ft === 'boolean') {
    return (
      <div className="py-1.5 px-1">
        {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map(opt => {
          const active = filter.value === opt.value
          return (
            <label key={String(opt.value)} className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-surface-sunken cursor-pointer select-none">
              <span className={clsx('size-3.5 rounded-full border-2 flex items-center justify-center', active ? 'border-accent' : 'border-border-strong')}>
                {active && <span className="size-2 rounded-full bg-accent-strong" />}
              </span>
              <input type="radio" className="sr-only" checked={active}
                onChange={() => onChange({ ...filter, value: opt.value, operator: 'eq' })} />
              <span className="text-xs text-fg">{opt.label}</span>
            </label>
          )
        })}
      </div>
    )
  }

  // ── Date ───────────────────────────────────────────────────────────────────
  if (ft === 'date') {
    function applyDate() {
      if (!dateFrom && !dateTo) { onChange(null); return }
      onChange({ ...filter, operator: 'range', value: { from: dateFrom || undefined, to: dateTo || undefined } })
      onClose()
    }
    return (
      <div className="p-2 space-y-1.5">
        <div>
          <label className="block text-xs text-fg-muted mb-0.5">From</label>
          <DatePicker size="sm" withTime value={dateFrom || undefined} onChange={(v) => setDateFrom(v ?? '')} placeholder="From date" />
        </div>
        <div>
          <label className="block text-xs text-fg-muted mb-0.5">To</label>
          <DatePicker size="sm" withTime defaultTime="23:59" value={dateTo || undefined} onChange={(v) => setDateTo(v ?? '')} placeholder="To date" />
        </div>
        <button onClick={applyDate}
          className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong transition-colors">
          Apply
        </button>
      </div>
    )
  }

  return null
}

// ── Filter Token (inline chip + popover) ──────────────────────────────────────

function FilterToken({
  filter, fieldDef, onChange, onRemove,
}: {
  filter: FieldFilter
  fieldDef?: FilterableField
  onChange: (f: FieldFilter) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const { triggerRef, popoverRef, pos, measure, clearPos } = usePopoverPos()

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (inDatePickerPortal(e.target)) return
      const t = e.target as Node
      if (
        !(triggerRef.current && triggerRef.current.contains(t)) &&
        !(popoverRef.current && popoverRef.current.contains(t))
      ) { setOpen(false); clearPos() }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function toggle() {
    if (open) { setOpen(false); clearPos() }
    else { measure(); setOpen(true) }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={toggle}
        className={clsx(
          'inline-flex items-center gap-1 pl-2 pr-1 h-7 text-ui-sm rounded-control whitespace-nowrap transition-colors',
          open ? 'bg-accent-muted text-accent-fg' : 'bg-accent-muted text-accent-fg hover:bg-accent-muted',
        )}
      >
        <span>{tokenLabel(filter)}</span>
        <span
          role="button"
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="rounded-full p-0.5 hover:bg-accent-muted transition-colors cursor-pointer"
        >
          <IconX className="size-3" />
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="w-56 rounded-lg bg-surface-raised shadow-popover z-(--tg-z-popover) overflow-hidden"
        >
          <TokenPopoverContent
            filter={filter} fieldDef={fieldDef}
            onChange={f => { if (f) onChange(f); else { onRemove(); setOpen(false); clearPos() } }}
            onClose={() => { setOpen(false); clearPos() }}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Date filter token ─────────────────────────────────────────────────────────

function DateFilterToken({
  type, dateFilters, onUpdate, onRemove,
}: {
  type: 'published' | 'created'
  dateFilters: DateFilters
  onUpdate: (type: 'published' | 'created', from?: string, to?: string) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const { triggerRef, popoverRef, pos, measure, clearPos } = usePopoverPos()
  const from = type === 'published' ? dateFilters.publishedAtFrom : dateFilters.createdAtFrom
  const to   = type === 'published' ? dateFilters.publishedAtTo   : dateFilters.createdAtTo
  const [df, setDf] = useState(from ?? '')
  const [dt, setDt] = useState(to ?? '')

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (inDatePickerPortal(e.target)) return
      const t = e.target as Node
      if (
        !(triggerRef.current && triggerRef.current.contains(t)) &&
        !(popoverRef.current && popoverRef.current.contains(t))
      ) { setOpen(false); clearPos() }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function toggle() {
    if (open) { setOpen(false); clearPos() }
    else { measure(); setOpen(true) }
  }

  function applyDate() {
    if (!df && !dt) { onRemove(); return }
    onUpdate(type, df || undefined, dt || undefined)
    setOpen(false); clearPos()
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={toggle}
        className={clsx(
          'inline-flex items-center gap-1 pl-2 pr-1 h-7 text-ui-sm rounded-control whitespace-nowrap transition-colors',
          open ? 'bg-accent-muted text-accent-fg' : 'bg-accent-muted text-accent-fg hover:bg-accent-muted',
        )}
      >
        {dateTokenLabel(type, dateFilters)}
        <span role="button" onClick={e => { e.stopPropagation(); onRemove() }}
          className="rounded-full p-0.5 hover:bg-accent-muted transition-colors cursor-pointer">
          <IconX className="size-3" />
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="w-52 rounded-lg bg-surface-raised shadow-popover z-(--tg-z-popover) p-2 space-y-1.5"
        >
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">From</label>
            <DatePicker size="sm" withTime value={df || undefined} onChange={(v) => setDf(v ?? '')} placeholder="From date" />
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">To</label>
            <DatePicker size="sm" withTime defaultTime="23:59" value={dt || undefined} onChange={(v) => setDt(v ?? '')} placeholder="To date" />
          </div>
          <button onClick={applyDate}
            className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong transition-colors">
            Apply
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Locales filter (multi-select of content languages) ───────────────────────

function LocalesEditor({
  localeOptions, defaultLocale, initial, onApply,
}: {
  localeOptions: { code: string; label: string }[]
  defaultLocale?: string
  initial: string[]
  onApply: (codes: string[]) => void
}) {
  const [vals, setVals] = useState<string[]>(initial)
  return (
    <div>
      <div className="py-1.5 px-1">
        {localeOptions.map(l => {
          const checked = vals.includes(l.code)
          return (
            <label key={l.code} className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-surface-sunken cursor-pointer select-none">
              <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                {checked && <IconCheck className="size-2.5 text-white" />}
              </span>
              <input type="checkbox" className="sr-only" checked={checked}
                onChange={() => setVals(p => p.includes(l.code) ? p.filter(x => x !== l.code) : [...p, l.code])} />
              <span className="text-xs text-fg">{l.label}</span>
              {l.code === defaultLocale && <span className="ml-auto text-[10px] text-fg-subtle">default</span>}
            </label>
          )
        })}
      </div>
      <div className="border-t border-border px-2 py-1.5">
        <button
          onClick={() => onApply(vals)}
          disabled={!vals.length && !initial.length}
          className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  )
}

function LocalesToken({
  localeOptions, defaultLocale, activeLocales, onLocalesChange,
}: {
  localeOptions: { code: string; label: string }[]
  defaultLocale?: string
  activeLocales: string[]
  onLocalesChange: (codes: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const { triggerRef, popoverRef, pos, measure, clearPos } = usePopoverPos()

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (inDatePickerPortal(e.target)) return
      const t = e.target as Node
      if (
        !(triggerRef.current && triggerRef.current.contains(t)) &&
        !(popoverRef.current && popoverRef.current.contains(t))
      ) { setOpen(false); clearPos() }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const labels = activeLocales
    .map(c => localeOptions.find(l => l.code === c)?.label ?? c)
  const summary = labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ')

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => { if (open) { setOpen(false); clearPos() } else { measure(); setOpen(true) } }}
        className={clsx(
          'inline-flex items-center gap-1 pl-2 pr-1 h-7 text-ui-sm rounded-control whitespace-nowrap transition-colors',
          open ? 'bg-accent-muted text-accent-fg' : 'bg-accent-muted text-accent-fg hover:bg-accent-muted',
        )}
      >
        <IconGlobe className="size-3" />
        Locales: {summary}
        <span role="button" onClick={e => { e.stopPropagation(); onLocalesChange([]) }}
          className="rounded-full p-0.5 hover:bg-accent-muted transition-colors cursor-pointer">
          <IconX className="size-3" />
        </span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="w-60 rounded-lg bg-surface-raised shadow-popover z-(--tg-z-popover) overflow-hidden"
        >
          <LocalesEditor
            localeOptions={localeOptions}
            defaultLocale={defaultLocale}
            initial={activeLocales}
            onApply={(codes) => { onLocalesChange(codes); setOpen(false); clearPos() }}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Labels filter (free-form operational tags) ───────────────────────────────

export type LabelFilterOp = 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends'
const LABEL_OP_LABELS: Record<LabelFilterOp, string> = {
  all: 'Has all', any: 'Has any', none: 'Has none',
  contains: 'Name contains', starts: 'Name starts with', ends: 'Name ends with',
}
const SUBSTRING_OPS: LabelFilterOp[] = ['contains', 'starts', 'ends']
const isSubOp = (op: LabelFilterOp) => SUBSTRING_OPS.includes(op)

interface LabelFilterProps {
  /**
   * Content type — presence turns on the Labels system filter (uses
   * /labels/suggest). A non-content entity names its kind as
   * `entity:<kind>` ('entity:submission'), the entityType the labels API takes.
   */
  labelType?: string
  /** Selected labels (set ops) or the single substring (substring ops). */
  activeLabels?: string[]
  /** Operator — defaults to 'all'. */
  activeLabelOp?: LabelFilterOp
  onLabelsChange?: (labels: string[], op: LabelFilterOp) => void
}

function LabelsEditor({ labelType, initial, initialOp, onApply }: {
  labelType: string; initial: string[]; initialOp: LabelFilterOp
  onApply: (labels: string[], op: LabelFilterOp) => void
}) {
  const [op, setOp] = useState<LabelFilterOp>(initialOp)
  const [vals, setVals] = useState<string[]>(isSubOp(initialOp) ? [] : initial)
  const [input, setInput] = useState(isSubOp(initialOp) ? (initial[0] ?? '') : '')
  const [sugs, setSugs] = useState<string[]>([])
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sub = isSubOp(op)

  function add(raw: string) {
    const v = raw.trim().replace(/\s+/g, ' ')
    if (v && !vals.includes(v)) setVals(p => [...p, v])
    setInput(''); setSugs([])
  }
  function onInput(v: string) {
    setInput(v)
    if (sub) return
    if (deb.current) clearTimeout(deb.current)
    if (!v.trim()) { setSugs([]); return }
    deb.current = setTimeout(() => {
      adminFetch<{ data: { labels: string[] } }>(`/labels/suggest?${labelType.startsWith('entity:') ? `entityType=${encodeURIComponent(labelType.slice('entity:'.length))}` : `type=${encodeURIComponent(labelType)}`}&q=${encodeURIComponent(v)}`)
        .then(r => setSugs((r.data?.labels ?? []).filter(s => !vals.includes(s)).slice(0, 8)))
        .catch(() => setSugs([]))
    }, 200)
  }
  function apply() {
    const pending = input.trim().replace(/\s+/g, ' ')
    if (sub) { onApply(pending ? [pending] : [], op); return }
    onApply(pending && !vals.includes(pending) ? [...vals, pending] : vals, op)
  }

  return (
    <div className="p-2 space-y-2">
      <select value={op} onChange={e => { setOp(e.currentTarget.value as LabelFilterOp); setInput(''); setSugs([]) }}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus:outline-none focus-visible:border-focus-border">
        {(Object.keys(LABEL_OP_LABELS) as LabelFilterOp[]).map(o => <option key={o} value={o}>{LABEL_OP_LABELS[o]}</option>)}
      </select>

      <input autoFocus value={input} onChange={e => onInput(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sub ? apply() : add(input) } }}
        placeholder={sub ? 'Label name…' : 'Search or add a label…'}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:border-focus-border" />

      {/* Set-op selection - checkmark list, matching the Status filter's style */}
      {!sub && (
        <div className="py-0.5 max-h-44 overflow-y-auto">
          {(() => { const t = input.trim().replace(/\s+/g, ' '); return t && !vals.includes(t) && !sugs.includes(t) })() && (
            <button type="button" onClick={() => add(input)} className="flex w-full items-center gap-2.5 px-2 py-1.5 rounded hover:bg-surface-sunken text-left select-none">
              <span className="size-3.5 shrink-0 rounded border border-dashed border-border-strong flex items-center justify-center"><IconPlus className="size-2.5 text-fg-subtle" /></span>
              <span className="text-xs text-fg">Add “<span className="font-medium">{input.trim().replace(/\s+/g, ' ')}</span>”</span>
            </button>
          )}
          {[...vals, ...sugs.filter(s => !vals.includes(s))].map(t => {
            const checked = vals.includes(t)
            return (
              <label key={t} onClick={() => setVals(checked ? vals.filter(x => x !== t) : [...vals, t])}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-surface-sunken cursor-pointer select-none">
                <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                  {checked && <IconCheck className="size-2.5 text-white" />}
                </span>
                <span className="text-xs text-fg">{t}</span>
              </label>
            )
          })}
          {!input.trim() && vals.length === 0 && sugs.length === 0 && (
            <p className="px-2 py-2 text-xs text-fg-subtle">Type to search or add labels.</p>
          )}
        </div>
      )}
      <div className="border-t border-border pt-1.5">
        <button onClick={apply}
          disabled={sub ? !input.trim() : (!input.trim() && !vals.length)}
          className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors">Apply</button>
      </div>
    </div>
  )
}

function LabelsToken({ labelType, activeLabels, activeLabelOp, onLabelsChange }: {
  labelType: string; activeLabels: string[]; activeLabelOp: LabelFilterOp
  onLabelsChange: (labels: string[], op: LabelFilterOp) => void
}) {
  const [open, setOpen] = useState(false)
  const { triggerRef, popoverRef, pos, measure, clearPos } = usePopoverPos()
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (inDatePickerPortal(e.target)) return
      const t = e.target as Node
      if (!(triggerRef.current && triggerRef.current.contains(t)) && !(popoverRef.current && popoverRef.current.contains(t))) { setOpen(false); clearPos() }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])
  const summary = activeLabels.length > 2 ? `${activeLabels.slice(0, 2).join(', ')} +${activeLabels.length - 2}` : activeLabels.join(', ')
  return (
    <div className="relative shrink-0">
      <button ref={triggerRef} onClick={() => { if (open) { setOpen(false); clearPos() } else { measure(); setOpen(true) } }}
        className={clsx('inline-flex items-center gap-1 pl-2 pr-1 h-7 text-ui-sm rounded-control whitespace-nowrap transition-colors', open ? 'bg-accent-muted text-accent-fg' : 'bg-accent-muted text-accent-fg hover:bg-accent-muted')}>
        <IconHash className="size-3" />
        {LABEL_OP_LABELS[activeLabelOp]}: {summary}
        <span role="button" onClick={e => { e.stopPropagation(); onLabelsChange([], 'all') }} className="rounded-full p-0.5 hover:bg-accent-muted transition-colors cursor-pointer"><IconX className="size-3" /></span>
      </button>
      {open && pos && createPortal(
        <div ref={popoverRef} style={{ position: 'fixed', top: pos.top, left: pos.left }} className="w-60 rounded-lg bg-surface-raised shadow-popover z-(--tg-z-popover) overflow-hidden">
          <LabelsEditor labelType={labelType} initial={activeLabels} initialOp={activeLabelOp} onApply={(v, o) => { onLabelsChange(v, o); setOpen(false); clearPos() }} />
        </div>, document.body)}
    </div>
  )
}

// ── Add Filter dropdown ───────────────────────────────────────────────────────

type AddField = FilterableField | 'status' | 'published_date' | 'created_date' | 'locales' | 'labels'

interface LocaleFilterProps {
  /** Enabled locales — presence turns on the Locales system filter. */
  localeOptions?: { code: string; label: string }[]
  defaultLocale?: string
  /** Currently selected locales (empty = default-language view). */
  activeLocales?: string[]
  onLocalesChange?: (codes: string[]) => void
}

type SystemFilterKind = 'status' | 'published_date' | 'created_date'
const ALL_SYSTEM_KINDS: SystemFilterKind[] = ['status', 'published_date', 'created_date']

function AddFilterDropdown({
  filterableFields, usedFieldNames, onAdd, systemFilters = true, systemFilterKinds = ALL_SYSTEM_KINDS,
  localeOptions, activeLocales, defaultLocale, onLocalesChange,
  labelType, activeLabels, activeLabelOp, onLabelsChange,
  variant = 'add',
}: {
  filterableFields: FilterableField[]
  usedFieldNames: Set<string>
  onAdd: (f: FieldFilter) => void
  systemFilters?: boolean
  /** Which of the built-in filters to offer (a list without a status or a publish date names only 'created_date'). */
  systemFilterKinds?: SystemFilterKind[]
  variant?: 'add' | 'filter' | 'icon'
} & LocaleFilterProps & LabelFilterProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'pick' | 'edit'>('pick')
  const [picked, setPicked] = useState<AddField | null>(null)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  // Every hook before the early returns below: a dropdown with nothing left to
  // offer renders nothing, and its close effect must still find this.
  const { triggerRef: addTriggerRef, popoverRef: addPopoverRef, pos: addPos, measure: addMeasure, clearPos: addClearPos } = usePopoverPos()

  useEffect(() => {
    if (!open) { setStep('pick'); setPicked(null); setSearch(''); addClearPos(); return }
    function handle(e: MouseEvent) {
      if (inDatePickerPortal(e.target)) return
      const t = e.target as Node
      if (
        !(ref.current && ref.current.contains(t)) &&
        !(addPopoverRef.current && addPopoverRef.current.contains(t))
      ) { setOpen(false); addClearPos() }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const sysOptions = (systemFilters ? [
    systemFilterKinds.includes('status') && !usedFieldNames.has('status')                 && { id: 'status' as const,         label: 'Status',        icon: 'status' },
    systemFilterKinds.includes('published_date') && !usedFieldNames.has('published_date') && { id: 'published_date' as const, label: 'Published date', icon: 'date' },
    systemFilterKinds.includes('created_date') && !usedFieldNames.has('created_date')     && { id: 'created_date' as const,   label: 'Created date',   icon: 'date' },
    Boolean(onLocalesChange && localeOptions && localeOptions.length > 1 && !(activeLocales && activeLocales.length > 0)) &&
      { id: 'locales' as const, label: 'Locales', icon: 'globe' },
    Boolean(labelType && onLabelsChange && !(activeLabels && activeLabels.length > 0)) &&
      { id: 'labels' as const, label: 'Labels', icon: 'hash' },
  ] : []).filter(Boolean) as { id: AddField; label: string; icon: string }[]

  const q = search.toLowerCase()
  const filteredSys    = sysOptions.filter(s => !q || s.label.toLowerCase().includes(q))
  const filteredFields = filterableFields.filter(f => !usedFieldNames.has(f.name) && (!q || f.label.toLowerCase().includes(q)))
  const total = sysOptions.length + filterableFields.filter(f => !usedFieldNames.has(f.name)).length

  function selectField(field: AddField) {
    setPicked(field)
    setStep('edit')
  }

  function handleAdd(f: FieldFilter) {
    onAdd(f)
    setOpen(false)
  }

  // ── Step 2: value editor for a new filter ──────────────────────────────────
  function NewFilterEditor() {
    const field = picked!
    const isStatus = field === 'status'
    const isDateSys = field === 'published_date' || field === 'created_date'
    const isLocales = field === 'locales'
    const isLabels = field === 'labels'
    const fieldDef = !isStatus && !isDateSys && !isLocales && !isLabels ? field as FilterableField : undefined
    const ft = fieldDef?.fieldType

    // Locales — pick one or more languages to view; empty = default language
    if (isLocales) {
      return (
        <LocalesEditor
          localeOptions={localeOptions ?? []}
          defaultLocale={defaultLocale}
          initial={activeLocales ?? []}
          onApply={(codes) => { onLocalesChange?.(codes); setOpen(false) }}
        />
      )
    }

    // Labels — free-form operational tags, with a set/substring operator
    if (isLabels) {
      return (
        <LabelsEditor
          labelType={labelType!}
          initial={activeLabels ?? []}
          initialOp={activeLabelOp ?? 'all'}
          onApply={(v, o) => { onLabelsChange?.(v, o); setOpen(false) }}
        />
      )
    }

    // Status
    if (isStatus) {
      const [vals, setVals] = useState<string[]>([])
      const [neg, setNeg]   = useState(false)
      return (
        <div>
          <div className="py-1.5 px-1">
            {STATUS_OPTIONS.map(opt => {
              const checked = vals.includes(opt.value)
              return (
                <label key={opt.value} className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-surface-sunken cursor-pointer select-none">
                  <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                    {checked && <IconCheck className="size-2.5 text-white" />}
                  </span>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => setVals(p => p.includes(opt.value) ? p.filter(x => x !== opt.value) : [...p, opt.value])} />
                  <span className={clsx('size-1.5 rounded-full shrink-0', opt.dot)} />
                  <span className="text-xs text-fg">{opt.label}</span>
                </label>
              )
            })}
          </div>
          <div className="border-t border-border px-2 py-1.5">
            <button
              onClick={() => {
                if (!vals.length) return
                handleAdd({ fieldName: 'status', fieldLabel: 'Status', fieldType: 'select', operator: neg ? 'nin' : 'in', value: vals })
              }}
              disabled={!vals.length}
              className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors"
            >
              Apply
            </button>
          </div>
          <IsNotRow fieldType="select" negated={neg} onFlip={() => setNeg(n => !n)} />
        </div>
      )
    }

    // Date system filters
    if (isDateSys) {
      const [df, setDf] = useState('')
      const [dt, setDt] = useState('')
      const isPublished = field === 'published_date'
      return (
        <div className="p-2 space-y-1.5">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">From</label>
            <DatePicker size="sm" withTime value={df || undefined} onChange={(v) => setDf(v ?? '')} placeholder="From date" />
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">To</label>
            <DatePicker size="sm" withTime defaultTime="23:59" value={dt || undefined} onChange={(v) => setDt(v ?? '')} placeholder="To date" />
          </div>
          <button onClick={() => {
            if (!df && !dt) return
            handleAdd({
              fieldName: isPublished ? 'published_at' : 'created_at',
              fieldLabel: isPublished ? 'Published date' : 'Created date',
              fieldType: 'date', operator: 'range',
              value: { from: df || undefined, to: dt || undefined },
            })
          }}
            className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong transition-colors">
            Apply
          </button>
        </div>
      )
    }

    // Select / Multiselect
    if (ft === 'select' || ft === 'multiselect') {
      const [vals, setVals] = useState<string[]>([])
      const [neg, setNeg]   = useState(false)
      const opts = fieldDef?.options ?? []
      const [srch, setSrch] = useState('')
      const filtered = srch ? opts.filter(o => o.label.toLowerCase().includes(srch.toLowerCase())) : opts
      return (
        <div>
          <div className="px-2 pt-2 pb-1.5 space-y-1.5">
            {opts.length > 8 && (
              <div className="relative">
                <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-subtle pointer-events-none" />
                <input value={srch} onChange={e => setSrch(e.target.value)} placeholder="Search…"
                  className="w-full pl-6 pr-2 py-1.5 text-xs border border-border rounded-md outline-none focus-visible:border-focus-border" />
              </div>
            )}
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {filtered.map(opt => {
                const checked = vals.includes(opt.value)
                return (
                  <label key={opt.value} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded hover:bg-surface-sunken cursor-pointer select-none">
                    <span className={clsx('size-3.5 shrink-0 rounded flex items-center justify-center', checked ? 'bg-accent-strong' : 'border border-border-strong bg-surface')}>
                      {checked && <IconCheck className="size-2.5 text-white" />}
                    </span>
                    <input type="checkbox" className="sr-only" checked={checked}
                      onChange={() => setVals(p => p.includes(opt.value) ? p.filter(x => x !== opt.value) : [...p, opt.value])} />
                    <span className="text-xs text-fg truncate">{opt.label}</span>
                  </label>
                )
              })}
            </div>
            <button onClick={() => {
              if (!vals.length) return
              handleAdd({ fieldName: fieldDef!.name, fieldLabel: fieldDef!.label, fieldType: ft, operator: neg ? 'nin' : 'in', value: vals, options: fieldDef?.options })
            }}
              disabled={!vals.length}
              className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors">
              Apply
            </button>
          </div>
          <IsNotRow fieldType={ft} negated={neg} onFlip={() => setNeg(n => !n)} />
        </div>
      )
    }

    // Relation
    if (ft === 'relation' && fieldDef?.targetType) {
      const [ids, setIds]       = useState<string[]>([])
      const [labels, setLabels] = useState<string[]>([])
      const [neg, setNeg]       = useState(false)
      return (
        <div>
          <div className="p-2">
            <RelationPicker
              targetType={fieldDef.targetType}
              selectedIds={ids} selectedLabels={labels}
              onChange={(ni, nl) => { setIds(ni); setLabels(nl) }}
            />
            <button onClick={() => {
              if (!ids.length) return
              handleAdd({ fieldName: fieldDef.name, fieldLabel: fieldDef.label, fieldType: ft, operator: neg ? 'nin' : 'in', value: ids, valueLabels: labels, targetType: fieldDef.targetType })
            }}
              disabled={!ids.length}
              className="mt-2 w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors">
              Apply
            </button>
          </div>
          <IsNotRow fieldType="relation" negated={neg} onFlip={() => setNeg(n => !n)} />
        </div>
      )
    }

    // Text
    if (ft === 'text' || ft === 'textarea' || ft === 'slug') {
      const [val, setVal] = useState('')
      const [neg, setNeg] = useState(false)
      function applyText() {
        if (!val.trim()) return
        handleAdd({ fieldName: fieldDef!.name, fieldLabel: fieldDef!.label, fieldType: ft!, operator: neg ? 'ncontains' : 'contains', value: val.trim() })
      }
      return (
        <div>
          <div className="p-2 space-y-1.5">
            <input autoFocus value={val} onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyText() }}
              placeholder={neg ? 'Does not contain…' : 'Contains…'}
              className="w-full text-xs border border-border rounded-md px-2.5 py-1.5 outline-none focus-visible:border-focus-border" />
            <button onClick={applyText} disabled={!val.trim()}
              className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors">
              Apply
            </button>
          </div>
          <IsNotRow fieldType={ft ?? 'text'} negated={neg} onFlip={() => setNeg(n => !n)} />
        </div>
      )
    }

    // Number
    if (ft === 'number') {
      const [op, setOp]       = useState('eq')
      const [val, setVal]     = useState('')
      const [bFrom, setBFrom] = useState('')
      const [bTo, setBTo]     = useState('')
      const isBtw = op === 'between'
      function doAdd() {
        if (isBtw) {
          if (!bFrom && !bTo) return
          const v: { from?: number; to?: number } = {}
          if (bFrom) v.from = Number(bFrom)
          if (bTo)   v.to   = Number(bTo)
          handleAdd({ fieldName: fieldDef!.name, fieldLabel: fieldDef!.label, fieldType: ft!, operator: 'between', value: v })
        } else {
          if (!val) return
          handleAdd({ fieldName: fieldDef!.name, fieldLabel: fieldDef!.label, fieldType: ft!, operator: op, value: Number(val) })
        }
      }
      return (
        <div>
          <div className="py-1.5">
            {NUMBER_OPERATORS.map(o => (
              <button key={o.value} onClick={() => setOp(o.value)}
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-fg hover:bg-surface-sunken transition-colors">
                <span className="size-3.5 shrink-0 flex items-center justify-center">
                  {op === o.value && <IconCheck className="size-3.5 text-accent-fg" />}
                </span>
                {o.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border p-2 space-y-1.5">
            {isBtw ? (
              <div className="flex gap-1.5 items-center">
                <input type="number" value={bFrom} onChange={e => setBFrom(e.target.value)} placeholder="From"
                  className="flex-1 min-w-0 text-xs border border-border rounded-md px-2 py-1.5 outline-none focus-visible:border-focus-border" />
                <span className="text-xs text-fg-subtle shrink-0">–</span>
                <input type="number" value={bTo} onChange={e => setBTo(e.target.value)} placeholder="To"
                  className="flex-1 min-w-0 text-xs border border-border rounded-md px-2 py-1.5 outline-none focus-visible:border-focus-border" />
              </div>
            ) : (
              <input type="number" autoFocus value={val} onChange={e => setVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doAdd() }} placeholder="Value"
                className="w-full text-xs border border-border rounded-md px-2.5 py-1.5 outline-none focus-visible:border-focus-border" />
            )}
            <button onClick={doAdd} disabled={isBtw ? !bFrom && !bTo : !val}
              className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong disabled:opacity-40 transition-colors">
              Apply
            </button>
          </div>
        </div>
      )
    }

    // Boolean
    if (ft === 'boolean') {
      return (
        <div className="py-1.5 px-1">
          {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map(opt => (
            <label key={String(opt.value)} className="flex items-center gap-2.5 px-2 py-2 rounded hover:bg-surface-sunken cursor-pointer select-none">
              <span className="size-3.5 shrink-0 rounded-full border border-border-strong bg-surface" />
              <input type="radio" className="sr-only"
                onChange={() => handleAdd({ fieldName: fieldDef!.name, fieldLabel: fieldDef!.label, fieldType: ft, operator: 'eq', value: opt.value })} />
              <span className="text-xs text-fg">{opt.label}</span>
            </label>
          ))}
        </div>
      )
    }

    // Date field
    if (ft === 'date') {
      const [df, setDf] = useState('')
      const [dt, setDt] = useState('')
      return (
        <div className="p-2 space-y-1.5">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">From</label>
            <DatePicker size="sm" withTime value={df || undefined} onChange={(v) => setDf(v ?? '')} placeholder="From date" />
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">To</label>
            <DatePicker size="sm" withTime defaultTime="23:59" value={dt || undefined} onChange={(v) => setDt(v ?? '')} placeholder="To date" />
          </div>
          <button onClick={() => {
            if (!df && !dt) return
            handleAdd({ fieldName: fieldDef!.name, fieldLabel: fieldDef!.label, fieldType: ft, operator: 'range', value: { from: df || undefined, to: dt || undefined } })
          }}
            className="w-full text-xs font-medium text-white bg-accent-strong rounded-md py-1.5 hover:bg-accent-strong transition-colors">
            Apply
          </button>
        </div>
      )
    }

    return null
  }

  if (total === 0 && usedFieldNames.size > 0 && !sysOptions.length && !filteredFields.length) return null

  function toggleAdd() {
    if (open) { setOpen(false); addClearPos() }
    else { addMeasure(); setOpen(true) }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Ghost text either way (the grid benchmark's view bar): "Filter" in the
          view bar, "+ Add filter" after the chips. */}
      <button
        ref={addTriggerRef}
        onClick={toggleAdd}
        aria-expanded={open}
        aria-label={variant === 'icon' ? 'Filter' : undefined}
        title={variant === 'icon' ? 'Filter' : undefined}
        className={clsx(
          // `icon` (the compact list, 2026-09-08): the benchmark's bordered 32px square beside the search.
          variant === 'icon'
            ? 'inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-border bg-surface-raised text-fg-muted transition-colors motion-fast hover:bg-surface-hover hover:text-fg'
            : 'inline-flex h-7 items-center gap-1 rounded-control px-2 text-ui whitespace-nowrap transition-colors motion-fast',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          variant !== 'icon' && (open ? 'bg-surface-selected text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'),
          variant === 'icon' && open && 'border-border-strong bg-surface-selected text-fg',
        )}
      >
        {variant === 'add' && <IconPlus className="size-4" aria-hidden />}
        {variant === 'icon' ? <IconFilter className="size-4" aria-hidden /> : variant === 'add' ? 'Add filter' : 'Filter'}
      </button>

      {open && addPos && createPortal(
        <div
          ref={addPopoverRef}
          style={{ position: 'fixed', top: addPos.top, left: addPos.left }}
          className="w-60 rounded-lg bg-surface-raised shadow-popover z-(--tg-z-popover) overflow-hidden"
        >
          {step === 'pick' ? (
            <div>
              {/* Search */}
              {total > 6 && (
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-fg-subtle pointer-events-none" />
                    <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Find field…"
                      className="w-full pl-6 pr-2 py-1 text-xs border border-border rounded-md outline-none focus-visible:border-focus-border" />
                  </div>
                </div>
              )}
              <div className="py-1.5 max-h-64 overflow-y-auto">
                {filteredSys.length > 0 && (
                  <>
                    <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider">System</p>
                    {filteredSys.map(s => (
                      <button key={String(s.id)} onClick={() => selectField(s.id)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-fg hover:bg-surface-sunken transition-colors text-left">
                        {s.icon === 'status'
                          ? <IconListChecks className="size-3.5 text-fg-subtle shrink-0" />
                          : s.icon === 'globe'
                            ? <IconGlobe className="size-3.5 text-fg-subtle shrink-0" />
                            : s.icon === 'hash'
                              ? <IconHash className="size-3.5 text-fg-subtle shrink-0" />
                              : <IconCalendar className="size-3.5 text-fg-subtle shrink-0" />}
                        {s.label}
                        <IconChevronRight className="ml-auto size-3.5 shrink-0 text-fg-faint" aria-hidden />
                      </button>
                    ))}
                  </>
                )}
                {filteredFields.length > 0 && (
                  <>
                    {filteredSys.length > 0 && <div className="border-t border-border my-1" />}
                    <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider">Fields</p>
                    {filteredFields.map(f => (
                      <button key={f.name} onClick={() => selectField(f)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-fg hover:bg-surface-sunken transition-colors text-left">
                        {f.fieldType === 'date'
                          ? <IconCalendar className="size-3.5 text-fg-subtle shrink-0" />
                          : f.fieldType === 'select' || f.fieldType === 'multiselect'
                            ? <IconDropdownList className="size-3.5 text-fg-subtle shrink-0" />
                            : <span className="size-3.5 shrink-0 text-center text-fg-subtle text-[10px] leading-[14px]">
                                {f.fieldType === 'boolean' ? '⊙' : f.fieldType === 'number' ? '#' : f.fieldType === 'relation' ? '↗' : 'T'}
                              </span>}
                        {f.label}
                        <IconChevronRight className="ml-auto size-3.5 shrink-0 text-fg-faint" aria-hidden />
                      </button>
                    ))}
                  </>
                )}
                {!filteredSys.length && !filteredFields.length && (
                  <p className="px-3 py-4 text-xs text-fg-subtle text-center">No matching fields</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Back header */}
              <button onClick={() => setStep('pick')}
                className="flex items-center gap-1.5 w-full px-3 py-2.5 text-xs text-fg-muted hover:text-fg border-b border-border transition-colors">
                <IconArrowLeft className="size-3.5" />
                {picked === 'status' ? 'Status' : picked === 'published_date' ? 'Published date' : picked === 'created_date' ? 'Created date' : picked === 'locales' ? 'Locales' : picked === 'labels' ? 'Labels' : (picked as FilterableField)?.label}
              </button>
              <NewFilterEditor />
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── Main FilterBar ────────────────────────────────────────────────────────────

export interface FilterBarProps extends LocaleFilterProps, LabelFilterProps {
  activeFilters: FieldFilter[]
  dateFilters: DateFilters
  filterableFields: FilterableField[]
  onFiltersChange: (filters: FieldFilter[], dateFilters: DateFilters) => void
  /** When false, hides Status / Published date / Created date from the Add Filter dropdown */
  systemFilters?: boolean
  /** Which built-in filters to offer; default all three. */
  systemFilterKinds?: SystemFilterKind[]
  /**
   * `chips` (default): the active filters as chips, "+ Add filter" and Reset,
   * for the row under the view bar. `button`: only the "Filter" trigger, for
   * the view bar itself.
   */
  mode?: 'chips' | 'button' | 'icon'
}

export function FilterBar({
  activeFilters, dateFilters, filterableFields, onFiltersChange, systemFilters = true, systemFilterKinds,
  localeOptions, activeLocales, defaultLocale, onLocalesChange,
  labelType, activeLabels, activeLabelOp, onLabelsChange,
  mode = 'chips',
}: FilterBarProps) {
  const hasPublished = !!(dateFilters.publishedAtFrom || dateFilters.publishedAtTo)
  const hasCreated   = !!(dateFilters.createdAtFrom   || dateFilters.createdAtTo)
  const hasLocales = Boolean(activeLocales && activeLocales.length > 0)
  const hasLabels = Boolean(activeLabels && activeLabels.length > 0)
  const hasAny = activeFilters.length > 0 || hasPublished || hasCreated || hasLocales || hasLabels

  const usedFieldNames = new Set([
    ...activeFilters.map(f => f.fieldName === 'published_at' ? 'published_date' : f.fieldName === 'created_at' ? 'created_date' : f.fieldName),
    ...(hasPublished ? ['published_date'] : []),
    ...(hasCreated   ? ['created_date']   : []),
  ])

  function updateFilter(updated: FieldFilter) {
    // Handle date filters
    if (updated.fieldName === 'published_at') {
      const val = updated.value as { from?: string; to?: string }
      onFiltersChange(activeFilters, { ...dateFilters, publishedAtFrom: val.from, publishedAtTo: val.to })
      return
    }
    if (updated.fieldName === 'created_at') {
      const val = updated.value as { from?: string; to?: string }
      onFiltersChange(activeFilters, { ...dateFilters, createdAtFrom: val.from, createdAtTo: val.to })
      return
    }
    onFiltersChange(
      activeFilters.map(f => f.fieldName === updated.fieldName ? updated : f),
      dateFilters,
    )
  }

  function removeFilter(fieldName: string) {
    if (fieldName === 'published_at') {
      onFiltersChange(activeFilters, { ...dateFilters, publishedAtFrom: undefined, publishedAtTo: undefined })
      return
    }
    if (fieldName === 'created_at') {
      onFiltersChange(activeFilters, { ...dateFilters, createdAtFrom: undefined, createdAtTo: undefined })
      return
    }
    onFiltersChange(activeFilters.filter(f => f.fieldName !== fieldName), dateFilters)
  }

  function addFilter(f: FieldFilter) {
    if (f.fieldName === 'published_at') {
      const val = f.value as { from?: string; to?: string }
      onFiltersChange(activeFilters, { ...dateFilters, publishedAtFrom: val.from, publishedAtTo: val.to })
      return
    }
    if (f.fieldName === 'created_at') {
      const val = f.value as { from?: string; to?: string }
      onFiltersChange(activeFilters, { ...dateFilters, createdAtFrom: val.from, createdAtTo: val.to })
      return
    }
    // Replace if already exists (e.g. editing), otherwise append
    const exists = activeFilters.some(x => x.fieldName === f.fieldName)
    onFiltersChange(exists ? activeFilters.map(x => x.fieldName === f.fieldName ? f : x) : [...activeFilters, f], dateFilters)
  }

  function clearAll() {
    onFiltersChange([], {})
    if (hasLocales) onLocalesChange?.([])
    if (hasLabels) onLabelsChange?.([], 'all')
  }

  const addFilterProps = {
    filterableFields, usedFieldNames, onAdd: addFilter, systemFilters, systemFilterKinds,
    localeOptions, activeLocales, defaultLocale, onLocalesChange,
    labelType, activeLabels, activeLabelOp, onLabelsChange,
  }
  if (mode === 'button') return <AddFilterDropdown variant="filter" {...addFilterProps} />
  if (mode === 'icon') return <AddFilterDropdown variant="icon" {...addFilterProps} />

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {/* Active field filter tokens */}
      {activeFilters.map(f => (
        <FilterToken
          key={f.fieldName}
          filter={f}
          fieldDef={filterableFields.find(fd => fd.name === f.fieldName)}
          onChange={updateFilter}
          onRemove={() => removeFilter(f.fieldName)}
        />
      ))}

      {/* Date filter tokens */}
      {hasPublished && (
        <DateFilterToken type="published" dateFilters={dateFilters}
          onUpdate={(_, from, to) => onFiltersChange(activeFilters, { ...dateFilters, publishedAtFrom: from, publishedAtTo: to })}
          onRemove={() => onFiltersChange(activeFilters, { ...dateFilters, publishedAtFrom: undefined, publishedAtTo: undefined })} />
      )}
      {hasCreated && (
        <DateFilterToken type="created" dateFilters={dateFilters}
          onUpdate={(_, from, to) => onFiltersChange(activeFilters, { ...dateFilters, createdAtFrom: from, createdAtTo: to })}
          onRemove={() => onFiltersChange(activeFilters, { ...dateFilters, createdAtFrom: undefined, createdAtTo: undefined })} />
      )}

      {/* Locales token */}
      {hasLocales && onLocalesChange && (
        <LocalesToken
          localeOptions={localeOptions ?? []}
          defaultLocale={defaultLocale}
          activeLocales={activeLocales!}
          onLocalesChange={onLocalesChange}
        />
      )}

      {/* Labels token */}
      {hasLabels && labelType && onLabelsChange && (
        <LabelsToken
          labelType={labelType}
          activeLabels={activeLabels!}
          activeLabelOp={activeLabelOp ?? 'all'}
          onLabelsChange={onLabelsChange}
        />
      )}

      {/* Add filter */}
      <AddFilterDropdown variant="add" {...addFilterProps} />

      <div className="flex-1" />
      {/* Reset, at the right of the row (the grid benchmark) */}
      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex h-7 items-center rounded-control px-2 text-ui text-fg-muted whitespace-nowrap transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          Reset
        </button>
      )}
    </div>
  )
}
