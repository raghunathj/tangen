/**
 * File Name: view-bar.tsx
 * Purpose: The list's view bar (tasks/ui-v2-calibration.md, items 13 and
 *          14): one 44px row with the view at the left, then the right
 *          slot (Filter, Sort), then a magnifier that expands into a 28px
 *          search field; and an optional second row under it for active
 *          filter chips. DataList renders it; a custom list (a taxonomy
 *          tree) renders it directly so every list wears the same bar.
 *
 * Author: Raghunath J
 * License: MIT
 */
import React, { useEffect, useState } from 'react'
import { IconSearch } from '@tangen/icons'
import { cx } from './utils'

export interface ViewBarSearch {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export interface ViewBarProps {
  /** The left cluster: the view switcher, a status filter. */
  left?: React.ReactNode
  /** Replaces the left cluster while it is set (a selection's bar). */
  replaceLeft?: React.ReactNode
  /** The right cluster before the search: Filter, Sort. */
  right?: React.ReactNode
  search?: ViewBarSearch
  /** A second row, rendered only when given: active filter chips. */
  filterRow?: React.ReactNode
  /**
   * `none` (default): flush on the 12px inset. `framed`: inside a card.
   * `compact`: the settings list - the search is a full-width field, always
   * open, with the right cluster (Filter, Sort) beside it and no bar line.
   */
  chrome?: 'none' | 'framed' | 'compact'
  className?: string
}

export function ViewBar({ left, replaceLeft, right, search, filterRow, chrome = 'none', className }: ViewBarProps) {
  const framed = chrome === 'framed'
  const compact = chrome === 'compact'
  const [searchOpen, setSearchOpen] = useState(() => !!search?.value)
  useEffect(() => { if (search?.value) setSearchOpen(true) }, [search?.value])
  const hasBar = !!(left || replaceLeft || right || search)

  if (compact) {
    return (
      <>
        {hasBar && (
          <div className={cx('mb-2 flex shrink-0 items-center gap-2', className)} data-testid="view-bar">
            {replaceLeft ?? left}
            {search && (
              <div className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
                <input
                  type="search"
                  value={search.value}
                  onChange={e => search.onChange(e.target.value)}
                  placeholder={search.placeholder}
                  aria-label={search.placeholder ?? 'Search'}
                  className="h-8 w-full rounded-control border border-border bg-surface-raised pl-8 pr-2 text-ui outline-none placeholder:text-fg-subtle transition-colors motion-fast focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
                />
              </div>
            )}
            {!search && !replaceLeft && <div className="flex-1" />}
            {right}
          </div>
        )}
        {filterRow && (
          <div className="mb-2 flex min-h-8 shrink-0 flex-wrap items-center gap-2" data-testid="filter-row">
            {filterRow}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      {hasBar && (
        <div className={cx('flex h-11 shrink-0 items-center gap-2 border-b border-border', framed ? 'px-[14px]' : 'px-1.5', className)} data-testid="view-bar">
          {replaceLeft ?? (
            <>
              {left}
              <div className="flex-1" />
            </>
          )}
          {right}
          {search && !searchOpen && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              <IconSearch className="size-4" aria-hidden />
            </button>
          )}
          {search && searchOpen && (
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <input
                type="search"
                autoFocus
                value={search.value}
                onChange={e => search.onChange(e.target.value)}
                onBlur={() => { if (!search.value) setSearchOpen(false) }}
                onKeyDown={e => { if (e.key === 'Escape' && !search.value) setSearchOpen(false) }}
                placeholder={search.placeholder}
                className="h-7 w-48 rounded-control border border-border bg-surface-raised pl-7 pr-2 text-ui outline-none placeholder:text-fg-subtle transition-colors motion-fast focus-visible:border-focus-border focus-visible:ring-[3px] focus-visible:ring-focus/25"
              />
            </div>
          )}
        </div>
      )}
      {filterRow && (
        <div className={cx('flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border py-1.5', framed ? 'px-[10px]' : 'px-1')} data-testid="filter-row">
          {filterRow}
        </div>
      )}
    </>
  )
}
