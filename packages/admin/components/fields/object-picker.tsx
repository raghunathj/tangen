

import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconExternalLink, IconX, IconLoader,
  IconLink, IconPlus, IconCheck,
} from '@tangen/icons'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { adminFetch } from '@/lib/api'
import { timeAgo } from '@/lib/webhook-logs'
import { statusBadge, type RelationStatusFilter } from '@/lib/relation-picker'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ObjectRef {
  id: string
  type: string
  title: string | null
  status: string
  updatedAt?: string
  updated_at?: string
}

export type ObjectValue = { id: string; type: string } | null
export type ObjectValues = { id: string; type: string }[]

export interface ObjectPickerProps {
  workspaceId: string
  include: string[]
  many?: boolean
  value: ObjectValue | ObjectValues
  onChange: (v: ObjectValue | ObjectValues) => void
}

const PAGE_SIZE = 10

const STATUS_FILTERS: { label: string; value: RelationStatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
  { label: 'Archived', value: 'archived' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const { label, className } = statusBadge(status)
  return (
    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', className)}>
      {label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-hover text-fg-muted border border-border font-mono">
      {type}
    </span>
  )
}

// ── Picker modal ──────────────────────────────────────────────────────────────

function ObjectPickerModal({
  open, onOpenChange, include, workspaceId,
  many, currentIds, onSelectSingle, onSelectMany,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  include: string[]
  workspaceId: string
  many: boolean
  currentIds: string[]
  onSelectSingle: (obj: ObjectRef) => void
  onSelectMany: (ids: { id: string; type: string }[]) => void
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<RelationStatusFilter>('all')
  const [results, setResults] = useState<ObjectRef[]>([])
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState<{ id: string; type: string }[]>([])

  const searchRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Stores full merged list for multi-type client-side pagination
  const mergedCacheRef = useRef<ObjectRef[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const visibleTypes = include.length > 0 ? include : []

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  async function fetchSingleType(type: string, q: string, off: number, sf: RelationStatusFilter): Promise<{ items: ObjectRef[]; more: boolean }> {
    const body: Record<string, unknown> = { limit: PAGE_SIZE, offset: off }
    body.status = sf === 'all' ? 'any' : sf
    if (q) body.query = { title: { contains: q } }
    const res = await adminFetch<{ data: any[] }>(`/objects/${type}/query`, {
      method: 'POST', body: JSON.stringify(body),
    })
    const items = (res.data ?? []).map((obj) => ({ ...obj, type })) as ObjectRef[]
    return { items, more: items.length === PAGE_SIZE }
  }

  async function fetchAllTypes(types: string[], q: string, sf: RelationStatusFilter): Promise<ObjectRef[]> {
    const groups = await Promise.all(
      types.map(async (type) => {
        try {
          const body: Record<string, unknown> = { limit: 50, offset: 0 }
          body.status = sf === 'all' ? 'any' : sf
          if (q) body.query = { title: { contains: q } }
          const res = await adminFetch<{ data: any[] }>(`/objects/${type}/query`, {
            method: 'POST', body: JSON.stringify(body),
          })
          return (res.data ?? []).map((obj) => ({ ...obj, type })) as ObjectRef[]
        } catch {
          return [] as ObjectRef[]
        }
      }),
    )
    return groups.flat().sort((a, b) => {
      const at = a.updated_at ?? a.updatedAt ?? ''
      const bt = b.updated_at ?? b.updatedAt ?? ''
      return bt.localeCompare(at)
    })
  }

  // ── Initial fetch (first page) ────────────────────────────────────────────

  async function loadFirst(q: string, tf: string, sf: RelationStatusFilter) {
    const types = tf === 'all' ? visibleTypes : [tf]
    if (types.length === 0) return
    setLoading(true)
    try {
      if (types.length === 1) {
        const { items, more } = await fetchSingleType(types[0], q, 0, sf)
        setResults(items)
        setOffset(items.length)
        setHasMore(more)
      } else {
        const all = await fetchAllTypes(types, q, sf)
        mergedCacheRef.current = all
        const page = all.slice(0, PAGE_SIZE)
        setResults(page)
        setOffset(page.length)
        setHasMore(page.length < all.length)
      }
    } catch {
      setResults([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }

  // ── Load next page ────────────────────────────────────────────────────────

  async function loadMore(q: string, tf: string, sf: RelationStatusFilter, currentOffset: number) {
    const types = tf === 'all' ? visibleTypes : [tf]
    if (types.length === 0 || loading) return
    setLoading(true)
    try {
      if (types.length === 1) {
        const { items, more } = await fetchSingleType(types[0], q, currentOffset, sf)
        setResults((prev) => [...prev, ...items])
        setOffset(currentOffset + items.length)
        setHasMore(more)
      } else {
        const next = mergedCacheRef.current.slice(currentOffset, currentOffset + PAGE_SIZE)
        setResults((prev) => [...prev, ...next])
        setOffset(currentOffset + next.length)
        setHasMore(currentOffset + next.length < mergedCacheRef.current.length)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Reset + initial load when modal opens ─────────────────────────────────

  useEffect(() => {
    if (!open) return
    setSearch('')
    setTypeFilter('all')
    setStatusFilter('all')
    setResults([])
    setOffset(0)
    setHasMore(false)
    mergedCacheRef.current = []
    setDraft(currentIds.map((id) => ({ id, type: '' })))
    loadFirst('', 'all', 'all')
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced refetch on search / type / status filter change ─────────────

  const isFirstRender = useRef(true)
  useEffect(() => {
    // Skip the initial trigger from the open effect's resets above
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setResults([])
      setOffset(0)
      setHasMore(false)
      mergedCacheRef.current = []
      loadFirst(search, typeFilter, statusFilter)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search, typeFilter, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset isFirstRender when modal closes so it's ready for next open
  useEffect(() => {
    if (!open) { isFirstRender.current = true }
  }, [open])

  // ── Infinite scroll ───────────────────────────────────────────────────────

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore(search, typeFilter, statusFilter, offset)
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, offset, search, typeFilter, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDraft(obj: ObjectRef) {
    setDraft((prev) => {
      const exists = prev.some((d) => d.id === obj.id)
      return exists ? prev.filter((d) => d.id !== obj.id) : [...prev, { id: obj.id, type: obj.type }]
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" showClose={false}>
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-sm font-semibold text-fg">
            {many ? 'Select objects' : 'Select object'}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pt-3 pb-2 space-y-2 border-b border-border">
          {/* Search */}
          <div className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search objects…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border transition"
            />
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                  statusFilter === f.value
                    ? 'bg-accent-strong text-white border-accent'
                    : 'bg-surface text-fg-muted border-border hover:border-border-strong hover:bg-surface-sunken',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Type filter dropdown (only when multiple types) */}
          {visibleTypes.length > 1 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-2.5 py-1.5 bg-surface text-fg outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border transition"
            >
              <option value="all">All types</option>
              {visibleTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>

        {/* Results list */}
        <div className="overflow-y-auto max-h-72">
          {results.length === 0 && !loading ? (
            <p className="text-sm text-fg-subtle text-center py-8">No objects found</p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((obj) => {
                const isSelected = many
                  ? draft.some((d) => d.id === obj.id)
                  : currentIds[0] === obj.id
                const updatedAt = obj.updated_at ?? obj.updatedAt

                return (
                  <li key={`${obj.type}-${obj.id}`}>
                    <button
                      type="button"
                      onClick={() => many ? toggleDraft(obj) : onSelectSingle(obj)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        isSelected ? 'bg-accent-muted' : 'hover:bg-surface-sunken',
                      )}
                    >
                      {many && (
                        <div className={clsx(
                          'size-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
                          isSelected ? 'bg-accent-strong border-accent' : 'border-border-strong bg-surface',
                        )}>
                          {isSelected && <IconCheck className="size-3 text-white" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={clsx(
                          'text-sm truncate',
                          isSelected ? 'font-medium text-accent-fg' : 'text-fg',
                        )}>
                          {obj.title ?? <span className="italic text-fg-subtle">{obj.id}</span>}
                        </p>
                        {updatedAt && (
                          <p className="text-[11px] text-fg-subtle mt-0.5">Updated {timeAgo(updatedAt)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {visibleTypes.length > 1 && <TypeBadge type={obj.type} />}
                        <StatusChip status={obj.status} />
                        <a
                          href={`/${workspaceId}/objects/${obj.type}/${obj.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded text-fg-faint hover:text-fg-muted hover:bg-surface-hover transition-colors"
                        >
                          <IconExternalLink className="size-3.5" />
                        </a>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Scroll sentinel + inline loader */}
          <div ref={sentinelRef} className="flex justify-center py-3">
            {loading && (
              <div className="flex items-center gap-2 text-fg-subtle">
                <IconLoader className="size-4 animate-spin" />
                <span className="text-xs">Loading…</span>
              </div>
            )}
          </div>
        </div>

        {many && (
          <DialogFooter className="px-4 py-3 border-t border-border flex justify-between items-center">
            <p className="text-xs text-fg-subtle">{draft.length} selected</p>
            <Button size="sm" onClick={() => { onSelectMany(draft); onOpenChange(false) }}>
              Done ({draft.length})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Public picker component ───────────────────────────────────────────────────

export function ObjectPicker({ workspaceId, include, value, onChange, many }: ObjectPickerProps) {
  const [open, setOpen] = useState(false)
  const [loadedItems, setLoadedItems] = useState<ObjectRef[]>([])

  const singleVal = (!many ? value : null) as ObjectValue
  const manyVal = (many ? (value ?? []) : []) as ObjectValues

  // Fetch display data for currently selected values
  useEffect(() => {
    const refs = many ? manyVal : singleVal ? [singleVal] : []
    if (refs.length === 0) { setLoadedItems([]); return }

    Promise.all(
      refs.map(async ({ id, type }) => {
        try {
          const r = await adminFetch<{ data: any }>(`/objects/${type}/${id}`)
          return { ...r.data, type } as ObjectRef
        } catch {
          return { id, type, title: id, status: 'unknown' } as ObjectRef
        }
      }),
    ).then(setLoadedItems)
  }, [JSON.stringify(many ? manyVal : singleVal)]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentIds = loadedItems.map((i) => i.id)

  if (!many) {
    const item = loadedItems[0] ?? null
    return (
      <>
        {item ? (
          <div className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 py-2 shadow-xs min-w-0">
            <span className="flex-1 text-sm text-fg truncate">{item.title ?? item.id}</span>
            <div className="flex items-center gap-1 shrink-0">
              <TypeBadge type={item.type} />
              <StatusChip status={item.status} />
              <a
                href={`/${workspaceId}/objects/${item.type}/${item.id}`}
                target="_blank" rel="noopener noreferrer"
                className="p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
              >
                <IconExternalLink className="size-3.5" />
              </a>
              <button type="button" onClick={() => setOpen(true)} className="p-1 rounded text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors">
                <IconLink className="size-3.5" />
              </button>
              <button type="button" onClick={() => { setLoadedItems([]); onChange(null) }} className="p-1 rounded text-fg-subtle hover:text-danger-fg hover:bg-danger-muted transition-colors">
                <IconX className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 w-full rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg hover:bg-surface-sunken transition-colors"
          >
            <IconPlus className="size-4 shrink-0" />
            Select object
          </button>
        )}
        <ObjectPickerModal
          open={open} onOpenChange={setOpen}
          include={include} workspaceId={workspaceId}
          many={false} currentIds={currentIds}
          onSelectSingle={(obj) => {
            setLoadedItems([obj])
            onChange({ id: obj.id, type: obj.type })
            setOpen(false)
          }}
          onSelectMany={() => {}}
        />
      </>
    )
  }

  return (
    <>
      {loadedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {loadedItems.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-surface-sunken border border-border text-fg max-w-[200px]"
            >
              <TypeBadge type={item.type} />
              <span className="truncate">{item.title ?? item.id}</span>
              <a
                href={`/${workspaceId}/objects/${item.type}/${item.id}`}
                target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-fg-faint hover:text-accent-fg transition-colors shrink-0"
              >
                <IconExternalLink className="size-3" />
              </a>
              <button
                type="button"
                onClick={() => {
                  const next = manyVal.filter((v) => v.id !== item.id)
                  setLoadedItems((prev) => prev.filter((i) => i.id !== item.id))
                  onChange(next)
                }}
                className="text-fg-subtle hover:text-danger-fg transition-colors shrink-0"
              >
                <IconX className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 w-full rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg hover:bg-surface-sunken transition-colors"
      >
        <IconPlus className="size-4 shrink-0" />
        Add objects
      </button>

      <ObjectPickerModal
        open={open} onOpenChange={setOpen}
        include={include} workspaceId={workspaceId}
        many={true} currentIds={currentIds}
        onSelectSingle={() => {}}
        onSelectMany={(selected) => {
          onChange(selected)
          Promise.all(
            selected.map(async ({ id, type }) => {
              const existing = loadedItems.find((i) => i.id === id)
              if (existing) return existing
              try {
                const r = await adminFetch<{ data: any }>(`/objects/${type}/${id}`)
                return { ...r.data, type } as ObjectRef
              } catch {
                return { id, type, title: id, status: 'unknown' } as ObjectRef
              }
            }),
          ).then(setLoadedItems)
        }}
      />
    </>
  )
}
