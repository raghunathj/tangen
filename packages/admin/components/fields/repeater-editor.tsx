

import { useState, lazy, Suspense } from 'react'
import { isLocalizableFieldType } from '@tangen/types'
import { useParams } from 'react-router-dom'
import { ConfirmTrash } from './confirm-trash'
import { DatePicker } from '@/components/ui/date-picker'
import { clsx } from 'clsx'
import { nestedLocaleCtx, type BlockLocaleCtx } from '@/lib/editor'
import * as Switch from '@radix-ui/react-switch'
import {
  IconArrowUp, IconArrowDown, IconTrash, IconGripDots, IconPlus,
  IconChevronDown, IconChevronRight,
} from '@tangen/icons'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Select, SelectItem } from '@/components/ui/select'
import type { SubField } from '@tangen/types'

// ── Data helpers ──────────────────────────────────────────────────────────────

export interface RepeaterItem {
  _key: string
  [field: string]: unknown
}

function randomKey() {
  return Math.random().toString(36).slice(2, 10)
}

function buildEmptyItem(fields: SubField[]): RepeaterItem {
  const item: RepeaterItem = { _key: randomKey() }
  for (const f of fields) item[f.name] = null
  return item
}

function buildPreview(item: RepeaterItem, fields: SubField[]): string {
  const SKIP = new Set(['richtext', 'media', 'relation', 'component', 'repeater'])
  const parts: string[] = []
  for (const f of fields) {
    if (parts.length >= 3) break
    if (SKIP.has(f.fieldType)) continue
    const raw = item[f.name]
    if (raw == null || raw === '') continue
    const str = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw)
    parts.push(str.length > 50 ? str.slice(0, 50) + '…' : str)
  }
  return parts.join(' · ')
}

// ── Sub-field control ─────────────────────────────────────────────────────────

const subInput = 'w-full appearance-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border'

const FullFieldControl = lazy(() => import('./field-control').then((m) => ({ default: m.FieldControl })))

/**
 * Row fields beyond the compact switch (media, richtext, relations, nested
 * component blocks/repeaters) delegate to the REAL FieldControl — the server
 * fully supports them in repeater rows, so the editor must too.
 */
function DelegatedSubControl({ field, value, onChange, localeCtx }: { field: SubField; value: unknown; onChange: (v: unknown) => void; localeCtx?: BlockLocaleCtx }) {
  const params = useParams<{ workspaceId: string }>()
  return (
    <Suspense fallback={null}>
      <FullFieldControl field={{ ...field, config: field.config ?? {} } as never} value={value} onChange={onChange} workspaceId={params.workspaceId!} blockLocaleCtx={localeCtx} />
    </Suspense>
  )
}

/** A row field whose translations live as a nested map under this row's entry. */
const isContainerSub = (f: SubField): boolean => f.fieldType === 'component' || f.fieldType === 'repeater'

