/**
 * File Name: TaxonomyPicker.tsx
 * Purpose: Choosing the terms an entry belongs to, over any number of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This fetched "all" the terms with `limit: 500`, which
 *          the gateway served as `maxQueryLimit` (100) without failing. Past
 *          100 terms three things broke at once and none of them said so: the
 *          list offered the first page only, the search filtered that page
 *          rather than the type, and - worst - the selected chips were
 *          `ids.map(byId).filter(Boolean)`, so a term that was not on the page
 *          rendered NOTHING. It stayed selected and stayed saved; it just
 *          could not be seen or removed.
 *
 *          Search, status and paging are the server's now, the chips are
 *          resolved by id, and a term's place in a hierarchy is the chain it
 *          carries rather than an indent computed from one page.
 */
import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconX, IconLoader, IconPlus, IconCheck, IconCheckCircle, IconExternalLink, IconRefresh,
} from '@tangen/icons'
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AncestorPrefix, type AncestorRef } from '@/components/object-list/ancestor-prefix'
import type { PickableRow } from '@/lib/pickable-objects'
import { usePickableObjects, useResolvedPickableRows } from '@/lib/use-pickable-objects'
import { pluralLabel } from '@tangen/types'

interface TermRow extends PickableRow {
  status?: string
  updated_at?: string | null
}

type StatusFilter = 'any' | 'published' | 'draft'

export interface TaxonomyPickerConfig {
  isHierarchical: boolean
  parentField: string | null
  primaryValue: string | null
  onPrimaryChange: (id: string | null) => void
  typeLabel: string
}

export interface TaxonomyPickerProps {
  workspaceId: string
  targetType: string
  value: string[]
  onChange: (ids: string[]) => void
  config: TaxonomyPickerConfig
}

function StatusBadge({ status }: { status?: string }) {
  if (status === 'published') return (
    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success-muted text-success-fg leading-none">
      Published
    </span>
  )
  if (status === 'archived') return (
    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface-hover text-fg-muted leading-none">
      Archived
    </span>
  )
  return (
    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface-hover text-fg-muted leading-none">
      Draft
    </span>
  )
}

