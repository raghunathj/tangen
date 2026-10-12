/**
 * File Name: panel.tsx
 * Purpose: The settings shape the benchmark uses and Tangen did not have: the
 *          section's NAME sits above the card, not inside it, and the card
 *          below holds only the content - rows divided by hairlines, or a form.
 *          A heading inside a card competes with the fields it introduces; a
 *          heading above it reads as a heading. Two tones, because a page
 *          needs both: `raised` (white on the page's ground) and `sunken` (a
 *          quieter grey), each resolving through the theme's tokens so dark
 *          mode is the same component rather than a second design.
 *
 *          One chrome, shared with a framed DataList so a card and a table
 *          can sit side by side on the same page: an 8px radius, a hairline,
 *          and the raised tone's barely-there shadow. A heavy shadow and a
 *          wide radius read as a widget, not as a page.
 *
 * Author: Raghunath J
 * License: MIT
 */
import * as React from 'react'
import { cx } from './utils'

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  /** The section's name, in Title Case. */
  title: React.ReactNode
  /** One line on what the section governs. */
  description?: React.ReactNode
  /** An action for the section as a whole, at the end of the heading row. */
  action?: React.ReactNode
}

/** A named region of a page: the heading, then whatever it introduces. */
export function Section({ title, description, action, className, children, ...props }: SectionProps) {
  return (
    <section className={cx('space-y-3', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title-sm text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-ui-sm text-fg-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `raised` (default): a white card on the page's ground. `sunken`: a
   * quieter grey one, for a panel that should recede - a nested group, or a
   * card on an already-white page.
   */
  tone?: 'raised' | 'sunken'
  /** Rows divided by hairlines, each `PanelRow` supplying its own padding. */
  rows?: boolean
  /** No padding: the content owns its own edges (a table, a list). */
  flush?: boolean
}

const TONE: Record<NonNullable<PanelProps['tone']>, string> = {
  // The lift belongs to the raised tone only: a shadow under a WELL is a
  // contradiction, and the grey card's job is to recede.
  raised: 'bg-surface-raised shadow-raised',
  sunken: 'bg-surface-sunken',
}

/** The card itself: one hairline, one radius, one tone. */
export function Panel({ tone = 'raised', rows, flush, className, children, ...props }: PanelProps) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-lg border border-border-subtle',
        TONE[tone],
        rows && 'divide-y divide-border-subtle',
        !rows && !flush && 'p-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface PanelRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** A mark for the row: a logo, a status glyph. */
  icon?: React.ReactNode
  label: React.ReactNode
  /** One line under the label. */
  description?: React.ReactNode
  /** The control this row is about: a switch, a menu, a link. */
  action?: React.ReactNode
}

/** One row of a `rows` panel: what it is on the left, what you do with it on the right. */
export function PanelRow({ icon, label, description, action, className, children, ...props }: PanelRowProps) {
  return (
    <div className={cx('flex items-start gap-3 px-4 py-3', className)} {...props}>
      {icon && (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-raised text-fg-muted [&_svg]:size-4">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-ui-sm font-medium text-fg">{label}</p>
        {description && <p className="mt-0.5 text-ui-xs text-fg-muted">{description}</p>}
        {children}
      </div>
      {action && <div className="shrink-0 pt-0.5">{action}</div>}
    </div>
  )
}