function SubFieldControl({ field, value, onChange, localeCtx }: {
  field: SubField
  value: unknown
  onChange: (v: unknown) => void
  /** Already scoped to THIS row field's slot (`overlay[row._key][field]`) - only set for container row fields. */
  localeCtx?: BlockLocaleCtx
}) {
  switch (field.fieldType) {
    case 'textarea':
      return (
        <textarea
          rows={3}
          value={(value as string) ?? ''}
          placeholder={field.config?.admin?.placeholder}
          onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          className={subInput + ' resize-none'}
        />
      )
    case 'number':
      return (
        <input
          type="number"
          value={value == null ? '' : String(value)}
          min={field.config?.validation?.min}
          max={field.config?.validation?.max}
          step={field.config?.validation?.integer ? 1 : 'any'}
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).value
            onChange(v === '' ? null : Number(v))
          }}
          className={subInput}
        />
      )
    case 'boolean':
      return (
        <Switch.Root
          aria-label={field.label}
          checked={(value as boolean) ?? false}
          onCheckedChange={onChange}
          className="relative flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-surface-hover transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25 focus:ring-offset-2 data-[state=checked]:bg-accent-strong"
        >
          <Switch.Thumb className="pointer-events-none block h-5 w-5 translate-x-0 rounded-full bg-surface shadow ring-0 transition-transform data-[state=checked]:translate-x-5" />
        </Switch.Root>
      )
    case 'date':
      return (
        <DatePicker
          value={(value as string) || undefined}
          onChange={(v) => onChange(v ?? null)}
        />
      )
    case 'select': {
      const opts = field.config?.options ?? []
      return (
        <Select value={(value as string) ?? ''} onValueChange={onChange}>
          <SelectItem value="">- select -</SelectItem>
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </Select>
      )
    }
    case 'multiselect': {
      const opts = field.config?.options ?? []
      const current: string[] = Array.isArray(value) ? (value as string[]) : []
      const toggle = (v: string) => onChange(current.includes(v) ? current.filter((x) => x !== v) : [...current, v])
      return (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={clsx(
                'px-2 py-0.5 rounded text-xs border transition-colors',
                current.includes(o.value)
                  ? 'bg-accent-muted border-accent text-accent-fg font-medium'
                  : 'bg-surface border-border text-fg-muted hover:border-border-strong',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )
    }
    case 'email':
      return (
        <input type="email" value={(value as string) ?? ''} placeholder="name@example.com"
          onChange={(e) => onChange((e.target as HTMLInputElement).value)} className={subInput} />
      )
    case 'url':
      return (
        <input type="url" value={(value as string) ?? ''} placeholder="https://"
          onChange={(e) => onChange((e.target as HTMLInputElement).value)} className={subInput} />
      )
    case 'phone':
      return (
        <input type="tel" value={(value as string) ?? ''}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)} className={subInput} />
      )
    case 'richtext':
    case 'media':
    case 'relation':
    case 'component':
    case 'repeater':
      return <DelegatedSubControl field={field} value={value} onChange={onChange} localeCtx={localeCtx} />
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          placeholder={field.config?.admin?.placeholder}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          className={subInput}
        />
      )
  }
}

// ── Row card ──────────────────────────────────────────────────────────────────

