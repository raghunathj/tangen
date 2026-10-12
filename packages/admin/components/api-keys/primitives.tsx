/**
 * File Name: primitives.tsx
 * Purpose: Shared building blocks for the API-key manager — checkbox pills,
 *          permission accordions, tab bar, the revoke dialog, and the generic
 *          item-override row used for per-type / per-form / per-resource
 *          scoping.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: extracted from settings/api-keys pages so the create
 *          and edit flows render permissions through one implementation.
 */
import { clsx } from 'clsx'
import { IconCheck, IconChevronDown, IconTrash } from '@tangen/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

/** Display form of an action value: 'read_draft' → 'Read Draft'. Stored values never change. */
export function humanizeAction(action: string | null | undefined): string {
  if (!action) return ''
  return action
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// ── Action pill ───────────────────────────────────────────────────────────────

export function ActionPill({ action, checked, onChange, disabled = false, title }: {
  action: string
  checked: boolean
  onChange: () => void
  /** Renders inert — e.g. a grant for an extension that is no longer active. */
  disabled?: boolean
  title?: string
}) {
  return (
    <label
      title={title}
      className={clsx(
        // `relative`: the sr-only checkbox is absolutely positioned and must land INSIDE the pill.
        // Unpositioned, it landed against the shell, and focusing it scrolled the shell (2026-09-12).
        'relative flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors select-none',
        disabled
          ? 'cursor-not-allowed opacity-60 ' + (checked
              ? 'border-border-strong bg-surface-hover text-fg-muted'
              : 'border-border bg-surface-sunken text-fg-subtle')
          : checked
            ? 'cursor-pointer border-accent bg-accent-muted text-accent-fg'
            : 'cursor-pointer border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-sunken',
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={onChange} />
      {checked && <IconCheck className="size-3 shrink-0" />}
      {humanizeAction(action)}
    </label>
  )
}

// ── Accordion section ─────────────────────────────────────────────────────────

export function AccordionSection({ id, label, summary, open, onToggle, children }: {
  id: string
  label: string
  /** Collapsed-state grant summary, e.g. "read, write" — '—' means no grants. */
  summary: string
  open: boolean
  onToggle: (id: string) => void
  children: React.ReactNode
}) {
  const hasGrants = summary !== '0 selected'
  // The section card (2026-09-08): a 48px header row with the resource, its
  // grants as a pill, and the chevron in a muted disc; the body on a sunken
  // ground under a hairline. Open, the header stays the card's summary row.
  return (
    <div className={clsx('overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] motion-fast', open ? 'border-border shadow-raised' : 'border-border-subtle hover:border-border')} data-state={open ? 'open' : 'closed'}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex h-12 w-full items-center justify-between gap-3 px-4 text-left transition-colors motion-fast hover:bg-surface-sunken outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-sm font-medium text-fg">{label}</span>
          <span className={clsx(
            'truncate rounded-full px-2 py-0.5 text-ui-xs font-medium',
            hasGrants ? 'bg-accent-muted text-accent-fg' : 'bg-surface-hover text-fg-subtle',
          )}>
            {summary}
          </span>
        </div>
        <span className={clsx('flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-fg-subtle transition-transform motion-fast', open && 'rotate-180')} aria-hidden>
          <IconChevronDown className="size-3.5" />
        </span>
      </button>
      {open && (
        <div className="border-t border-border-subtle bg-surface-sunken/60 px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

export function TabBar<T extends string>({ active, onChange, tabs, variant = 'underline', centered = false }: {
  active: T
  onChange: (t: T) => void
  tabs: { id: T; label: string; badge?: number }[]
  /** 'underline' — border-bottom row (default); 'pills' — segmented button style. */
  variant?: 'underline' | 'pills'
  /** Underline variant only: center the tab row. */
  centered?: boolean
}) {
  if (variant === 'pills') {
    return (
      <div className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken border border-border p-1 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active === t.id
                ? 'bg-surface text-fg shadow-xs border border-border'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={clsx(
                'rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none',
                active === t.id ? 'bg-accent-muted text-accent-fg' : 'bg-surface-sunken text-fg-muted',
              )}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className={clsx('flex border-b border-border mb-6', centered && 'justify-center')}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            active === t.id
              ? 'border-accent text-accent-fg'
              : 'border-transparent text-fg-muted hover:text-fg hover:border-border-strong',
          )}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 && (
            <span className={clsx(
              'rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none',
              active === t.id ? 'bg-accent-muted text-accent-fg' : 'bg-surface-hover text-fg-muted',
            )}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Generic item-override row ─────────────────────────────────────────────────

export interface OverrideOption { value: string; label: string }

/**
 * One per-item scoping row — a picker (object type, form, resource item) plus
 * action pills. An override replaces the resource's global actions for the
 * chosen item; a row with no actions selected denies the item outright.
 */
export function ItemOverrideRow({
  value, options, usedValues, actions, selectedActions,
  onValueChange, onActionToggle, onRemove,
}: {
  value: string
  options: OverrideOption[]
  /** Values already claimed by other rows — disabled in the picker. */
  usedValues: string[]
  /** The action vocabulary for this resource. */
  actions: string[]
  selectedActions: string[]
  onValueChange: (value: string) => void
  onActionToggle: (action: string) => void
  onRemove: () => void
}) {
  const known = options.some((o) => o.value === value)
  return (
    <div className="rounded-lg border border-border bg-surface-sunken p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2">
          <select
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-full appearance-none rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-fg shadow-xs outline-none transition focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border"
          >
            {options.map((o) => (
              <option
                key={o.value}
                value={o.value}
                disabled={o.value !== value && usedValues.includes(o.value)}
              >
                {o.label}
              </option>
            ))}
            {/* A grant whose item no longer exists stays visible and editable */}
            {!known && <option value={value}>{value}</option>}
          </select>
          <div className="flex flex-wrap gap-1.5">
            {actions.map((action) => (
              <ActionPill
                key={action}
                action={action}
                checked={selectedActions.includes(action)}
                onChange={() => onActionToggle(action)}
              />
            ))}
          </div>
        </div>
        <button
          onClick={onRemove}
          className="mt-0.5 rounded-md p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg transition-colors"
          title="Remove override"
        >
          <IconTrash className="size-4" />
        </button>
      </div>
      {selectedActions.length === 0 && (
        <p className="mt-2 text-xs text-warning-fg">No actions selected - this item will be denied.</p>
      )}
    </div>
  )
}

// ── Revoke dialog ─────────────────────────────────────────────────────────────

export function RevokeDialog({ keyLabel, onConfirm, onCancel, loading }: {
  keyLabel: string
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke API key?</DialogTitle>
          <DialogDescription className="mt-1">
            <strong>{keyLabel}</strong> will be immediately invalidated. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" isLoading={loading} onClick={onConfirm}>
            Revoke key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
