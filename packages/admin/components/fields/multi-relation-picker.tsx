

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  IconSearch, IconExternalLink, IconX, IconLoader,
  IconPlus, IconCheck, IconDragMove, IconRefresh,
} from '@tangen/icons'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { adminFetch } from '@/lib/api'
import { timeAgo } from '@/lib/webhook-logs'
import {
  buildRelationQuery, statusBadge, toggleId,
  type RelationStatusFilter,
} from '@/lib/relation-picker'
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

function StatusChip({ status }: { status: string }) {
  const { label, className } = statusBadge(status)
  return (
    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', className)}>
      {label}
    </span>
  )
}

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
      <StatusChip status={obj.status} />
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
  const [results, setResults] = useState<RelationObject[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  // Local draft selection — confirmed only when user clicks Done
  const [draft, setDraft] = useState<string[]>(selectedIds)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastFetchRef = useRef<{ key: string; at: number }>({ key: '', at: 0 })

  const fetchResults = useCallback(async (q: string, sf: RelationStatusFilter) => {
    // The open effect and the debounced search effect both fire on open with
    // the same args (and StrictMode double-invokes effects in dev) - identical
    // calls within 400ms collapse to one request.
    const key = `${q} ${sf}`
    const now = Date.now()
    if (lastFetchRef.current.key === key && now - lastFetchRef.current.at < 400) return
    lastFetchRef.current = { key, at: now }
    setLoading(true)
    try {
      const body = buildRelationQuery(targetType, q, sf, 0, filter)
      const res = await adminFetch<{ data: RelationObject[]; meta: { total: number } }>(
        `/objects/${targetType}/query`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      setResults(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch {
      setResults([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [targetType, filter])

  useEffect(() => {
    if (!open) return
    setSearch('')
    setStatusFilter('all')
    setDraft(selectedIds)
    fetchResults('', 'all')
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => fetchResults(search, statusFilter), 200)
    return () => clearTimeout(t)
  }, [search, statusFilter, open, fetchResults])

  const draftCount = draft.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" showClose={false}>
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
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
                onClick={() => fetchResults(search, statusFilter)}
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
                  title={`Create a new ${displayLabel} in a new tab, then Reload here`}
                  className="flex items-center gap-1 text-xs font-medium text-accent-fg hover:text-accent-fg transition-colors"
                >
                  <IconPlus className="size-3.5" />
                  New {displayLabel}
                </a>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Search + filter */}
        <div className="px-4 pt-3 pb-2 space-y-2.5 border-b border-border">
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
        </div>

        {/* Results */}
        <div className="overflow-y-auto max-h-64">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-fg-subtle">
              <IconLoader className="size-5 animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : results.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-8">No results found</p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((obj) => {
                const isChecked = draft.includes(obj.id)
                const updatedAt = obj.updated_at ?? obj.updatedAt
                const detailHref = workspaceId
                  ? `/${workspaceId}/objects/${targetType}/${obj.id}`
                  : null

                return (
                  <li key={obj.id}>
                    <button
                      type="button"
                      onClick={() => setDraft((prev) => toggleId(prev, obj.id))}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
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
                        {isChecked && <IconCheck className="size-3 text-white" />}
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
                        <StatusChip status={obj.status} />
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface-sunken">
          <span className="text-xs text-fg-subtle">
            {total > results.length
              ? `Showing ${results.length} of ${total} - refine search to narrow`
              : total > 0
                ? `${total} result${total !== 1 ? 's' : ''}`
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
        </div>
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