interface RowCardProps {
  item: RepeaterItem
  fields: SubField[]
  index: number
  total: number
  localeCtx?: BlockLocaleCtx
  isDragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
  onChange: (field: string, value: unknown) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function RowCard({ item, fields, index, total, isDragging, dragHandleProps, onChange, onRemove, onMoveUp, onMoveDown, localeCtx }: RowCardProps) {
  const [expanded, setExpanded] = useState(true)
  const preview = expanded ? '' : buildPreview(item, fields)

  return (
    <div className={clsx(
      'border rounded-lg bg-surface transition-shadow',
      isDragging ? 'border-accent/30 shadow-lg ring-1 ring-focus/25 opacity-90' : 'border-border',
    )}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <button
          type="button"
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-fg-faint hover:text-fg-muted shrink-0 transition-colors touch-none"
          {...dragHandleProps}
        >
          <IconGripDots className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        >
          {expanded
            ? <IconChevronDown className="size-3.5 text-fg-subtle shrink-0" />
            : <IconChevronRight className="size-3.5 text-fg-subtle shrink-0" />}
          <span className="text-sm font-medium text-fg hover:text-fg">
            Item {index + 1}
          </span>
          {!expanded && preview && (
            <span className="text-xs text-fg-subtle truncate">{preview}</span>
          )}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={onMoveUp} disabled={index === 0} title="Move up"
            className="p-1 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <IconArrowUp className="size-3.5" />
          </button>
          <button type="button" onClick={onMoveDown} disabled={index === total - 1} title="Move down"
            className="p-1 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <IconArrowDown className="size-3.5" />
          </button>
          <ConfirmTrash onConfirm={onRemove} title="Remove item" />
        </div>
      </div>

      {expanded && (
        <div className="px-3 py-3 space-y-3">
          {fields.map((f) => (
            <div key={f.name}>
              <label className="block text-xs font-medium text-fg mb-1">
                {f.label}
                {f.required && <span className="text-danger-fg ml-0.5">*</span>}
              </label>
              <SubFieldControl
                field={f}
                value={item[f.name]}
                onChange={(v) => onChange(f.name, v)}
                localeCtx={localeCtx && isContainerSub(f) ? nestedLocaleCtx(localeCtx, item._key, f.name) : undefined}
              />
              {/* BL-4: one input per working locale beneath localized row fields */}
              {localeCtx && (f.config as { localized?: boolean } | undefined)?.localized === true && isLocalizableFieldType(f.fieldType)
                && localeCtx.locales.map((loc) => {
                  const lv = localeCtx.getOverlay(loc.code)?.[item._key]?.[f.name] ?? null
                  return (
                    <div key={loc.code} className={clsx('mt-1.5 pl-2 border-l-2', loc.railClass)}>
                      <span className={clsx('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mb-1', loc.badgeClass)}>{loc.label}</span>
                      <SubFieldControl field={f} value={lv} onChange={(v) => localeCtx.setSub(loc.code, item._key, f.name, v)} />
                    </div>
                  )
                })}
              {f.admin?.helpText && (
                <p className="mt-1 text-[11px] text-fg-subtle">{f.admin.helpText}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sortable wrapper ──────────────────────────────────────────────────────────

function SortableRowCard(props: Omit<RowCardProps, 'isDragging' | 'dragHandleProps'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item._key })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: 'relative' }}>
      <RowCard
        {...props}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface RepeaterEditorProps {
  fields: SubField[]
  value: RepeaterItem[]
  onChange: (items: RepeaterItem[]) => void
  maxRows?: number
  /** Per-locale inputs for localized row fields (BL-4). */
  localeCtx?: BlockLocaleCtx
}

export function RepeaterEditor({ fields, value, onChange, maxRows, localeCtx }: RepeaterEditorProps) {
  const items: RepeaterItem[] = Array.isArray(value) ? value : []
  const atMax = maxRows != null && items.length >= maxRows

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((r) => r._key === active.id)
    const to = items.findIndex((r) => r._key === over.id)
    if (from !== -1 && to !== -1) {
      const next = [...items]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      onChange(next)
    }
  }

  function handleAdd() {
    if (atMax) return
    onChange([...items, buildEmptyItem(fields)])
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  function handleMoveUp(index: number) {
    if (index <= 0) return
    const next = [...items]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    onChange(next)
  }

  function handleMoveDown(index: number) {
    if (index >= items.length - 1) return
    const next = [...items]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    onChange(next)
  }

  function handleFieldChange(index: number, field: string, val: unknown) {
    onChange(items.map((r, i) => (i === index ? { ...r, [field]: val } : r)))
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((r) => r._key)} strategy={verticalListSortingStrategy}>
          {items.map((item, i) => (
            <SortableRowCard
              key={item._key}
              item={item}
              fields={fields}
              index={i}
              total={items.length}
              onChange={(field, val) => handleFieldChange(i, field, val)}
              onRemove={() => handleRemove(i)}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
              localeCtx={localeCtx}
            />
          ))}
        </SortableContext>
      </DndContext>

      {!atMax && (
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1.5 text-sm text-accent-fg hover:text-accent-fg font-medium px-3 py-2 rounded-lg border border-dashed border-accent/30 hover:border-accent hover:bg-accent-muted transition-colors w-full justify-center"
        >
          <IconPlus className="size-4" />
          Add item
        </button>
      )}
      {atMax && (
        <p className="text-xs text-fg-subtle text-center py-1">Maximum {maxRows} items reached</p>
      )}
    </div>
  )
}
