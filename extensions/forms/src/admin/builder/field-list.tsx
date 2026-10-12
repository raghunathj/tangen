/**
 * File Name: field-list.tsx
 * Purpose: The builder's left pane: the fields of the form (or of the active
 *          step) as a sortable list. One row per field: its type icon, label,
 *          type and a required mark; drag to reorder, click to inspect,
 *          remove from the row's trailing action.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconTrash } from '@tangen/icons'
import { Button, EmptyState, cx } from '@/kit'
import type { FormField } from '../../contract'
import { fieldTypeConfig } from '../field-types'

function Grip() {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-2 gap-x-0.5 gap-y-0.5 text-fg-faint">
      {Array.from({ length: 6 }).map((_, i) => <span key={i} className="size-[3px] rounded-full bg-current" />)}
    </span>
  )
}

function Row({ field, selected, readOnly, onSelect, onRemove }: {
  field: FormField
  selected: boolean
  readOnly: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, disabled: readOnly })
  const config = fieldTypeConfig(field.type)
  const Icon = config?.icon
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      data-testid="form-field-row"
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'group flex items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors motion-fast cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        isDragging && 'relative z-10 shadow-raised',
        selected ? 'border-accent/40 bg-accent-muted/40' : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className={cx('flex h-6 w-4 items-center justify-center', readOnly ? 'invisible' : 'cursor-grab active:cursor-grabbing')}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <Grip />
      </span>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-fg-muted">
        {Icon ? <Icon className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui-sm font-medium text-fg">
          {field.label || <span className="text-fg-subtle">Untitled</span>}
          {field.required && <span className="ml-0.5 text-danger" title="Required">*</span>}
        </span>
        <span className="block truncate text-ui-xs text-fg-subtle">{config?.label ?? field.type}{field.width === 'half' ? ' · half width' : ''}</span>
      </span>
      {!readOnly && (
        <Button
          size="xs" variant="ghost" aria-label={`Remove ${field.label || 'field'}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          <IconTrash className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

export function FieldList({ fields, allFields, selectedId, readOnly, onSelect, onRemove, onReorder, empty }: {
  /** The fields on screen (the active step's, or all). */
  fields: FormField[]
  allFields: FormField[]
  selectedId: string | null
  readOnly: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onReorder: (next: FormField[]) => void
  empty: React.ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = allFields.findIndex((f) => f.id === active.id)
    const to = allFields.findIndex((f) => f.id === over.id)
    if (from < 0 || to < 0) return
    const next = [...allFields]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    onReorder(next)
  }
  if (fields.length === 0) {
    return <EmptyState align="center" title="No fields yet" description="Add the first field below, then shape it on the right." action={empty} />
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {fields.map((f) => (
            <Row key={f.id} field={f} selected={f.id === selectedId} readOnly={readOnly} onSelect={() => onSelect(f.id)} onRemove={() => onRemove(f.id)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
