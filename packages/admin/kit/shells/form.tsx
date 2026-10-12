/**
 * File Name: form.tsx
 * Purpose: Form layout pieces — FormSection (titled card of inputs),
 *          FormRow (label + control + help/error), FormFooter (sticky-ish
 *          action row) — so custom forms match the platform's editors.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Layout only (v1) — state/validation stay with the
 *          caller. Part of the stable @/kit surface.
 */
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Card } from '../primitives'

export interface FormSectionProps {
  title?: ReactNode
  description?: ReactNode
  className?: string
  children: ReactNode
}

/** A titled group of fields on a Card surface. */
export function FormSection({ title, description, className, children }: FormSectionProps) {
  return (
    <Card title={title} description={description} className={className}>
      <div className="space-y-4">{children}</div>
    </Card>
  )
}

export interface FormRowProps {
  label: string
  /** Field name — ties the label to the control via htmlFor. */
  htmlFor?: string
  required?: boolean
  /** Help text under the control. */
  help?: string
  /** Validation error — replaces help, red. */
  error?: string
  className?: string
  children: ReactNode
}

/** Label + control + help/error — the standard field row. */
export function FormRow({ label, htmlFor, required, help, error, className, children }: FormRowProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-ui-xs font-medium text-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error
        ? <p className="mt-1 text-ui-xs text-danger-fg">{error}</p>
        : help && <p className="mt-1 text-ui-xs text-fg-subtle">{help}</p>}
    </div>
  )
}

export interface FormFooterProps {
  /** Right-aligned by default (primary action last). */
  align?: 'left' | 'right' | 'between'
  className?: string
  children: ReactNode
}

/** The action row that closes a form. */
export function FormFooter({ align = 'right', className, children }: FormFooterProps) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2 pt-4 border-t border-border mt-6',
        align === 'right' && 'justify-end',
        align === 'between' && 'justify-between',
        className,
      )}
    >
      {children}
    </div>
  )
}
