import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { IconSearch, IconX, IconLoader, IconChevronDown, IconExternalLink } from '@tangen/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { adminFetch } from '@/lib/api'
import { buildTaxonomyTree, flattenTree, getDescendantIds } from '@/lib/taxonomy-tree'

interface TermRow {
  id: string
  title: string | null
  status: string
  [key: string]: unknown
}

export interface TaxonomyParentPickerProps {
  workspaceId: string
  targetType: string
  parentField: string
  value: string | null
  onChange: (id: string | null) => void
  currentObjectId: string | null
}

export function TaxonomyParentPicker({ workspaceId, targetType, parentField, value, onChange, currentObjectId,
}: TaxonomyParentPickerProps) {
  const [open, setOpen] = useState(false)
  const [allTerms, setAllTerms] = useState<TermRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminFetch<{ data: TermRow[] }>(
        `/objects/${targetType}/query`,
        { method: 'POST', body: JSON.stringify({ limit: 500, status: 'any' }) },
      )
      setAllTerms(res.data ?? [])
    } catch {
      setAllTerms([])
    } finally {
      setLoading(false)
    }
  }, [targetType])

  // Fetch when a value is present but terms haven't been loaded yet (covers async field load after mount)
  useEffect(() => { if (value && allTerms.length === 0) fetchAll() }, [value, fetchAll])

  useEffect(() => {
    if (open) {
      setSearch('')
      if (allTerms.length === 0) fetchAll()
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open, fetchAll])

  const resolvedTerm = allTerms.find(t => t.id === value)
  const currentLabel = resolvedTerm?.title ?? (loading ? null : value)

  // Build tree + descendant set for cycle prevention
  const tree = buildTaxonomyTree(allTerms as any[], parentField)
  const forbiddenIds = new Set([
    ...(currentObjectId ? [currentObjectId] : []),
    ...(currentObjectId ? [...getDescendantIds(tree, currentObjectId)] : []),
  ])

  // Flatten tree to render indented list
  const flatNodes = flattenTree(tree)

  const filtered = search.trim()
    ? flatNodes.filter(n => (n.row as TermRow).title?.toLowerCase().includes(search.toLowerCase()))
    : flatNodes

  function handleSelect(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  const typeLabel = targetType.replace(/_/g, ' ')

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
            ? currentLabel === null
              ? <span className="text-fg-subtle italic">Loading…</span>
              : currentLabel
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
        <DialogContent className="max-w-md p-0 overflow-hidden" showClose={false}>
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="text-sm font-semibold text-fg">
              Select parent {typeLabel}
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 pt-3 pb-2 border-b border-border">
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

                {filtered.length === 0 && (
                  <li className="text-sm text-fg-subtle text-center py-8">No results</li>
                )}

                {filtered.map(({ row, depth }) => {
                  const term = row as TermRow
                  const isForbidden = forbiddenIds.has(term.id)
                  const isSelected = term.id === value
                  return (
                    <li key={term.id}>
                      <button
                        type="button"
                        disabled={isForbidden}
                        onClick={() => !isForbidden && handleSelect(term.id)}
                        title={isForbidden ? 'Cannot select self or a descendant as parent (creates a cycle)' : undefined}
                        className={clsx(
                          'w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors',
                          isSelected && !isForbidden && 'bg-accent-muted text-accent-fg font-medium',
                          !isSelected && !isForbidden && 'text-fg hover:bg-surface-sunken',
                          isForbidden && 'text-fg-subtle cursor-not-allowed line-through',
                        )}
                        style={{ paddingLeft: `${16 + depth * 16}px` }}
                      >
                        {depth > 0 && (
                          <span className="shrink-0 text-fg-subtle" aria-hidden>└</span>
                        )}
                        <span className="truncate">{term.title ?? <span className="italic text-fg-subtle">{term.id}</span>}</span>
                        {isForbidden && (
                          <span className="ml-auto text-[10px] text-fg-subtle shrink-0">self/descendant</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
