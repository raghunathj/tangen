'use client'
/**
 * File Name: multi-select.tsx
 * Purpose: Pick SEVERAL options from one dropdown - the counterpart to
 *          Select, for places where a row of toggle buttons stops being
 *          scannable as the list grows (e.g. which roles may action a
 *          review stage).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Deliberately no Radix popover - @tangen/ui does not
 *          depend on one, and adding a package for a single control is not
 *          worth it. Closes on outside pointer-down, Escape, and blur out of
 *          the control. Values with no matching option still render (a role
 *          deleted from the workspace, say) so a selection is never silently
 *          hidden.
 */
import React from 'react'
import { IconExpandUpDown, IconCheck } from '@tangen/icons'
import { cx, focusInput } from './utils'

export interface MultiSelectOption {
  value: string
  label: string
}

export interface MultiSelectProps {
  options: MultiSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** Trigger text when nothing is picked. */
  placeholder?: string
  /** Label for a picked value with no matching option (default: the value). */
  unknownLabel?: (value: string) => string
  id?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

export function MultiSelect({
  options, value, onChange, placeholder = '- Select -', unknownLabel,
  id, className, disabled, 'aria-label': ariaLabel,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? unknownLabel?.(v) ?? v
  const summary = value.length === 0
    ? placeholder
    : value.length <= 2
      ? value.map(labelFor).join(', ')
      : `${labelFor(value[0])} and ${value.length - 1} more`

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex h-(--tg-control-h) w-full cursor-default select-none items-center justify-between gap-2 truncate rounded-control border px-2.5 text-ui shadow-raised outline-none transition-colors motion-fast',
          'border-border bg-surface-raised text-fg hover:border-border-strong',
          open && 'border-focus-border',
          'disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-hover disabled:text-fg-faint disabled:shadow-none',
          focusInput,
        )}
      >
        <span className={cx('flex-1 truncate text-left', value.length === 0 && 'text-fg-subtle')}>
          {summary}
        </span>
        <IconExpandUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-(--tg-z-popover) mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-surface-raised p-1 shadow-popover"
        >
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-ui-xs text-fg-subtle">Nothing to choose from.</p>
          )}
          {options.map((o) => {
            const on = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className={cx(
                  'flex h-7 w-full items-center gap-2 rounded-control px-2 text-left text-ui-sm transition-colors motion-fast',
                  on ? 'text-fg' : 'text-fg-muted',
                  'hover:bg-surface-sunken hover:text-fg',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                    on ? 'border-accent bg-accent text-accent-contrast' : 'border-border-strong bg-surface-raised',
                  )}
                >
                  {on && <IconCheck className="size-3" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
