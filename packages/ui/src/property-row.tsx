/**
 * File Name: property-row.tsx
 * Purpose: PropertyRow (UI V2 spec §17): the compact presentation of a
 *          metadata field - an icon, a label in `fg-muted`, and the value or
 *          its control on the same 32px line, the whole row lighting on hover.
 *          It is a presentation of the same field the editor already renders,
 *          never a second widget: the `control` slot takes the field's own
 *          control, and `value` with `onEdit` renders a read state whose edit
 *          affordance reveals on hover or keyboard focus.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Layout only; no data access. `placeholder` follows the
 *          reference's verb form ("Set owner") in `fg-subtle`.
 */
import React from 'react'
import { cx } from './utils'

export interface PropertyRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode
  icon?: React.ReactNode
  /** A control rendered in place (a Switch, a Select, a compact input). */
  control?: React.ReactNode
  /** A read-only value; with `onEdit`, the row is a button that opens the editor. */
  value?: React.ReactNode
  /** Shown in `fg-subtle` when `value` is empty ("Set owner"). */
  placeholder?: string
  onEdit?: () => void
  /** Vertical rows stack the control under the label (long values, textareas). */
  layout?: 'inline' | 'stacked'
  required?: boolean
  /** Rendered under the row in `fg-subtle`. */
  help?: React.ReactNode
  /** Rendered under the row in the danger text; the row takes the invalid state. */
  error?: React.ReactNode
  /** Extra content on the label line (presence, an AI fill button). */
  labelExtras?: React.ReactNode
  htmlFor?: string
}

export function PropertyRow({
  label, icon, control, value, placeholder, onEdit, layout = 'inline', required, help, error, labelExtras, htmlFor, className, ...props
}: PropertyRowProps) {
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  const labelNode = (
    <label htmlFor={htmlFor} className="flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
      {icon && <span className="flex shrink-0 items-center text-fg-subtle [&_svg]:size-4">{icon}</span>}
      <span className="truncate">{label}</span>
      {required && <span className="text-danger" aria-hidden>*</span>}
      {labelExtras}
    </label>
  )

  if (layout === 'stacked') {
    return (
      <div className={cx('group/prop py-1.5', className)} {...props}>
        <div className="mb-1.5">{labelNode}</div>
        {control}
        {error ? <p className="mt-1 text-ui-xs text-danger-fg">{error}</p> : help ? <p className="mt-1 text-ui-xs text-fg-subtle">{help}</p> : null}
      </div>
    )
  }

  return (
    <div className={cx('group/prop', className)} {...props}>
      <div
        className={cx(
          'flex min-h-8 items-center gap-3 rounded-control px-2 -mx-2 transition-colors motion-fast',
          onEdit && 'hover:bg-surface-hover',
          error && 'ring-1 ring-inset ring-danger/40',
        )}
      >
        <div className="w-[120px] shrink-0">{labelNode}</div>
        <div className="min-w-0 flex-1">
          {control ?? (
            onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className={cx(
                  'flex h-7 w-full min-w-0 items-center rounded-control text-left text-ui-sm transition-colors motion-fast',
                  'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                  empty ? 'text-fg-subtle' : 'text-fg',
                )}
              >
                <span className="truncate">{empty ? placeholder ?? 'Set' : value}</span>
              </button>
            ) : (
              <span className={cx('block truncate text-ui-sm', empty ? 'text-fg-subtle' : 'text-fg')}>{empty ? placeholder ?? '-' : value}</span>
            )
          )}
        </div>
      </div>
      {error ? <p className="mt-0.5 text-ui-xs text-danger-fg">{error}</p> : help ? <p className="mt-0.5 text-ui-xs text-fg-subtle">{help}</p> : null}
    </div>
  )
}
