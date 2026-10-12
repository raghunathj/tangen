'use client'
/**
 * File Name: search-select.tsx
 * Purpose: Choose ONE thing out of a list too long to render - a spreadsheet,
 *          a channel, a property - by typing. The search lives INSIDE the
 *          dropdown, which is the whole point: a separate search box above a
 *          select reads as two controls for one decision, and in a narrow
 *          panel it doubles the height of every field (measured in a Flows
 *          node, 2026-09-19).
 *
 *          The host owns the data: this asks for a query and renders what
 *          comes back, so the same control works over an in-memory list and
 *          over a provider's paged API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The list is PORTALLED, over the kit's own Popover: a
 *          panel positioned inside the field's box is clipped by whatever the
 *          field sits in, which is how a channel picker inside a dialog came
 *          to be cut off (the user, 2026-09-19). Radix also flips it above the
 *          field when there is no room below, and closes it on an outside
 *          pointer-down or Escape. A chosen value with no matching option
 *          still shows (`selectedLabel`), so a stored id is never hidden.
 */
import React from 'react'
import { IconExpandUpDown, IconCheck, IconSearch, IconX } from '@tangen/icons'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cx, focusInput } from './utils'

export interface SearchSelectOption {
  value: string
  label: string
  /** One short line after the label: an owner, a row count, a path. */
  hint?: string
  /** Listed but not choosable, with the reason an operator can read. */
  disabled?: { reason: string }
}

export interface SearchSelectProps {
  value: string | null
  onChange: (next: string | null) => void
  /** What to show for the current query. The host fetches. */
  options: SearchSelectOption[]
  /** Fires as the operator types, already settled (250ms) so a keystroke is not a request. */
  onSearch?: (query: string) => void
  loading?: boolean
  /** Present when more pages exist; renders a "Load more" at the end of the list. */
  onMore?: () => void
  /** Trigger text when nothing is chosen. */
  placeholder?: string
  searchPlaceholder?: string
  /** The chosen value's label when it is not in the current page: a stored id is never hidden. */
  selectedLabel?: string
  /** When the search found nothing. */
  emptyText?: string
  id?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

export function SearchSelect({
  value, onChange, options, onSearch, loading, onMore,
  placeholder = '- Select -', searchPlaceholder = 'Search', selectedLabel,
  emptyText = 'Nothing matched.', id, className, disabled, 'aria-label': ariaLabel,
}: SearchSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // One request per settled query, not per keystroke.
  const search = (next: string) => {
    setQuery(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onSearch?.(next), 250)
  }

  const chosen = options.find((o) => o.value === value)
  const summary = chosen?.label ?? selectedLabel ?? (value ? value : placeholder)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cx(
          'flex h-(--tg-control-h) w-full cursor-default select-none items-center justify-between gap-2 rounded-control border px-2.5 text-ui shadow-raised outline-none transition-colors motion-fast',
          'border-border bg-surface-raised text-fg hover:border-border-strong',
          open && 'border-focus-border',
          'disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-hover disabled:text-fg-faint disabled:shadow-none',
          focusInput,
        )}
      >
        <span className={cx('min-w-0 flex-1 truncate text-left', !value && 'text-fg-subtle')}>{summary}</span>
        {value && !disabled && (
          // In the field, before the chevron: clearing belongs where the
          // value is, not in a button beside the field (the user,
          // 2026-09-20). Both handlers stop, because the trigger opens on
          // pointer-down.
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear"
            title="Clear"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null) }}
            className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg"
          >
            <IconX className="size-3" aria-hidden />
          </span>
        )}
        <IconExpandUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </button>
      </PopoverTrigger>

      <PopoverContent
        flush
        align="start"
        sideOffset={4}
        collisionPadding={12}
        // As wide as the field it belongs to, whatever that is.
        className="w-[var(--radix-popover-trigger-width)] min-w-[15rem] overflow-hidden p-0"
        // The search is why this control exists, so it takes focus on open -
        // Radix would otherwise focus the panel itself.
        onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus() }}
      >
        <div className="overflow-hidden rounded-lg">
          <div className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-2">
            <IconSearch className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => search(e.currentTarget.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-fg-subtle"
            />
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto p-1">
            {loading && options.length === 0 && <p className="px-2 py-1.5 text-ui-xs text-fg-subtle">Searching</p>}
            {!loading && options.length === 0 && <p className="px-2 py-1.5 text-ui-xs text-fg-subtle">{emptyText}</p>}
            {options.map((o) => {
              const on = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={Boolean(o.disabled)}
                  title={o.disabled?.reason}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={cx(
                    'flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-ui-sm transition-colors motion-fast',
                    on ? 'text-fg' : 'text-fg-muted',
                    o.disabled ? 'cursor-not-allowed text-fg-faint' : 'hover:bg-surface-sunken hover:text-fg',
                  )}
                >
                  <IconCheck className={cx('mt-0.5 size-3.5 shrink-0', on ? 'text-accent-fg' : 'opacity-0')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {(o.hint || o.disabled) && <span className="block truncate text-ui-xs text-fg-subtle">{o.disabled?.reason ?? o.hint}</span>}
                  </span>
                </button>
              )
            })}
            {onMore && (
              <button
                type="button"
                onClick={() => onMore()}
                className="mt-0.5 flex h-7 w-full items-center justify-center rounded-control text-ui-xs text-fg-muted transition-colors motion-fast hover:bg-surface-sunken hover:text-fg"
              >
                {loading ? 'Loading' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
