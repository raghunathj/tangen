/**
 * File Name: fact-grid.tsx
 * Purpose: The benchmark's card body (decision of 2026-09-07): facts in two
 *          columns with a hairline between them, each row an icon, a muted
 *          label and its value - editable or not.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lives inside a `SettingsSection` with `flush`. A row
 *          is 44px tall at rest (the benchmark's ROW_HEIGHT) and grows when
 *          its value wraps or carries a help line.
 */
import React from 'react'
import { clsx } from 'clsx'

/** Two columns from `lg` up (below that the settings column is too narrow for two), one otherwise; the second column is optional. */
export function FactGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('grid grid-cols-1 gap-x-8 px-5 py-3 lg:grid-cols-[repeat(2,minmax(0,1fr))] lg:[&>*+*]:border-l lg:[&>*+*]:border-border-subtle lg:[&>*+*]:pl-8', className)}>
      {children}
    </div>
  )
}

export function FactRow({ icon, label, help, children, className }: {
  icon?: React.ReactNode
  label: React.ReactNode
  /** A line under the value, muted. */
  help?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    // Label and value share one baseline: centred when the value is a line
    // (text, an input), top-aligned only when a help line follows the value.
    <div className={clsx('flex min-h-11 gap-3 py-1.5', help ? 'items-start' : 'items-center', className)}>
      <div className={clsx('flex w-36 shrink-0 items-center gap-2.5 text-sm text-fg-subtle', help && 'pt-1.5')}>
        {icon && <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4" aria-hidden>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className={clsx('min-w-0 flex-1 text-sm text-fg', help && 'pt-1')}>
        {children}
        {help && <p className="mt-1 text-xs text-fg-subtle">{help}</p>}
      </div>
    </div>
  )
}
