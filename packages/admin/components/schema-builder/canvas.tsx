/**
 * File Name: canvas.tsx
 * Purpose: SB-3 — the Content Object Builder field canvas, laid out to mirror the
 *   content editor it configures: a wide Main column + a narrow right Sidebar
 *   column (the two editorView stages). Read-only, non-movable system fields sit
 *   at the top; user fields are draggable cards with per-field width. Each stage
 *   has its own add-field menu. Controlled — the page owns the reducer state.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useMemo, useRef, useState, type Dispatch } from 'react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import {
  IconText, IconPlus, IconLock, IconGripDots, IconCheck,
} from '@tangen/icons'
import type { BuilderModel, BuilderField, BuilderAction, Stage, Width } from '@/lib/schema-builder-model'
import { FieldConfigSheet } from './field-config-sheet'
import { ContainerModal } from './container-modal'
import { ConfirmX } from './confirm-x'
import { AddFieldModal } from './add-field-modal'
import { ICON_FOR } from './field-types'
import { IconWarning, IconCopy } from '@tangen/icons'
import { newKey, validateBuilderField, validateSubFields, validateComponentRefs } from '@/lib/schema-builder-model'
import { Badge, Button, Menu, MenuTrigger, MenuContent, MenuItem } from '@/kit'

/** System fields every content type has — shown read-only, non-movable. */
const SYSTEM_FIELDS: { name: string; label: string }[] = [
  { name: 'title', label: 'Title' },
  { name: 'slug', label: 'Slug' },
  { name: 'status', label: 'Status' },
  { name: 'createdAt', label: 'Created at' },
  { name: 'updatedAt', label: 'Updated at' },
]

const WIDTHS: Width[] = ['full', 'half', 'third']

// ── Add-field button (opens the Add Field modal) ──────────────────────────────
function AddFieldButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <Button size="sm" variant="secondary" onClick={onClick} icon={<IconPlus className="size-3.5" />}>{label}</Button>
}

// ── System (read-only, non-movable) field row ─────────────────────────────────
function SystemFieldRow({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2 opacity-90">
      <IconLock className="size-3.5 text-fg-subtle shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-sm text-fg-muted">{label}</span>
        <span className="ml-2 font-mono text-xs text-fg-subtle">{name}</span>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">system</span>
    </div>
  )
}

/** Grid width class so a card physically occupies its full/half/third slot. */
const WIDTH_CLASS: Record<Width, string> = {
  full: 'w-full',
  half: 'w-[calc(50%-0.25rem)]',
  third: 'w-[calc(33.333%-0.334rem)]',
}

const WIDTH_LABEL: Record<Width, string> = { full: 'Full width', half: 'Half', third: 'Third' }
const WIDTH_PCT: Record<Width, string> = { full: '100%', half: '50%', third: '33%' }

/** A little proportion bar showing how much width the field takes. */
function WidthBar({ width }: { width: Width }) {
  return (
    <span className="inline-block w-6 h-2 rounded-[2px] bg-border-strong/30 overflow-hidden shrink-0">
      <span className="block h-full rounded-[2px] bg-current" style={{ width: WIDTH_PCT[width] }} />
    </span>
  )
}

