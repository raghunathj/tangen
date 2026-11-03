

import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconExternalLink, IconX, IconLoader,
  IconLink, IconPlus, IconCheck,
} from '@tangen/icons'
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectItem } from '@/components/ui/select'
import { StatusBadge } from '@/components/ui/status-badge'
import { adminFetch } from '@/lib/api'
import { timeAgo } from '@/lib/webhook-logs'
import { type RelationStatusFilter } from '@/lib/relation-picker'
import { useContentTypes } from '@/lib/use-content-types'
import { usePickableObjects } from '@/lib/use-pickable-objects'
import { pickableTypeNames, pickerSortFor } from '@/lib/pickable-objects'

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

const STATUS_FILTERS: { label: string; value: RelationStatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
  { label: 'Archived', value: 'archived' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

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
  many, current, onSelectSingle, onSelectMany,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  include: string[]
  workspaceId: string
  many: boolean
  /** The full refs, not just ids: see the note on `draft` below. */
  current: { id: string; type: string }[]
  onSelectSingle: (obj: ObjectRef) => void
  onSelectMany: (ids: { id: string; type: string }[]) => void
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RelationStatusFilter>('all')
  const [draft, setDraft] = useState<{ id: string; type: string }[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // An empty `include` means "any readable type", which the picker used to
  // render as NOTHING: `visibleTypes` was [] and every fetch returned early,
  // so a link field that declared no `allowedTargets` offered an empty list
  // and no way to choose a type. The workspace's own types are that list.
  const allTypes = useContentTypes()
  const pickableTypes = pickableTypeNames(include, allTypes)
  const labelOf = (name: string) => allTypes.find((t) => t.name === name)?.label ?? name

  // ONE type at a time, always, and no "All types".
  //
  // Across several types there is no honest page: each type has its own
  // offset, so a merged list can only be assembled by taking a fixed slice of
  // each and sorting what arrived. That is what this did - 50 per type - and
  // past 50 of any one type the rest were unreachable, the search covered
  // only what had been fetched, and the "pages" after the first walked a
  // cache rather than the data. A type filter that actually narrows is both
  // what makes paging correct and what the picker needed anyway.
  const [typeFilter, setTypeFilter] = useState('')
  const activeType = typeFilter || pickableTypes[0] || ''

  const { rows, loading, loadingMore, total, hasMore, loadMore, error } = usePickableObjects({
    typeName: activeType,
    search,
    enabled: open && activeType !== '',
    status: statusFilter === 'all' ? 'any' : statusFilter,
    sort: pickerSortFor(statusFilter),
  })

  useEffect(() => {
    if (!open) return
    setSearch('')
    setStatusFilter('all')
    setTypeFilter('')
    // The refs AS THEY ARE, with their types. Seeding this from ids alone
    // meant every entry the author did not re-tick was written back as
    // `{ id, type: '' }` on Done - a stored reference to a type that does not
    // exist, from simply opening the picker and confirming.
    setDraft(current.map((r) => ({ ...r })))
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll: the sentinel asks for the next page, and the hook ignores
  // the ask while a read is in flight or there is nothing left.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore() },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  function toggleDraft(obj: ObjectRef) {
    setDraft((prev) => {
      const exists = prev.some((d) => d.id === obj.id)
      return exists ? prev.filter((d) => d.id !== obj.id) : [...prev, { id: obj.id, type: obj.type }]
    })
  }

  const currentIds = current.map((r) => r.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `lg` is the documented picker size; `p-0` here never reached the body,
          because withDialogPadding wraps stray children in a DialogBody of its
          own - so the search block below carried that body's px-5 on top of
          its own px-4 and sat indented under a header that was not. */}
      <DialogContent size="lg" className="overflow-hidden" showClose={false}>
        {/* `pr-5` reclaims the room the primitive reserves for a close button
            this dialog does not render. */}
        <DialogHeader className="pr-5">
          <DialogTitle className="text-sm font-semibold text-fg">
            {many ? 'Select objects' : 'Select object'}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col p-0">
          <div className="shrink-0 space-y-2 border-b border-border-subtle px-5 py-3">
            {/* Type first: it decides what the search below searches. */}
            {pickableTypes.length > 1 && (
              <Select
                value={activeType}
                onValueChange={(v) => setTypeFilter(v)}
                aria-label="Type to pick from"
                className="w-full"
              >
                {pickableTypes.map((t) => (
                  <SelectItem key={t} value={t}>{labelOf(t)}</SelectItem>
                ))}
              </Select>
            )}

            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={activeType ? `Search ${labelOf(activeType)}\u2026` : 'Search\u2026'}
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
                    'rounded-control px-2.5 py-1 text-xs font-medium transition-colors motion-fast',
                    statusFilter === f.value
                      ? 'bg-accent-strong text-accent-contrast'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results list */}
          <div className="overflow-y-auto max-h-72">
            {error ? (
              <p role="alert" className="text-sm text-danger-fg text-center py-8">{error}</p>
            ) : pickableTypes.length === 0 && allTypes.length > 0 ? (
              <p className="text-sm text-fg-subtle text-center py-8">There are no content types to pick from.</p>
            ) : rows.length === 0 && !loading ? (
              <p className="text-sm text-fg-subtle text-center py-8">
                {search.trim() ? `Nothing matches \u201c${search.trim()}\u201d.` : 'No objects found'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((row) => {
                  const obj = { ...row, type: activeType } as unknown as ObjectRef
                  const isSelected = many
                    ? draft.some((d) => d.id === obj.id)
                    : currentIds[0] === obj.id
                  // The date the ORDER is by, so the list explains its own
                  // sequence instead of being sorted on one date and labelled
                  // with another.
                  const byPublished = statusFilter === 'published'
                  const stamp = byPublished
                    ? (row.published_at ?? row.publishedAt) as string | undefined
                    : (row.updated_at ?? row.updatedAt) as string | undefined

                  return (
                    <li key={obj.id}>
                      <button
                        type="button"
                        onClick={() => many ? toggleDraft(obj) : onSelectSingle(obj)}
                        className={clsx(
                          'w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors motion-fast',
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
                          {stamp && (
                            <p className="text-[11px] text-fg-subtle mt-0.5">
                              {byPublished ? 'Published' : 'Updated'} {timeAgo(stamp)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusBadge status={obj.status} />
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
              {(loading || loadingMore) && (
                <div className="flex items-center gap-2 text-fg-subtle">
                  <IconLoader className="size-4 animate-spin" />
                  <span className="text-xs">Loading…</span>
                </div>
              )}
            </div>
          </div>

          {/* What is on screen against what there is, so a first page of 50 out
              of 1,000 says so rather than reading as the whole list. */}
          {rows.length > 0 && total != null && (
            <p className="shrink-0 border-t border-border-subtle px-5 py-2 text-xs text-fg-subtle">
              Showing {rows.length} of {total}
              {hasMore ? '. Scroll for more, or search to narrow it down.' : '.'}
            </p>
          )}
        </DialogBody>

        {many && (
          <DialogFooter className="justify-between">
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

  // The refs the modal seeds its draft from. Full refs, because an id alone
  // loses the type and `Done` then wrote `{ id, type: '' }` back for every
  // entry the author did not re-tick.
  const currentRefs = loadedItems.map((i) => ({ id: i.id, type: i.type }))

  if (!many) {
    const item = loadedItems[0] ?? null
    return (
      <>
        {item ? (
          <div className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 py-2 shadow-xs min-w-0">
            <span className="flex-1 text-sm text-fg truncate">{item.title ?? item.id}</span>
            <div className="flex items-center gap-1 shrink-0">
              <TypeBadge type={item.type} />
              <StatusBadge status={item.status} />
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
          many={false} current={currentRefs}
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
        many={true} current={currentRefs}
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
