import React from 'react'
import { cx } from './utils'

/**
 * Typography atoms — the enforcement layer over the semantic tokens.
 * Components emit token utilities (text-fg / text-fg-muted / …), so a theme
 * change (fonts, dark mode, palette) never touches markup. Prefer these over
 * raw text-* classes in all new admin code.
 */

const HEADING_LEVELS = {
  1: 'text-title-lg text-fg',
  2: 'text-title text-fg',
  3: 'text-title-sm text-fg',
  4: 'text-ui-xs font-medium text-fg-subtle',
} as const

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Visual scale: 1 page-level · 2 section · 3 card · 4 eyebrow/group label. */
  level?: 1 | 2 | 3 | 4
  /** Rendered element — defaults to the matching h tag; override for semantics. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div' | 'span'
}

export function Heading({ level = 2, as, className, ...props }: HeadingProps) {
  const Tag = as ?? (`h${level}` as const)
  return <Tag className={cx(HEADING_LEVELS[level], className)} {...props} />
}

const TEXT_VARIANTS = {
  /** Reading copy - most admin body text. */
  body: 'text-ui-sm text-fg-muted',
  /** Emphasized inline text. */
  strong: 'text-ui-sm font-medium text-fg',
  /** Help/hint text under fields and controls. */
  help: 'text-ui-xs text-fg-subtle',
  /** Longer reading copy: descriptions, document body. */
  lead: 'text-ui-lg text-fg-muted',
} as const

export interface TextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  variant?: keyof typeof TEXT_VARIANTS
  as?: 'p' | 'span' | 'div'
}

export function Text({ variant = 'body', as: Tag = 'p', className, ...props }: TextProps) {
  return <Tag className={cx(TEXT_VARIANTS[variant], className)} {...props} />
}

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

/** Form/field label. */
export function Label({ required, className, children, ...props }: LabelProps) {
  return (
    <label className={cx('block text-ui-xs font-medium text-fg-muted', className)} {...props}>
      {children}
      {required && <span className="text-danger ml-0.5">*</span>}
    </label>
  )
}

/** Inline code chip — API paths, identifiers, prop names. */
export function InlineCode({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cx('rounded-xs bg-surface-sunken px-1 py-0.5 font-mono text-[0.75rem] text-fg', className)}
      {...props}
    />
  )
}

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional centered label (e.g. "or"). */
  label?: string
}

/** Horizontal rule — plain line, or labeled when `label` is given. */
export function Divider({ label, className, ...props }: DividerProps) {
  if (!label) {
    return <div role="separator" className={cx('h-px w-full bg-border', className)} {...props} />
  }
  return (
    <div role="separator" className={cx('flex items-center gap-3', className)} {...props}>
      <div className="h-px flex-1 bg-border" />
      <span className="text-ui-xs text-fg-subtle">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
