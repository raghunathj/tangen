/**
 * File Name: primitives.tsx
 * Purpose: Kit display primitives that had no shared home — Card, EmptyState,
 *          ErrorState, Skeleton, Spinner — formalizing the visual patterns
 *          the platform's own screens hand-roll, so custom admin pages look
 *          native to the Tangen design system.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface — prop changes are
 *          breaking changes for site/extension developers.
 */
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { IconWarning, IconLoader } from '@tangen/icons'

// ── Card ──────────────────────────────────────────────────────────────────────

export interface CardProps {
  /** Header title — omit for a plain padded surface. */
  title?: ReactNode
  /** Short grayed text under the title. */
  description?: ReactNode
  /** Right side of the header (buttons, badges). */
  action?: ReactNode
  /** Remove body padding (e.g. for tables that manage their own). */
  flush?: boolean
  className?: string
  children: ReactNode
}

/** The standard admin surface — white, rounded, hairline border. */
export function Card({ title, description, action, flush, className, children }: CardProps) {
  return (
    <div className={clsx('rounded-lg border border-border-subtle bg-surface-raised', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
          <div className="min-w-0">
            {title && <h3 className="text-title-sm text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-ui-xs text-fg-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={clsx(!flush && 'px-4 pb-4', !flush && !(title || action) && 'pt-4')}>{children}</div>
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  /** Call to action (usually a secondary Button). */
  action?: ReactNode
  /** `center` fills an area (a list, a page); `start` sits inside a section. */
  align?: 'center' | 'start'
  className?: string
}

/** The plain empty message of spec §13: a title, one sentence, one action. */
export function EmptyState({ icon, title, description, action, align = 'center', className }: EmptyStateProps) {
  const centered = align === 'center'
  return (
    <div
      className={clsx(
        'flex flex-col',
        centered ? 'items-center justify-center px-6 py-14 text-center' : 'items-start px-0 py-6 text-left',
        className,
      )}
    >
      {icon && <div className="mb-3 text-fg-faint [&>svg]:size-5">{icon}</div>}
      <p className="text-ui font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-ui-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── ErrorState ────────────────────────────────────────────────────────────────

export interface ErrorStateProps {
  title?: string
  /** The error message (an Error's .message or your own words). */
  message: string
  /** Retry handler — renders a "Try again" button when provided. */
  retry?: () => void
  className?: string
}

/** Inline error panel with optional retry — for failed fetches inside a page. */
export function ErrorState({ title = 'Something went wrong', message, retry, className }: ErrorStateProps) {
  return (
    <div role="alert" className={clsx('rounded-lg bg-danger-muted px-4 py-3.5', className)}>
      <div className="flex items-start gap-2.5">
        <IconWarning className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0">
          <p className="text-ui-sm font-medium text-danger-fg">{title}</p>
          <p className="mt-0.5 break-words text-ui-xs text-danger-fg">{message}</p>
          {retry && (
            <button
              type="button"
              onClick={retry}
              className="mt-2 cursor-pointer rounded-xs text-ui-xs font-medium text-danger-fg underline underline-offset-2 hover:no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export interface SkeletonProps {
  /** 'text' = one line · 'block' = a rectangle · 'rows' = a list placeholder. */
  variant?: 'text' | 'block' | 'rows'
  /** Row count for variant 'rows'. */
  rows?: number
  /** Height class for 'block' (default h-32). */
  className?: string
}

/** Pulsing gray placeholders — the pattern every loading.tsx hand-rolls. */
export function Skeleton({ variant = 'text', rows = 3, className }: SkeletonProps) {
  if (variant === 'rows') {
    return (
      <div className={clsx('space-y-2.5', className)} aria-hidden>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-(--tg-row-h) rounded-control bg-surface-hover motion-safe:animate-pulse" />
        ))}
      </div>
    )
  }
  if (variant === 'block') {
    return <div className={clsx('h-32 rounded-lg bg-surface-hover motion-safe:animate-pulse', className)} aria-hidden />
  }
  return <div className={clsx('h-4 w-2/3 rounded-sm bg-surface-hover motion-safe:animate-pulse', className)} aria-hidden />
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export interface SpinnerProps {
  size?: 'sm' | 'md'
  /** Optional label rendered next to the spinner. */
  label?: string
  className?: string
}

/** Inline loading indicator. */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-fg-subtle', className)} role="status" aria-label={label ?? 'Loading'}>
      <IconLoader className={clsx('animate-spin', size === 'sm' ? 'size-3.5' : 'size-4')} aria-hidden />
      {label && <span className="text-ui-xs">{label}</span>}
    </span>
  )
}
