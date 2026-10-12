/**
 * File Name: inspector-row.tsx
 * Purpose: The inspector's row shell - label left, control right - and the
 *          compact controls that fit it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The admin's FieldControl is a CRUD row: label above,
 *          full width, h-9, text-sm. In a 320px inspector that is about half
 *          the density every comparable builder runs at. These rows are 28px
 *          with 11px labels.
 *
 *          Controls that genuinely need the width (richtext, media, relation)
 *          keep the stacked layout and their existing control - see
 *          `rowLayout`. Squeezing them into 180px would be a regression
 *          wearing a redesign.
 */
import { clsx } from 'clsx'
import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import type { SubField } from '@tangen/types'
import { FieldControl } from '@/kit'
import type { RowLayout, ControlKind } from '../lib/control-kind'
import { segmentIcons } from '../lib/segment-icon'
import { scrubValue, stepValue } from '../lib/scrub'
import * as ICONS from '@tangen/icons'
import { IconArrowUp, IconArrowDown, IconArrowLeftRight } from '@tangen/icons'

/** Shared by every compact control so they line up exactly. */
export const CONTROL_CLS =
  'h-(--tg-control-h) w-full min-w-0 rounded-md border border-border bg-surface px-2 text-fg ' +
  'text-(length:--tg-text-control) ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent'

interface InspectorRowProps {
  label: string
  required?: boolean
  layout: RowLayout
  /**
   * Present = this prop cannot be edited right now, and this says why. The
   * control is dimmed and made inert rather than hidden: knowing a setting
   * exists but belongs elsewhere is more use than it vanishing.
   */
  lockedReason?: string
  /** Rendered under the row, full width, in both layouts. */
  below?: ReactNode
  children: ReactNode
}

