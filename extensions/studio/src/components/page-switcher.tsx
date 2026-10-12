/**
 * File Name: page-switcher.tsx
 * Purpose: The top-bar control that says which page (and which kind of
 *          page) is open, jumps between pages without leaving Studio, and
 *          creates one from the same place.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio is a full-viewport takeover, so without this the
 *          only way to another page is to leave the tool entirely. Grouping,
 *          the type pills and search live in lib/page-switcher.ts; this is
 *          presentation and keyboard handling only. Creating a page opens
 *          the SAME dialog the Pages panel and the home screen use (E-T1) -
 *          one create path, one set of rules.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IconChevronDown, IconPlus, IconSearch } from '@tangen/icons'
import { pageGroups, switcherPills, currentTypeLabel, type SwitcherGroup } from '../lib/page-switcher'
import type { StudioType } from '../lib/model'
import { statusMeta } from '../lib/viewport'

interface PageSwitcherProps {
  title: string
  types: StudioType[]
  rowsByType: Record<string, unknown[]>
  currentType?: string
  currentId?: string
  loading?: boolean
  /** Opening is what triggers the fetch - the list is not loaded up front. */
  onOpen: () => void
  onPick: (type: string, id: string) => void
  /** Present when this member may create a page; opens the New page dialog. */
  onNew?: () => void
  /**
   * The kind of page being edited, for before the type list has loaded
   * (the list loads on open). The list's own label wins once it is here.
   */
  typeLabel?: string | null
}

export function PageSwitcher({
  title, types, rowsByType, currentType, currentId, loading, onOpen, onPick, onNew, typeLabel,
}: PageSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Empty string: every type. */
  const [typeFilter, setTypeFilter] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  const groups: SwitcherGroup[] = useMemo(
    () => pageGroups(types, rowsByType, { query, currentType, currentId, typeFilter: typeFilter || undefined }),
    [types, rowsByType, query, currentType, currentId, typeFilter],
  )
  const pills = useMemo(() => switcherPills(types, rowsByType, currentType), [types, rowsByType, currentType])
  const kind = currentTypeLabel(types, currentType) ?? typeLabel ?? null

  // Close on outside click and on Escape. Both, because a dropdown that only
  // closes one way is a dropdown people end up fighting.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) { setQuery(''); setTypeFilter(''); onOpen() }
        }}
        className="flex items-center gap-1.5 max-w-[320px] rounded px-2 py-1 text-sm font-medium text-fg hover:bg-surface-hover"
        title="Switch page"
      >
        {/* Type AND object: "which page am I editing" needs both halves -
            a title alone does not say whether this is a post or a landing
            page, and the two can share a name. */}
        {kind && (
          <span className="shrink-0 rounded bg-surface-sunken border border-border px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
            {kind}
          </span>
        )}
        <span className="truncate">{title || 'Untitled'}</span>
        <IconChevronDown className={clsx('size-3.5 shrink-0 text-fg-subtle transition-transform duration-(--tg-motion-fast)', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-80 rounded-md border border-border bg-surface-raised shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2 h-8 border-b border-border">
            <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages"
              className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>

          {pills.length > 1 && (
            /* The home screen's type pills, in the bar: narrow to one kind
               of page, search within it. */
            <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-border" role="group" aria-label="Kind of page">
              <button
                type="button"
                onClick={() => setTypeFilter('')}
                aria-pressed={typeFilter === ''}
                className={clsx('rounded-full px-2 py-0.5 text-[11px]', typeFilter === '' ? 'bg-accent-muted text-accent-fg' : 'text-fg-muted hover:bg-surface-hover')}
              >
                All
              </button>
              {pills.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => setTypeFilter(p.type)}
                  aria-pressed={typeFilter === p.type}
                  className={clsx('rounded-full px-2 py-0.5 text-[11px]', typeFilter === p.type ? 'bg-accent-muted text-accent-fg' : 'text-fg-muted hover:bg-surface-hover')}
                >
                  {p.label} <span className="opacity-70">{p.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto py-1">
            {loading ? (
              <p className="px-3 py-2 text-xs text-fg-subtle">Loading pages…</p>
            ) : groups.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-subtle">
                {query ? 'No pages match.' : 'No other pages yet.'}
              </p>
            ) : groups.map((g) => (
              <div key={g.type}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                  {g.label}
                </p>
                {g.pages.map((p) => (
                  <button
                    key={`${p.type}:${p.id}`}
                    type="button"
                    onClick={() => { setOpen(false); if (!p.current) onPick(p.type, p.id) }}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs',
                      p.current ? 'bg-accent-muted text-accent-fg' : 'text-fg hover:bg-surface-hover',
                    )}
                  >
                    <span className={clsx('size-1.5 rounded-full shrink-0', statusMeta(p.status).dot)} />
                    <span className="flex-1 min-w-0 truncate">{p.title}</span>
                    {p.current && <span className="text-[10px] shrink-0">Editing</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {onNew && (
            /* Create from the same control: the thing that makes the bar a
               workspace rather than a lookup. */
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => { setOpen(false); onNew() }}
                className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-hover"
              >
                <IconPlus className="size-3.5 text-fg-subtle" />
                New page
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
