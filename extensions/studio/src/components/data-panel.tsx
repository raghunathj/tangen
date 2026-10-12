/**
 * File Name: data-panel.tsx
 * Purpose: The Data panel - the workspace's collections with their live
 *          published counts. Drag one onto the canvas, or click it, to land
 *          a Loop already bound to that collection.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The model lives in lib/data-panel.ts (pure, tested);
 *          this fetches and renders. Counts come from the Studio server
 *          (GET collections) on open, never up front - Studio already makes
 *          several requests to boot. A page whose slot cannot take a loop
 *          is told so, and its tiles do not drag: a tile that drags and
 *          drops nothing would be a control that appears to work.
 */
import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { IconDatabase, IconSearch } from '@tangen/icons'
import { Spinner } from '@/kit'
import { adminFetch } from '@/lib/api'
import {
  collectionRowsFrom, searchCollections, publishedLabel,
  type CollectionRow, type CollectionRef,
} from '../lib/data-panel'

interface DataPanelProps {
  /** Why a loop cannot be placed here, or null when it can. */
  unavailable: string | null
  /** Click: insert a bound loop where the selection says. */
  onPick: (collection: CollectionRef) => void
  /** Drag: the canvas is told what is being dragged; null on drag end. */
  onDragCollection: (collection: CollectionRef | null) => void
}

export function DataPanel({ unavailable, onPick, onDragCollection }: DataPanelProps) {
  const [rows, setRows] = useState<CollectionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    setError(null)
    adminFetch<{ data: unknown }>('/admin/ext/studio/collections')
      .then((r) => { if (alive) setRows(collectionRowsFrom(r.data)) })
      .catch((err) => {
        if (!alive) return
        setRows([])
        setError(err instanceof Error ? err.message : 'Could not load the collections')
      })
    return () => { alive = false }
  }, [])

  const shown = useMemo(() => searchCollections(rows ?? [], query), [rows, query])
  const canPlace = unavailable === null

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-2 pb-2 shrink-0">
        <div className="flex items-center gap-2 px-2 h-7 rounded-md border border-border bg-surface-sunken">
          <IconSearch className="size-3.5 text-fg-subtle shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery('') } }}
            placeholder="Search collections"
            aria-label="Search collections"
            className="flex-1 min-w-0 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2 space-y-2">
        {unavailable && (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-muted" role="note">
            {unavailable}
          </p>
        )}
        {rows === null ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-fg-subtle">
            <Spinner size="sm" label="Loading collections…" />
            Counting what is published…
          </div>
        ) : error ? (
          <p className="px-1 py-2 text-xs text-red-600" role="alert">{error}</p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-2 text-xs text-fg-subtle">
            {query ? 'No collections match.' : 'No content types in this environment yet.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((c) => (
              <li key={c.type}>
                <button
                  type="button"
                  draggable={canPlace}
                  onDragStart={(e) => {
                    if (!canPlace) { e.preventDefault(); return }
                    onDragCollection({ type: c.type, label: c.label })
                    e.dataTransfer?.setData('text/plain', c.type)
                  }}
                  onDragEnd={() => onDragCollection(null)}
                  onClick={() => { if (canPlace) onPick({ type: c.type, label: c.label }) }}
                  disabled={!canPlace}
                  title={canPlace ? `Place a listing of ${c.label}` : unavailable ?? undefined}
                  className={clsx(
                    'w-full flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors',
                    canPlace ? 'hover:border-accent hover:bg-accent-muted/30 cursor-grab' : 'opacity-60 cursor-not-allowed',
                  )}
                >
                  <span className="grid place-items-center size-10 shrink-0 rounded-md border border-border bg-surface-sunken text-fg-muted">
                    <IconDatabase className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg truncate">{c.label}</span>
                    <span
                      className={clsx('block text-xs truncate', c.published === null ? 'text-warning' : 'text-fg-muted')}
                      title={c.note ?? undefined}
                    >
                      {publishedLabel(c.published)}
                      {c.note ? ` - ${c.note}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows !== null && !error && canPlace && shown.length > 0 && (
          <p className="px-1 pt-1 text-[11px] text-fg-subtle">
            Drag a collection onto the page, or click it, to place a listing bound to it.
          </p>
        )}
      </div>
    </div>
  )
}