export function InspectorRow({ label, required, layout, below, lockedReason, children }: InspectorRowProps) {
  const body = lockedReason ? (
    <div
      aria-disabled
      title={lockedReason}
      className="opacity-45 pointer-events-none select-none"
    >
      {children}
    </div>
  ) : children
  const text = (
    <span className="text-(length:--tg-text-label) font-medium text-fg-muted truncate" title={label}>
      {label}
      {required && <span className="text-danger ml-0.5">*</span>}
    </span>
  )

  if (layout === 'stacked') {
    return (
      <div className="space-y-1">
        <label className="block">{text}</label>
        {body}
        {below}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 min-h-(--tg-row-h)">
        <label className="w-[38%] shrink-0 flex items-center">{text}</label>
        <div className="flex-1 min-w-0">{body}</div>
      </div>
      {below}
    </div>
  )
}

interface CompactTextProps {
  value: unknown
  placeholder?: string
  onChange: (v: string) => void
}

export function CompactText({ value, placeholder, onChange }: CompactTextProps) {
  return (
    <input
      value={typeof value === 'string' ? value : ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={CONTROL_CLS}
    />
  )
}

export interface CompactOption { label: string; value: string }

interface CompactSelectProps {
  value: unknown
  options: CompactOption[]
  onChange: (v: string) => void
}

export function CompactSelect({ value, options, onChange }: CompactSelectProps) {
  return (
    <select
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(CONTROL_CLS, 'appearance-none cursor-pointer pr-6')}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8a9e' stroke-width='2.5'><path d='M6 9l6 6 6-6'/></svg>\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
        backgroundSize: '12px',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/** A field's declared options, normalised to label/value strings. */
function fieldOptions(field: SubField): CompactOption[] {
  const raw = (field.config as { options?: unknown } | undefined)?.options
  if (!Array.isArray(raw)) return []
  return raw.flatMap((o) => {
    if (!o || typeof o !== 'object') return []
    const opt = o as { label?: unknown; value?: unknown }
    return [{ label: String(opt.label ?? opt.value ?? ''), value: String(opt.value ?? '') }]
  })
}

interface CompactControlProps {
  field: SubField
  kind: ControlKind
  value: unknown
  onChange: (v: unknown) => void
  workspaceId: string
  typeName?: string
}

/**
 * Routes one field to its compact control. Kinds Arc V has not built yet
 * (switch, stepper, segmented, toggles) deliberately fall through to the
 * admin's real control rather than to a placeholder: a half-built control
 * that silently drops a value is worse than a tall one that works.
 *
 * Declared at module scope on purpose. A component defined inside a render
 * is a new type on every pass, so React remounts it and the input under the
 * cursor loses focus mid-word.
 */
export function CompactControl({ field, kind, value, onChange, workspaceId, typeName }: CompactControlProps) {
  if (kind === 'text') {
    return <CompactText value={value} placeholder={field.admin?.placeholder} onChange={onChange} />
  }
  if (kind === 'select') {
    return <CompactSelect value={value} options={fieldOptions(field)} onChange={onChange} />
  }
  if (kind === 'switch') return <Switch value={value} onChange={onChange} />
  if (kind === 'stepper') {
    const cfg = (field.config ?? {}) as { min?: number; max?: number; step?: number }
    return <Stepper value={value} step={cfg.step} min={cfg.min} max={cfg.max} onChange={onChange} />
  }
  if (kind === 'segmented') {
    return <Segmented prop={field.name} options={fieldOptions(field)} value={value} onChange={onChange} />
  }
  if (kind === 'toggles') {
    return <Toggles prop={field.name} options={fieldOptions(field)} value={value} onChange={onChange} />
  }
  return (
    <FieldControl
      field={{ ...field, config: field.config ?? {} } as never}
      value={value}
      onChange={onChange}
      workspaceId={workspaceId}
      typeName={typeName}
    />
  )
}

// ── Segmented ───────────────────────────────────────────────────────────────

interface SegmentedProps {
  /** The prop name - decides whether the options earn icons. */
  prop: string
  options: CompactOption[]
  value: unknown
  onChange: (v: string) => void
}

/**
 * One visible button per option. Replaces a native <select>, which is the
 * loudest "this is a web form" signal an inspector can carry.
 */
export function Segmented({ prop, options, value, onChange }: SegmentedProps) {
  const icons = segmentIcons(prop, options)
  const current = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  return (
    <div role="radiogroup" className="flex h-(--tg-control-h) w-full rounded-md border border-border bg-surface-sunken p-0.5 gap-0.5">
      {options.map((o, i) => {
        const on = o.value === current
        const Icon = icons ? ICONS[icons[i]] : null
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex-1 min-w-0 grid place-items-center rounded text-[11px] font-medium truncate px-1',
              'transition-colors duration-(--tg-motion-fast)',
              on ? 'bg-surface text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : o.label}
          </button>
        )
      })}
    </div>
  )
}

interface TogglesProps {
  prop: string
  options: CompactOption[]
  /** Many may be on at once. */
  value: unknown
  onChange: (v: string[]) => void
}

/** Segmented, but any number of options may be on - a short multiselect. */
export function Toggles({ prop, options, value, onChange }: TogglesProps) {
  const icons = segmentIcons(prop, options)
  const on = new Set(Array.isArray(value) ? value.map(String) : [])
  return (
    <div className="flex h-(--tg-control-h) w-full rounded-md border border-border bg-surface-sunken p-0.5 gap-0.5">
      {options.map((o, i) => {
        const active = on.has(o.value)
        const Icon = icons ? ICONS[icons[i]] : null
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => {
              const next = new Set(on)
              if (active) next.delete(o.value); else next.add(o.value)
              // Emitted in the options' own order, so the stored value never
              // depends on the order the user happened to click.
              onChange(options.map((x) => x.value).filter((v) => next.has(v)))
            }}
            className={clsx(
              'flex-1 min-w-0 grid place-items-center rounded text-[11px] font-medium truncate px-1',
              'transition-colors duration-(--tg-motion-fast)',
              active ? 'bg-accent text-white' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : o.label}
          </button>
        )
      })}
    </div>
  )
}

interface SwitchProps {
  value: unknown
  onChange: (v: boolean) => void
}

export function Switch({ value, onChange }: SwitchProps) {
  const on = value === true
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx(
        'relative h-4 w-7 rounded-full transition-colors duration-(--tg-motion-fast)',
        on ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-transform duration-(--tg-motion-fast)',
          on ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

// ── Stepper ─────────────────────────────────────────────────────────────────

interface StepperProps {
  value: unknown
  step?: number
  min?: number
  max?: number
  onChange: (v: number | null) => void
}

/**
 * A number you can type, nudge, or drag. The drag lives on the whole control
 * via a pointer capture, so it works anywhere on the row rather than needing
 * a hairline target.
 */
export function Stepper({ value, step = 1, min, max, onChange }: StepperProps) {
  const current = typeof value === 'number' && Number.isFinite(value) ? value : null
  const drag = useRef<{ id: number; x: number; from: number | null } | null>(null)
  const [scrubbing, setScrubbing] = useState(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only the grip starts a drag; the input itself must stay selectable.
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    drag.current = { id: e.pointerId, x: e.clientX, from: current }
    setScrubbing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    onChange(scrubValue({ start: d.from, dx: e.clientX - d.x, step, min, max }))
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    setScrubbing(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  return (
    <div
      className={clsx('flex items-center h-(--tg-control-h) rounded-md border bg-surface', scrubbing ? 'border-accent' : 'border-border')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span
        className="grid place-items-center h-full px-1.5 cursor-ew-resize text-fg-subtle hover:text-fg-muted select-none"
        title="Drag to change"
      >
        <IconArrowLeftRight className="size-3" />
      </span>
      <input
        value={current === null ? '' : String(current)}
        inputMode="decimal"
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') return onChange(null)
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          onChange(stepValue(current, e.key === 'ArrowUp' ? 1 : -1, { step, min, max }))
        }}
        className="flex-1 min-w-0 h-full bg-transparent px-1 text-xs text-fg focus:outline-none"
      />
      <div className="flex flex-col justify-center h-full pr-0.5">
        <button
          type="button" tabIndex={-1} title="Increase"
          onClick={() => onChange(stepValue(current, 1, { step, min, max }))}
          className="grid place-items-center h-3 w-4 text-fg-subtle hover:text-fg rounded-sm hover:bg-surface-hover"
        >
          <IconArrowUp className="size-2.5" />
        </button>
        <button
          type="button" tabIndex={-1} title="Decrease"
          onClick={() => onChange(stepValue(current, -1, { step, min, max }))}
          className="grid place-items-center h-3 w-4 text-fg-subtle hover:text-fg rounded-sm hover:bg-surface-hover"
        >
          <IconArrowDown className="size-2.5" />
        </button>
      </div>
    </div>
  )
}
