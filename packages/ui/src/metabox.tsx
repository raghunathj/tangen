'use client'
import React, { useState } from 'react'
import { cx } from './utils'

// ── Primitives (composable) ───────────────────────────────────────────────────

export const MetaboxRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cx('border border-border', className)} {...props} />
  ),
)
MetaboxRoot.displayName = 'MetaboxRoot'

export const MetaboxContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cx('px-4 pt-3 pb-4 bg-surface', className)} {...props} />
  ),
)
MetaboxContent.displayName = 'MetaboxContent'

// ── Convenience wrapper ───────────────────────────────────────────────────────

export interface MetaboxProps {
  title: string
  /** Optional badge label shown next to the title (e.g. "extension") */
  badge?: string
  /** Slot rendered in the header to the right of the title (e.g. a button for modal mode) */
  action?: React.ReactNode
  /** Small marks beside the title that change nothing about the header (presence avatars). */
  meta?: React.ReactNode
  /** When true the body can be collapsed; defaults to true */
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
  contentClassName?: string
  children?: React.ReactNode
}

export function Metabox({
  title,
  badge,
  action,
  meta,
  collapsible = true,
  defaultOpen = true,
  className,
  contentClassName,
  children,
}: MetaboxProps) {
  const [open, setOpen] = useState(defaultOpen)
  const canCollapse = collapsible && !action

  return (
    <MetaboxRoot className={cx('rounded-lg bg-surface overflow-hidden shadow-xs', className)}>
      {/* The header is a row, not a button: the collapse toggle is one button
          in it and the action slot sits BESIDE it, so a button passed as the
          action never nests inside another (React warned on every editor
          load, 2026-09-13). */}
      <div
        className={cx(
          'flex items-center gap-2 w-full px-4 py-2.5 text-xs font-medium border-b border-border bg-surface-sunken transition-colors',
          canCollapse && !open && 'hover:bg-surface-hover',
        )}
      >
        {canCollapse ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left preview-clickable outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {/* Chevron - left side, collapses like repeater/section accordions */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className={cx(
                'shrink-0 transition-transform duration-200 text-fg-subtle',
                !open && '-rotate-90',
              )}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span className="text-sm font-medium text-fg flex-1">{title}</span>
          </button>
        ) : (
          <span className="text-sm font-medium text-fg flex-1">{title}</span>
        )}
        {meta}
        {badge && (
          <span className="text-[10px] font-medium text-fg-muted bg-surface-hover px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
        {action}
      </div>

      {(open || (!canCollapse && children)) && (
        <MetaboxContent className={contentClassName}>{children}</MetaboxContent>
      )}
    </MetaboxRoot>
  )
}
