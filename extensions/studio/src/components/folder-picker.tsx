/**
 * File Name: folder-picker.tsx
 * Purpose: A searchable folder dropdown for the Media panel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A native <select> cannot be searched, and a workspace
 *          with dozens of nested folders needs to be. The kit's FilterDropdown
 *          has no search either, so this follows the same hand-rolled pattern
 *          Studio's publish menu uses: a trigger, a popover closed by
 *          outside-click or Escape, and keyboard navigation so the mouse is
 *          never required.
 *
 *          The filtering is pure and lives in lib/media-browse.ts; this file
 *          is the surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IconChevronDown, IconSearch, IconFolder } from '@tangen/icons'
import { filterFolders, type FolderOption } from '../lib/media-browse'

interface FolderPickerProps {
  options: FolderOption[]
  /** null means All media. */
  value: string | null
  onChange: (id: string | null) => void
}

const ALL = { id: '', name: 'All media', depth: 0 }

export function FolderPicker({ options, value, onChange }: FolderPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const root = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  // "All media" is always first and never filtered out, so there is always
  // a way back to the unfiltered library.
  const rows = useMemo(() => [ALL, ...filterFolders(options, query)], [options, query])
  const current = options.find((f) => f.id === value) ?? ALL

  const close = useCallback(() => { setOpen(false); setQuery(''); setCursor(0) }, [])
  const pick = useCallback((id: string) => { onChange(id || null); close() }, [onChange, close])

  // Outside click and Escape both close, the way every menu here behaves.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  useEffect(() => { if (open) input.current?.focus() }, [open])
  useEffect(() => { setCursor(0) }, [query])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); return }
    if (e.key === 'Enter') { e.preventDefault(); const r = rows[cursor]; if (r) pick(r.id) }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 w-full h-7 px-2 rounded-md border border-border bg-surface-sunken text-xs text-fg hover:border-accent transition-colors duration-(--tg-motion-fast)"
      >
        <IconFolder className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="flex-1 min-w-0 text-left truncate">{current.name}</span>
        <IconChevronDown className={clsx('size-3 shrink-0 text-fg-subtle transition-transform duration-(--tg-motion-fast)', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-md border border-border bg-surface shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2 h-7 border-b border-border">
            <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search folders"
              className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {rows.map((r, i) => (
              <li
                key={r.id || '__all'}
                role="option"
                aria-selected={r.id === (value ?? '')}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(r.id) }}
                style={{ paddingLeft: `${0.5 + r.depth * 0.75}rem` }}
                className={clsx(
                  'flex items-center gap-1.5 h-6 pr-2 text-xs cursor-pointer',
                  i === cursor ? 'bg-surface-raised text-fg' : 'text-fg-muted',
                  r.id === (value ?? '') && 'font-medium text-fg',
                )}
              >
                {r.id && <IconFolder className="size-3 shrink-0 text-fg-subtle" />}
                <span className="truncate">{r.name}</span>
              </li>
            ))}
            {rows.length === 1 && query && (
              <li className="px-2 h-6 flex items-center text-xs text-fg-subtle">No folder matches.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
