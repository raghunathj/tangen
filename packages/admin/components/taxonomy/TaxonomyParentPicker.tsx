/**
 * File Name: TaxonomyParentPicker.tsx
 * Purpose: Choosing the entry an entry sits under, over any number of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This used to fetch "every" entry and build a tree in the
 *          browser. It asked for 500, the gateway served `maxQueryLimit` (100)
 *          without failing, and the search filtered only what had arrived - so
 *          at 1,000 entries the picker offered the first 100, could not find
 *          the other 900, and showed a raw id whenever the chosen parent was
 *          not among them.
 *
 *          The search is the server's now and the rows arrive a page at a
 *          time, which costs the indentation: a tree assembled from ONE page
 *          promotes every row whose parent is elsewhere to the root, so the
 *          depth it drew was fiction on page 2 of any search. Each row carries
 *          the chain it sits under instead (`_ancestors`), which is resolved
 *          on the server and is therefore true on every page - the same change
 *          the content list made, for the same reason.
 */
import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { IconSearch, IconX, IconLoader, IconChevronDown, IconExternalLink } from '@tangen/icons'
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AncestorPrefix, type AncestorRef } from '@/components/object-list/ancestor-prefix'
import { parentChoicesFromRows } from '@/lib/pickable-objects'
import { usePickableObjects, useResolvedPickableRow } from '@/lib/use-pickable-objects'

export interface TaxonomyParentPickerProps {
  workspaceId: string
  targetType: string
  value: string | null
  onChange: (id: string | null) => void
  currentObjectId: string | null
}

export function TaxonomyParentPicker({ workspaceId, targetType, value, onChange, currentObjectId,
}: TaxonomyParentPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const { rows, loading, loadingMore, total, hasMore, loadMore, error } = usePickableObjects({
    typeName: targetType, search, enabled: open, includeAncestors: true,
  })

  // The chosen parent is read by id, so the trigger shows its title whether or
  // not it happens to be on the page the picker last loaded.
  const { row: selected, loading: resolving } = useResolvedPickableRow(targetType, value, true)

  useEffect(() => {
    if (!open) return
    setSearch('')
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  const choices = parentChoicesFromRows(rows, currentObjectId)
  const typeLabel = targetType.replace(/_/g, ' ')
  const showingCount = typeof total === 'number' && total > rows.length

  function handleSelect(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          'flex items-center justify-between w-full rounded-md border px-2.5 py-2 text-sm shadow-xs outline-none transition',
          'border-border-strong bg-surface hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border',
        )}
      >
        <span className={clsx('truncate', value ? 'text-fg' : 'text-fg-subtle italic')}>
          {value
            ? selected
              ? (selected.title ?? value)
              : resolving
                ? <span className="text-fg-subtle italic">Loading…</span>
                : value
            : 'None - top level'}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <>
              <a
                href={`/${workspaceId}/objects/${targetType}/${value}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in editor"
                onClick={(e) => e.stopPropagation()}
                className="p-0.5 rounded text-fg-subtle hover:text-accent transition-colors"
              >
                <IconExternalLink className="size-3.5" />
              </a>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(null) }}
                className="p-0.5 rounded text-fg-subtle hover:text-danger-fg hover:bg-danger-muted transition-colors"
                title="Clear parent (make top level)"
              >
                <IconX className="size-3.5" />
              </button>
            </>
          )}
          <IconChevronDown className="size-4 text-fg-subtle" />
        </div>
      </button>

      {/* Picker dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden" showClose={false}>
          {/* `pr-5` reclaims the room reserved for a close button this dialog
              does not render; the rest of the padding is the primitive's. */}
          <DialogHeader className="pr-5">
            <DialogTitle className="text-sm font-semibold text-fg">
              Select parent {typeLabel}
            </DialogTitle>
          </DialogHeader>

          <DialogBody className="flex flex-col p-0">
            <div className="shrink-0 border-b border-border-subtle px-5 py-3">
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border transition"
                />
              </div>
            </div>

            <div className="overflow-y-auto max-h-72">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-fg-subtle">
                  <IconLoader className="size-5 animate-spin mr-2" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : error ? (
                <p role="alert" className="px-5 py-8 text-center text-sm text-danger-fg">{error}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {/* None option */}
                  {!search.trim() && (
                    <li>
                      <button
                        type="button"
                        onClick={() => handleSelect(null)}
                        className={clsx(
                          'w-full flex items-center px-4 py-2.5 text-left text-sm transition-colors',
                          value === null ? 'bg-accent-muted text-accent-fg font-medium' : 'text-fg-muted italic hover:bg-surface-sunken',
                        )}
                      >
                        None - top level
                      </button>
                    </li>
                  )}

                  {choices.length === 0 && (
                    <li className="text-sm text-fg-subtle text-center py-8">No results</li>
                  )}

                  {choices.map(({ row, blocked }) => {
                    const isSelected = row.id === value
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          disabled={blocked}
                          onClick={() => !blocked && handleSelect(row.id)}
                          title={blocked ? `${row.title ?? 'This entry'} is already inside this one, so it cannot also be its parent` : undefined}
                          className={clsx(
                            'w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors',
                            isSelected && !blocked && 'bg-accent-muted text-accent-fg font-medium',
                            !isSelected && !blocked && 'text-fg hover:bg-surface-sunken',
                            blocked && 'text-fg-subtle cursor-not-allowed',
                          )}
                        >
                          <span className="flex min-w-0 items-center truncate">
                            <AncestorPrefix ancestors={row._ancestors as AncestorRef[] | undefined} />
                            <span className="truncate">{row.title ?? <span className="italic text-fg-subtle">{row.id}</span>}</span>
                          </span>
                          {blocked && (
                            <span className="ml-auto text-ui-xs text-fg-subtle shrink-0">inside this one</span>
                          )}
                        </button>
                      </li>
                    )
                  })}

                  {hasMore && (
                    <li className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={loadMore}
                        disabled={loadingMore}
                      >
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </Button>
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* How much of the set is on screen. Without it a search over a
                large type looks like a short list rather than a first page. */}
            {!loading && !error && showingCount && (
              <p className="shrink-0 border-t border-border-subtle px-5 py-2 text-ui-xs text-fg-subtle">
                Showing {rows.length} of {total}. Search to narrow it down.
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
