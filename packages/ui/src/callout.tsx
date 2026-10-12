import React from 'react'
import {
  IconInfo, IconCheckCircle, IconAlert, IconWarning,
} from '@tangen/icons'
import { cx } from './utils'

/**
 * Callout — inline notification block (the Alert/Banner primitive).
 * Persistent, in-flow messaging; for transient feedback use toast.*.
 *
 * Drawn as a card, not a tinted box (the user, 2026-09-12: a full-width
 * tinted panel with tinted text read as a framework default, not Tangen):
 * the card surface on a hairline, the status carried by an icon on a small
 * tinted chip, the title in the foreground tone and the body a step softer.
 * Warning and danger also tint the hairline so they register at a glance.
 * Colors ride the semantic status tokens, so dark mode is automatic.
 */

const VARIANTS = {
  info:    { chip: 'bg-info-muted text-info',       edge: 'border-border-subtle', role: 'status', Icon: IconInfo },
  success: { chip: 'bg-success-muted text-success', edge: 'border-border-subtle', role: 'status', Icon: IconCheckCircle },
  warning: { chip: 'bg-warning-muted text-warning', edge: 'border-warning/30',    role: 'alert',  Icon: IconAlert },
  danger:  { chip: 'bg-danger-muted text-danger',   edge: 'border-danger/30',     role: 'alert',  Icon: IconWarning },
} as const

export interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof VARIANTS
  /**
   * The narrow-column version: no icon chip, tighter padding, smaller type.
   * A callout in a page's width can afford the chip; the same callout in a
   * 280px panel beside a field spends a third of its width on it, which is
   * why this exists rather than every caller passing `icon={null}`.
   */
  compact?: boolean
  /** Bold first line; children render below it in a softer tone. */
  title?: string
  /** Replace the default status icon; pass null to omit. */
  icon?: React.ReactNode | null
  /** Controls at the right edge (a Dismiss, a Retry). */
  actions?: React.ReactNode
}

export function Callout({ variant = 'info', title, icon, actions, compact, className, children, ...props }: CalloutProps) {
  const v = VARIANTS[variant]
  const iconNode = icon === null || compact
    ? null
    : (
      <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-md', v.chip)} aria-hidden="true">
        {icon ?? <v.Icon className="size-4" />}
      </span>
    )
  return (
    <div
      role={v.role}
      className={cx(
        'flex rounded-xl border bg-card',
        compact ? 'gap-2 px-3 py-2.5 text-ui-xs' : 'gap-3 px-4 py-3.5 text-ui-sm',
        // A one-line body sits on the chip's centre; a titled one hangs from its top.
        title ? 'items-start' : 'items-center',
        v.edge,
        className,
      )}
      {...props}
    >
      {iconNode}
      <div className="min-w-0 flex-1">
        {/* A callout carries what went wrong, and what went wrong often
            contains something unbreakable: a provider's console URL, an id, a
            path. Wrapping is the primitive's job - a caller who has to
            remember it will forget, and the page then scrolls sideways
            (measured in a 280px flow panel, 2026-09-19). */}
        {title && <p className={cx('font-medium text-fg [overflow-wrap:anywhere]', iconNode && 'leading-7')}>{title}</p>}
        {children && <div className={cx('text-fg-muted [overflow-wrap:anywhere]', title && (iconNode ? '-mt-1' : 'mt-0.5'))}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  )
}
