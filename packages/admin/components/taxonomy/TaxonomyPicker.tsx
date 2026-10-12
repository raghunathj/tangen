import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconX, IconLoader, IconPlus, IconCheck, IconCheckCircle, IconExternalLink, IconRefresh,
} from '@tangen/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { adminFetch } from '@/lib/api'
import { buildTaxonomyTree, flattenTree, filterFlatNodes } from '@/lib/taxonomy-tree'

interface TermRow {
  id: string
  title: string | null
  status: string
  updated_at: string | null
  [key: string]: unknown
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

function StatusBadge({ status }: { status: string }) {
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
  const [allTerms, setAllTerms] = useState<TermRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('any')
  const searchRef = useRef<HTMLInputElement>(null)

  const createHref = `/${workspaceId}/objects/${targetType}/new`

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminFetch<{ data: TermRow[] }>(
        `/objects/${targetType}/query`,
        { method: 'POST', body: JSON.stringify({ limit: 500, status: 'any' }) },
      )
      // Belt and braces: never let a response carry the same term twice into
      // keyed renders.
      const seen = new Set<string>()
      setAllTerms((res.data ?? []).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))))
    } catch {
      setAllTerms([])
    } finally {
      setLoading(false)
    }
  }, [targetType])

  // Load terms when picker opens
  useEffect(() => {
    if (!open) return
    setSearch(''); setStatusFilter('any')
    fetchAll()
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, fetchAll])

  // Load terms to resolve the selected chips. The value (ids) can arrive AFTER
  // mount (the editor extracts field values asynchronously), so react to ids
  // becoming non-empty — not just mount — or the chips render blank on a fresh
  // page load. Guarded on allTerms.length === 0 so it fetches once, no loop.
  useEffect(() => {
    if (ids.length > 0 && allTerms.length === 0) fetchAll()
  }, [ids.length, allTerms.length, fetchAll])

  // Build tree and flat list for display
  const flatNodes = (() => {
    if (allTerms.length === 0) return []
    if (isHierarchical && parentField) {
      const tree = buildTaxonomyTree(allTerms as any[], parentField)
      return flattenTree(tree)
    }
    return allTerms.map(r => ({ row: r as any, depth: 0, parentId: null, children: [] }))
  })()

  const displayed = filterFlatNodes(flatNodes, search)
    .filter(n => statusFilter === 'any' || (n.row as TermRow).status === statusFilter)

  const termById = new Map(allTerms.map(t => [t.id, t]))
  const selectedTerms = ids.map(id => termById.get(id)).filter(Boolean) as TermRow[]

  function toggle(id: string) {
    const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
    onChange(next)
    if (onPrimaryChange && primaryValue === id && !next.includes(id)) {
      onPrimaryChange(null)
    }
  }

  const pluralLabel = typeLabel.endsWith('y')
    ? typeLabel.slice(0, -1) + 'ies'
    : typeLabel + 's'

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
        {ids.length === 0 ? `Select ${pluralLabel}` : `Add ${typeLabel}`}
      </button>

      {/* Picker dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden" showClose={false}>
          <DialogHeader className="px-5 pt-5 pb-3.5 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-baseline gap-2 text-base font-semibold text-fg">
                {pluralLabel}
                {ids.length > 0 && (
                  <span className="text-xs font-normal text-accent-fg">{ids.length} selected</span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => { void fetchAll() }}
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

          {/* Search + status filter */}
          <div className="px-5 pt-3 pb-2 border-b border-border space-y-2">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
                placeholder={`Search ${pluralLabel.toLowerCase()}…`}
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
            ) : displayed.length === 0 ? (
              <p className="text-sm text-fg-subtle text-center py-8">
                {search ? 'No results' : `No ${pluralLabel.toLowerCase()} yet`}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {displayed.map(({ row, depth }) => {
                  const term = row as TermRow
                  const isChecked = ids.includes(term.id)
                  return (
                    <li key={term.id}>
                      <button
                        type="button"
                        onClick={() => toggle(term.id)}
                        style={{ paddingLeft: `${20 + depth * 16}px` }}
                        className={clsx(
                          'w-full flex items-center gap-2.5 pr-5 py-2 text-left transition-colors',
                          isChecked ? 'bg-accent-muted' : 'hover:bg-surface-sunken',
                        )}
                      >
                        {/* Tree indent decoration */}
                        {isHierarchical && depth > 0 && (
                          <span className="text-fg-subtle text-xs shrink-0" aria-hidden>└</span>
                        )}

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
                            'block text-sm truncate',
                            isChecked ? 'font-medium text-accent-fg' : 'text-fg',
                          )}>
                            {term.title ?? <span className="italic text-fg-subtle">{term.id}</span>}
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
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-5 py-3 border-t border-border bg-surface-sunken">
            <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
