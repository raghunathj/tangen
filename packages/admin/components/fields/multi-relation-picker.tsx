

import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconExternalLink, IconX, IconLoader,
  IconPlus, IconCheck, IconDragMove, IconRefresh,
} from '@tangen/icons'
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { adminFetch } from '@/lib/api'
import { timeAgo } from '@/lib/webhook-logs'
import { singularLabel } from '@tangen/types'
import {
  toggleId,
  type RelationStatusFilter,
} from '@/lib/relation-picker'
import { usePickableObjects } from '@/lib/use-pickable-objects'
import { pickerSortFor } from '@/lib/pickable-objects'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RelationObject {
  id: string
  title: string | null
  status: string
  updatedAt?: string
  updated_at?: string
}

export interface MultiRelationPickerProps {
  /** config.filter — restricts selectable target entries (server re-validates on write). */
  filter?: Record<string, unknown>
  targetType: string
  value: string[]
  onChange: (ids: string[]) => void
  workspaceId?: string
  /** Field label — shown in the trigger/modal copy instead of the raw target type. */
  label?: string
}

// ── Status chip ───────────────────────────────────────────────────────────────

// ── Selected pill ─────────────────────────────────────────────────────────────

function SelectedPill({
  obj,
  targetType,
  workspaceId,
  onRemove,
  dragHandleProps,
}: {
  obj: RelationObject
  targetType: string
  workspaceId?: string
  onRemove: () => void
  dragHandleProps?: Record<string, unknown>
}) {
  const detailHref = workspaceId
    ? `/${workspaceId}/objects/${targetType}/${obj.id}`
    : null

  return (
    <span className="inline-flex items-center gap-1.5 pl-1.5 pr-1.5 py-1 rounded-full border border-border bg-surface text-sm text-fg shadow-xs max-w-xs">
      <span
        {...(dragHandleProps as any)}
        className="text-fg-faint hover:text-fg-muted cursor-grab active:cursor-grabbing transition-colors shrink-0"
        title="Drag to reorder"
      >
        <IconDragMove className="size-3.5" />
      </span>
      <span className="truncate">{obj.title ?? obj.id}</span>
      <StatusBadge status={obj.status} />
      {detailHref && (
        <a
          href={detailHref}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in new tab"
          onClick={(e) => e.stopPropagation()}
          className="text-fg-faint hover:text-fg-muted transition-colors"
        >
          <IconExternalLink className="size-3" />
        </a>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="text-fg-faint hover:text-danger-fg transition-colors rounded-full"
      >
        <IconX className="size-3.5" />
      </button>
    </span>
  )
}

function SortableSelectedPill(props: {
  id: string
  obj: RelationObject
  targetType: string
  workspaceId?: string
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SelectedPill
        obj={props.obj}
        targetType={props.targetType}
        workspaceId={props.workspaceId}
        onRemove={props.onRemove}
        dragHandleProps={listeners}
      />
    </div>
  )
}

// ── Status filter tabs ────────────────────────────────────────────────────────

const STATUS_FILTERS: { label: string; value: RelationStatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
  { label: 'Archived', value: 'archived' },
]

// ── Picker modal ──────────────────────────────────────────────────────────────

function PickerModal({
  open,
  onOpenChange,
  targetType,
  displayLabel,
  workspaceId,
  selectedIds,
  onConfirm,
  filter,
}: {
  open: boolean
  filter?: Record<string, unknown>
  onOpenChange: (v: boolean) => void
  targetType: string
  displayLabel: string
  workspaceId?: string
  selectedIds: string[]
  onConfirm: (ids: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<RelationStatusFilter>('all')
  // Local draft selection — confirmed only when user clicks Done
  const [draft, setDraft] = useState<string[]>(selectedIds)
  const searchRef = useRef<HTMLInputElement>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)

  // Searching, filtering, ordering and paging are the server's, through the
  // same engine the single-relation and object pickers use. This modal used to
  // ask for 20 rows at offset 0 and never ask again: its own footer read
  // "Showing 20 of 1,000 - refine search to narrow", which names the problem
  // and leaves row 21 unreachable.
  const { rows, loading, loadingMore, total, hasMore, loadMore, refresh, error } = usePickableObjects({
    typeName: targetType,
    search,
    enabled: open,
    status: statusFilter === 'all' ? 'any' : statusFilter,
    sort: pickerSortFor(statusFilter),
    filter,
  })

  useEffect(() => {
    if (!open) return
    setSearch('')
    setStatusFilter('all')
    setDraft(selectedIds)
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

  const draftCount = draft.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `lg` is the size this design system documents for pickers. The old
          `max-w-lg` fought that prop and produced a 512px dialog that a title,
          two actions, a status chip and a timestamp had to share. */}
      <DialogContent size="lg" className="overflow-hidden" showClose={false}>
        {/* `pr-5` reclaims the primitive's `pr-12`, which reserves room for a
            close button this dialog does not render. */}
        <DialogHeader className="pr-5">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-baseline gap-2 text-sm font-semibold text-fg">
              Select {displayLabel}
              {draftCount > 0 && (
                <span className="text-xs font-normal text-accent-fg">{draftCount} selected</span>
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
              {workspaceId && (
                <a
                  href={`/${workspaceId}/objects/${targetType}/new`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Create a new ${singularLabel(displayLabel)} in a new tab, then Reload here`}
                  className="flex items-center gap-1 text-xs font-medium text-accent-fg hover:text-accent-fg transition-colors"
                >
                  <IconPlus className="size-3.5" />
                  New {singularLabel(displayLabel)}
                </a>
              )}
            </div>
          </div>
        </DialogHeader>

      <DialogBody className="flex flex-col p-0">
          {/* Search + filter */}
          <div className="shrink-0 space-y-2.5 border-b border-border-subtle px-5 py-3">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
                placeholder={`Search ${displayLabel}…`}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border transition"
              />
            </div>
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

          {/* Results. A fixed minimum so switching filter does not resize the
              dialog under the pointer, which it did on every empty result. */}
          <div className="min-h-56 max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex min-h-56 items-center justify-center gap-2 text-fg-subtle">
                <IconLoader className="size-4 animate-spin" />
                <span className="text-ui-sm">Loading…</span>
              </div>
            ) : error ? (
              <div className="flex min-h-56 items-center justify-center px-5 text-center">
                <p className="text-ui-sm text-danger-fg">{error}</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-1 px-5 text-center">
                <p className="text-ui-sm text-fg-muted">No {displayLabel.toLowerCase()} found</p>
                <p className="text-xs text-fg-subtle">
                  {search ? 'Try a different search.' : 'Create one with New above, then Reload.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((obj) => {
                  const isChecked = draft.includes(obj.id)
                  // A row carries whatever the read returned, so the two
                  // spellings of the timestamp are both read and narrowed here.
                  const updatedAt = (obj.updated_at ?? obj.updatedAt) as string | undefined
                  const rowStatus = typeof obj.status === 'string' ? obj.status : 'unknown'
                  const detailHref = workspaceId
                    ? `/${workspaceId}/objects/${targetType}/${obj.id}`
                    : null

                  return (
                    <li key={obj.id}>
                      <button
                        type="button"
                        onClick={() => setDraft((prev) => toggleId(prev, obj.id))}
                        className={clsx(
                          'w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors motion-fast',
                          isChecked ? 'bg-accent-muted' : 'hover:bg-surface-sunken',
                        )}
                      >
                        {/* Checkbox */}
                        <span className={clsx(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          isChecked
                            ? 'bg-accent-strong border-accent'
                            : 'border-border-strong bg-surface',
                        )}>
                          {isChecked && <IconCheck className="size-3 text-accent-contrast" />}
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            'text-sm truncate',
                            isChecked ? 'font-medium text-accent-fg' : 'text-fg',
                          )}>
                            {obj.title ?? <span className="italic text-fg-subtle">{obj.id}</span>}
                          </p>
                          {updatedAt && (
                            <p className="text-[11px] text-fg-subtle mt-0.5">
                              Updated {timeAgo(updatedAt)}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge status={rowStatus} />
                          {detailHref && (
                            <a
                              href={detailHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in new tab"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 rounded text-fg-faint hover:text-fg-muted hover:bg-surface-hover transition-colors"
                            >
                              <IconExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Scroll sentinel: reaching the end of the list asks for the next
                page, so the whole set is reachable by scrolling. */}
            <div ref={sentinelRef} className="flex justify-center py-3">
              {loadingMore && (
                <div className="flex items-center gap-2 text-fg-subtle">
                  <IconLoader className="size-4 animate-spin" />
                  <span className="text-xs">Loading…</span>
                </div>
              )}
            </div>
          </div>

      </DialogBody>

      <DialogFooter className="justify-between">
        <span className="text-xs text-fg-subtle">
          {rows.length > 0 && total != null
            ? `Showing ${rows.length} of ${total}${hasMore ? '. Scroll for more.' : '.'}`
            : ''}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => { onConfirm(draft); onOpenChange(false) }}>
            Done{draftCount > 0 ? ` (${draftCount})` : ''}
          </Button>
        </div>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function MultiRelationPicker({ targetType, value, onChange, workspaceId, label , filter }: MultiRelationPickerProps) {
  const ids: string[] = Array.isArray(value) ? value : []
  const displayLabel = label?.trim() || (targetType.charAt(0).toUpperCase() + targetType.slice(1))
  const [open, setOpen] = useState(false)
  const [loadedObjects, setLoadedObjects] = useState<Map<string, RelationObject>>(new Map())

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Load any IDs we don't have objects for yet
  useEffect(() => {
    const missing = ids.filter((id) => !loadedObjects.has(id))
    if (missing.length === 0) return
    Promise.all(
      missing.map((id) =>
        adminFetch<{ data: RelationObject }>(`/objects/${targetType}/${id}`)
          .then((r) => r.data)
          .catch(() => ({ id, title: null, status: 'unknown' } as RelationObject)),
      ),
    ).then((objs) => {
      setLoadedObjects((prev) => {
        const next = new Map(prev)
        for (const obj of objs) next.set(obj.id, obj)
        return next
      })
    })
  }, [ids.join(','), targetType]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRemove(id: string) {
    onChange(ids.filter((x) => x !== id))
  }

  function handleConfirm(newIds: string[]) {
    onChange(newIds)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex !== -1 && newIndex !== -1) {
      onChange(arrayMove(ids, oldIndex, newIndex))
    }
  }

  return (
    <div className="space-y-2">
      {/* Selected pills with drag-to-reorder */}
      {ids.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap gap-1.5">
              {ids.map((id) => {
                const obj = loadedObjects.get(id) ?? { id, title: null, status: 'unknown' }
                return (
                  <SortableSelectedPill
                    key={id}
                    id={id}
                    obj={obj}
                    targetType={targetType}
                    workspaceId={workspaceId}
                    onRemove={() => handleRemove(id)}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 w-full rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg hover:bg-surface-sunken transition-colors"
      >
        <IconPlus className="size-4 shrink-0" />
        {ids.length === 0 ? `Select ${displayLabel}` : `Add ${displayLabel}`}
      </button>

      <PickerModal
        filter={filter}
        open={open}
        onOpenChange={setOpen}
        targetType={targetType}
        displayLabel={displayLabel}
        workspaceId={workspaceId}
        selectedIds={ids}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