/** Width picker styled like the dashboard "change column width" control. */
function FieldWidthControl({ value, onChange }: { value: Width; onChange: (w: Width) => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="xs" variant="secondary" title="Change field width" aria-label="Change field width" className="shrink-0 px-1.5"><WidthBar width={value} /></Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-40">
        {WIDTHS.map((w) => (
          <MenuItem key={w} onSelect={() => onChange(w)}>
            <WidthBar width={w} />
            <span className="flex-1">{WIDTH_LABEL[w]}</span>
            {value === w && <IconCheck className="size-3.5" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

// ── Draggable user field card ─────────────────────────────────────────────────
const CONTAINER_TYPES = new Set(['repeater', 'component', 'group'])

function FieldCard({ field, onWidth, onRemove, onEdit, onManageFields, onDuplicate, grid, hasError = false }: {
  field: BuilderField; onWidth: (w: Width) => void; onRemove: () => void; onEdit: () => void
  onManageFields?: () => void; onDuplicate?: () => void; grid: boolean; hasError?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key })
  const Icon = ICON_FOR[field.fieldType] ?? IconText
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('rounded-lg border bg-surface px-3 py-2.5', hasError ? 'border-danger/40' : 'border-border', grid ? WIDTH_CLASS[field.width] : 'w-full', isDragging && 'opacity-50 z-10', field.disabled && 'opacity-55')}
    >
      <div className="flex items-center gap-2">
        <button {...attributes} {...listeners} className="cursor-grab text-fg-subtle hover:text-fg-muted shrink-0" aria-label="Drag">
          <IconGripDots className="size-3.5" />
        </button>
        <Icon className="size-4 text-fg-subtle shrink-0" />
        {hasError && (
          <span title="This field has problems - Apply will refuse" className="shrink-0 flex">
            <IconWarning className="size-3.5 text-danger-fg" />
          </span>
        )}
        <Button variant="ghost" onClick={onEdit} title="Edit field" className="group h-auto min-w-0 flex-1 flex-col items-start gap-0 px-1 py-0.5 text-left font-normal">
          <span className="flex w-full items-center gap-2 truncate text-ui-sm text-fg group-hover:text-accent-fg">
            {field.label}
            {field.disabled && <Badge variant="warning">Disabled</Badge>}
          </span>
          <span className="w-full truncate text-left text-ui-xs text-fg-muted">{field.name} · {field.fieldType}</span>
        </Button>
        {CONTAINER_TYPES.has(field.fieldType) && onManageFields && (
          <Button size="xs" variant="secondary" onClick={onManageFields} disabled={!field.label.trim()} className="shrink-0"
            title={!field.label.trim() ? 'Give the field a label first' : field.fieldType === 'component' ? 'Manage inline components' : 'Manage the fields inside this container'}>
            Manage Fields
          </Button>
        )}
        {onDuplicate && (
          <Button size="xs" variant="ghost" onClick={onDuplicate} title="Duplicate field" aria-label="Duplicate field" className="size-6 shrink-0 p-0" icon={<IconCopy className="size-3.5" />} />
        )}
        {grid && <FieldWidthControl value={field.width} onChange={onWidth} />}
        <ConfirmX onConfirm={onRemove} title="Remove field" />
      </div>
    </div>
  )
}

function StageZone({ stage, fields, dispatch, grid, onEdit, onAddClick, onManageFields, errorKeys }: {
  stage: Stage; fields: BuilderField[]; dispatch: Dispatch<BuilderAction>; grid: boolean
  onEdit: (key: string) => void; onAddClick: () => void; onManageFields?: (key: string) => void
  errorKeys?: Set<string>
}) {
  return (
    <SortableContext items={fields.map((f) => f.key)} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
      <div
        data-stage={stage}
        className={clsx(
          'min-h-24 rounded-lg border border-dashed border-border bg-surface-sunken/40 p-2',
          grid ? 'flex flex-wrap gap-2 content-start' : 'flex flex-col gap-2',
        )}
      >
        {fields.length === 0 && (
          <div className="w-full flex justify-center py-8">
            <AddFieldButton label="Add Field" onClick={onAddClick} />
          </div>
        )}
        {fields.map((f) => (
          <FieldCard
            key={f.key}
            field={f}
            grid={grid}
            onWidth={(w) => dispatch({ type: 'SET_WIDTH', key: f.key, width: w })}
            onRemove={() => dispatch({ type: 'REMOVE_FIELD', key: f.key })}
            onManageFields={onManageFields ? () => onManageFields(f.key) : undefined}
            onDuplicate={() => dispatch({ type: 'DUPLICATE_FIELD', key: f.key })}
            hasError={errorKeys?.has(f.key) ?? false}
            onEdit={() => onEdit(f.key)}
          />
        ))}
      </div>
    </SortableContext>
  )
}

export function SchemaBuilderCanvas({ model, dispatch, singleStage }: {
  model: BuilderModel
  dispatch: Dispatch<BuilderAction>
  /** Components have no Main/Sidebar split — render a single full-width field list. */
  singleStage?: boolean
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [addStage, setAddStage] = useState<Stage | null>(null)
  const [managingKey, setManagingKey] = useState<string | null>(null)

  // Live error map — red border + warning icon on cards whose field (or container
  // subtree) wouldn't pass Apply Schema. Mirrors validateBuilderModel's walk.
  const errorKeys = useMemo(() => {
    const bad = new Set<string>()
    const seen = new Set<string>()
    for (const f of [...model.main, ...model.sidebar]) {
      const own = validateBuilderField(f, seen)
      if (f.name?.trim()) seen.add(f.name)
      const cfg = (f.config ?? {}) as Record<string, unknown>
      const sub = f.fieldType === 'repeater' ? validateSubFields(cfg.fields as never)
        : f.fieldType === 'group' ? validateSubFields(cfg.groupFields as never)
        : f.fieldType === 'component' ? validateComponentRefs(cfg.components as never)
        : []
      if (own.length > 0 || sub.length > 0) bad.add(f.key)
    }
    return bad
  }, [model])
  const editing = editingKey ? [...model.main, ...model.sidebar].find((f) => f.key === editingKey) ?? null : null
  // Width is only meaningful in the Main stage — hide it in the Sheet for sidebar fields.
  const editingInMain = !!editingKey && model.main.some((f) => f.key === editingKey)

  function onDragEnd(e: DragEndEvent) {
    const activeKey = String(e.active.id)
    if (!e.over) return
    const overKey = String(e.over.id)
    const overContainer = (e.over.data.current as any)?.sortable?.containerId
    const toStage: Stage = model.main.some((f) => f.key === overKey) ? 'main'
      : model.sidebar.some((f) => f.key === overKey) ? 'sidebar'
      : (overContainer as Stage) ?? (model.main.some((f) => f.key === activeKey) ? 'main' : 'sidebar')
    const target = model[toStage]
    const overIndex = target.findIndex((f) => f.key === overKey)
    dispatch({ type: 'MOVE_FIELD', key: activeKey, toStage, toIndex: overIndex === -1 ? target.length : overIndex })
  }

  function addField(fieldType: string, stage: Stage) {
    // Start EMPTY — nobody wants to clear "text_1" before typing the real label. The
    // Sheet opens straight onto the new field with the Label input ready.
    const key = newKey()
    dispatch({ type: 'ADD_FIELD', fieldType, name: '', label: '', stage, key })
    setEditingKey(key)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="flex flex-1 min-h-0 bg-surface-sunken">
        {/* Main column */}
        <div className="flex-1 overflow-y-auto px-8 pt-6 pb-8 bg-surface min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-fg-muted uppercase tracking-wide">{singleStage ? 'Fields' : 'Main'}</div>
            <AddFieldButton label={singleStage ? 'Add Field' : 'Add Field To Main Stage'} onClick={() => setAddStage('main')} />
          </div>
          {/* Title first, the editable dropzone, then the remaining system fields -
              mirrors the entry editor's visual order. */}
          {!singleStage && <SystemFieldRow {...SYSTEM_FIELDS[0]} />}
          <StageZone stage="main" fields={model.main} dispatch={dispatch} grid onEdit={setEditingKey} onAddClick={() => setAddStage('main')} onManageFields={setManagingKey} errorKeys={errorKeys} />
          <div className="flex justify-center">
            <AddFieldButton label={singleStage ? 'Add Field' : 'Add Field To Main Stage'} onClick={() => setAddStage('main')} />
          </div>
          {!singleStage && (
            <div className="flex flex-col gap-2">
              {SYSTEM_FIELDS.slice(1).map((f) => <SystemFieldRow key={f.name} {...f} />)}
            </div>
          )}
        </div>

        {/* Sidebar column - content types only */}
        {!singleStage && (
          <aside className="w-80 shrink-0 border-l border-border bg-surface px-5 pt-6 pb-8 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-fg-muted uppercase tracking-wide">Sidebar</div>
              <AddFieldButton label="Add Field To Sidebar" onClick={() => setAddStage('sidebar')} />
            </div>
            <StageZone stage="sidebar" fields={model.sidebar} dispatch={dispatch} grid={false} onEdit={setEditingKey} onAddClick={() => setAddStage('sidebar')} onManageFields={setManagingKey} errorKeys={errorKeys} />
          </aside>
        )}
      </div>

      <AddFieldModal
        open={addStage !== null}
        onOpenChange={(o) => { if (!o) setAddStage(null) }}
        onPick={(t) => { if (addStage) addField(t, addStage) }}
      />

      {(() => {
        const managed = [...model.main, ...model.sidebar].find((f) => f.key === managingKey)
        if (!managed) return null
        if (managed.fieldType === 'component') {
          return (
            <ContainerModal
              open
              mode="components"
              title={`Components - ${managed.label || managed.name}`}
              schemaLabel={model.label || model.name}
              entryFields={[...model.main, ...model.sidebar].map((x) => ({ name: x.name, label: x.label, fieldType: x.fieldType, config: x.config }))}
              config={managed.config}
              onConfigChange={(config) => dispatch({ type: 'UPDATE_FIELD', key: managed.key, patch: { config } })}
              onClose={() => setManagingKey(null)}
            />
          )
        }
        const cfgKey = managed.fieldType === 'group' ? 'groupFields' : 'fields'
        return (
          <ContainerModal
            open
            mode="fields"
            title={`${managed.fieldType === 'group' ? 'Grouped fields' : 'Row fields'} - ${managed.label || managed.name}`}
            value={(managed.config?.[cfgKey] ?? []) as never}
            onValueChange={(next) => dispatch({ type: 'UPDATE_FIELD', key: managed.key, patch: { config: { ...managed.config, [cfgKey]: next } } })}
            onClose={() => setManagingKey(null)}
          />
        )
      })()}
      <FieldConfigSheet
        field={editing}
        showWidth={editingInMain}
        checkReserved={!singleStage}
        onManageFields={editingKey ? () => setManagingKey(editingKey) : undefined}
        allFields={[...model.main, ...model.sidebar]}
        onChange={(patch) => { if (editingKey) dispatch({ type: 'UPDATE_FIELD', key: editingKey, patch }) }}
        onClose={() => setEditingKey(null)}
      />
    </DndContext>
  )
}
