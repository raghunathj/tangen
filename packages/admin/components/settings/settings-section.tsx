/**
 * File Name: settings-section.tsx
 * Purpose: One settings section, the way the benchmark draws it (decision of
 *          2026-09-07): the title and its description sit ABOVE the card as
 *          plain text, and the card holds only the content - optionally with
 *          a summary row (a status, a plan, a count) and the actions that
 *          belong to it. The old shape put title and description inside a
 *          grey header strip, which read as a second page header.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Used by every settings page (and exported from @/kit
 *          for extension settings pages). `flush` drops the card padding for
 *          a table or a list that draws its own rows.
 */
import React from 'react'
import { clsx } from 'clsx'

export interface SettingsSectionProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Controls beside the title (a refresh, a "manage" button). */
  actions?: React.ReactNode
  /** A summary row inside the card, above the content: a status and the actions that belong to it. */
  summary?: React.ReactNode
  /** No padding on the content: the content draws its own rows (a table, a list). */
  flush?: boolean
  /** No card at all: the header, then the content on the page ground (a person's own settings, the benchmark's Profile). */
  plain?: boolean
  className?: string
  children?: React.ReactNode
}

export function SettingsSection({ title, description, actions, summary, flush, plain, className, children }: SettingsSectionProps) {
  if (plain) {
    return (
      <section className={clsx('space-y-3', className)} data-testid="settings-section" data-plain>
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            {description && <p className="mt-1 text-sm text-fg-subtle">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {children}
      </section>
    )
  }
  return (
    <section className={clsx('space-y-3', className)} data-testid="settings-section">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="mt-1 text-sm text-fg-subtle">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {/* The card (the user, 2026-09-08): the benchmark's near-white on a hairline, a hair darker than the white page. */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-card">
        {summary && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-sunken/50 px-5 py-3.5 text-sm">
            {summary}
          </div>
        )}
        {children !== undefined && (
          <div className={flush ? undefined : 'px-5 py-5'}>{children}</div>
        )}
      </div>
    </section>
  )
}