export function TaxonomyPicker({ workspaceId, targetType, value, onChange, config,
}: TaxonomyPickerProps) {
  const { isHierarchical, parentField, primaryValue, onPrimaryChange, typeLabel } = config

  // Dedupe defensively - stored relation arrays can carry repeated ids
  // (seen in real data), which would render duplicate chips with duplicate
  // React keys.
  const ids = Array.isArray(value) ? [...new Set(value)] : []
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('any')
  const searchRef = useRef<HTMLInputElement>(null)

  const createHref = `/${workspaceId}/objects/${targetType}/new`

  const wantAncestors = isHierarchical && Boolean(parentField)
  const { rows: displayed, loading, loadingMore, total, hasMore, loadMore, refresh, error } =
    usePickableObjects({ typeName: targetType, search, enabled: open, includeAncestors: wantAncestors, status: statusFilter })

  // The chips read their own rows, so a selection outside the loaded page
  // still renders - and can still be removed.
  const { rows: selectedTerms } = useResolvedPickableRows(targetType, ids)

  useEffect(() => {
    if (!open) return
    setSearch(''); setStatusFilter('any')
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  function toggle(id: string) {
    const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
    onChange(next)
    if (onPrimaryChange && primaryValue === id && !next.includes(id)) {
      onPrimaryChange(null)
    }
  }

  // Was hand-rolled here as "ends with y ? ies : + s", which made 'Box' into
  // 'Boxs' and 'Day' into 'Daies'. One shared inflection, prose-preserving.
  const many = pluralLabel(typeLabel)

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {selectedTerms.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTerms.map(term => {
            const isPrimary = term.id === primaryValue
            return (
              <span
                key={term.id}
                className={clsx(
                  'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border',
                  isPrimary
                    ? 'bg-accent-muted border-accent/30 text-accent-fg'
                    : 'bg-surface border-border text-fg',
                )}
              >
                {onPrimaryChange && (
                  <button
                    type="button"
                    onClick={() => onPrimaryChange(isPrimary ? null : term.id)}
                    title={isPrimary ? 'Primary (click to unset)' : 'Set as primary'}
                    className={clsx(
                      'shrink-0 transition-colors',
                      isPrimary ? 'text-accent' : 'text-fg-subtle hover:text-accent',
                    )}
                  >
                    <IconCheckCircle className="size-3" />
                  </button>
                )}
                <span className="truncate max-w-[120px]">{term.title ?? term.id}</span>
                <StatusBadge status={term.status} />
                <a
                  href={`/${workspaceId}/objects/${targetType}/${term.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in editor"
                  onClick={(e) => e.stopPropagation()}
                  className="text-fg-subtle hover:text-accent transition-colors"
                >
                  <IconExternalLink className="size-3" />
                </a>
                <button
                  type="button"
                  onClick={() => toggle(term.id)}
                  title="Remove"
                  className="text-fg-subtle hover:text-danger-fg transition-colors"
                >
                  <IconX className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Add button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 w-full rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg hover:bg-surface-sunken transition-colors"
      >
        <IconPlus className="size-4 shrink-0" />
        {ids.length === 0 ? `Select ${many}` : `Add ${typeLabel}`}
      </button>

      {/* Picker dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden" showClose={false}>
          {/* `pr-5` reclaims the primitive's reserved room for a close button
              this dialog does not render. */}
          <DialogHeader className="pr-5">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-baseline gap-2 text-base font-semibold text-fg">
                {many}
                {ids.length > 0 && (
                  <span className="text-xs font-normal text-accent-fg">{ids.length} selected</span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={refresh}
                  title="Reload - pick up items you just created in the other tab"
                  className="flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg transition-colors"
                >
                  <IconRefresh className={clsx('size-3.5', loading && 'animate-spin')} />
                  Reload
                </button>
                <a
                  href={createHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Create a new ${typeLabel} in a new tab, then Reload here`}
                  className="flex items-center gap-1 text-xs font-medium text-accent-fg hover:text-accent-fg transition-colors"
                >
                  <IconPlus className="size-3.5" />
                  New {typeLabel}
                </a>
              </div>
            </div>
          </DialogHeader>

          <DialogBody className="flex flex-col p-0">
            {/* Search + status filter */}
            <div className="shrink-0 border-b border-border-subtle px-5 py-3 space-y-2">
              <div className="relative">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
                  placeholder={`Search ${many.toLowerCase()}…`}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border transition"
                />
              </div>
              <div className="flex items-center gap-1">
                {(['any', 'published', 'draft'] as StatusFilter[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={clsx(
                      'px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors',
                      statusFilter === s
                        ? s === 'published' ? 'bg-success-muted text-success-fg'
                          : s === 'draft' ? 'bg-surface-hover text-fg'
                          : 'bg-accent-muted text-accent-fg'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-hover',
                    )}
                  >
                    {s === 'any' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto max-h-72">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-fg-subtle">
                  <IconLoader className="size-5 animate-spin mr-2" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : error ? (
                <p role="alert" className="px-5 py-8 text-center text-sm text-danger-fg">{error}</p>
              ) : displayed.length === 0 ? (
                <p className="text-sm text-fg-subtle text-center py-8">
                  {search ? 'No results' : `No ${many.toLowerCase()} yet`}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {displayed.map((row) => {
                    const term = row as TermRow
                    const isChecked = ids.includes(term.id)
                    return (
                      <li key={term.id}>
                        <button
                          type="button"
                          onClick={() => toggle(term.id)}
                          className={clsx(
                            'w-full flex items-center gap-2.5 pl-5 pr-5 py-2 text-left transition-colors',
                            isChecked ? 'bg-accent-muted' : 'hover:bg-surface-sunken',
                          )}
                        >
                          {/* Checkbox */}
                          <span className={clsx(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                            isChecked ? 'bg-accent-strong border-accent' : 'border-border-strong bg-surface',
                          )}>
                            {isChecked && <IconCheck className="size-3 text-white" />}
                          </span>

                          {/* Label + updated date */}
                          <span className="flex-1 min-w-0">
                            <span className={clsx(
                              'flex items-center text-sm truncate',
                              isChecked ? 'font-medium text-accent-fg' : 'text-fg',
                            )}>
                              <AncestorPrefix ancestors={term._ancestors as AncestorRef[] | undefined} />
                              <span className="truncate">
                                {term.title ?? <span className="italic text-fg-subtle">{term.id}</span>}
                              </span>
                            </span>
                            {term.updated_at && (
                              <span className="block text-[10px] text-fg-subtle leading-tight">
                                {new Date(term.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </span>

                          <StatusBadge status={term.status} />
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
            {!loading && !error && typeof total === 'number' && total > displayed.length && (
              <p className="shrink-0 border-t border-border-subtle px-5 py-2 text-ui-xs text-fg-subtle">
                Showing {displayed.length} of {total}. Search to narrow it down.
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
