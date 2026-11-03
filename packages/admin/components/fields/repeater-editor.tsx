

import { useState, useMemo, lazy, Suspense } from 'react'
import { isLocalizableFieldType } from '@tangen/types'
import { useParams } from 'react-router-dom'
import { ConfirmTrash } from './confirm-trash'
import { DatePicker } from '@/components/ui/date-picker'
import { clsx } from 'clsx'
import { nestedLocaleCtx, type BlockLocaleCtx } from '@/lib/editor'
import { activeSubFieldTabs, fieldColSpanSm, rowDelegatesToFieldControl, subFieldAdmin, selectChoices, subFieldGroup, visibleSubFields, subFieldPlaceholder, subFieldSelectPlaceholder } from '@/lib/field-presentation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as Switch from '@radix-ui/react-switch'
import {
  IconArrowUp, IconArrowDown, IconTrash, IconGripDots, IconPlus,
  IconChevronDown, IconChevronRight,
} from '@tangen/icons'
import { useFoldState } from '@/lib/use-fold-state'
import { FoldAllButton } from './fold-all-button'
import { NumericInput } from './numeric-input'
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
  // Hidden by its own rule means out of the preview too, or a collapsed row
  // names a value that is no longer in effect.
  for (const f of visibleSubFields(fields, item)) {
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
  // Anything the row has no compact control for goes to the REAL FieldControl.
  // The fallback used to be a text box, which for a colour meant no picker and
  // for a link meant a hand-typed path stored as a string where the value is an
  // object - see ROW_COMPACT_FIELD_TYPES for why that was never caught.
  if (rowDelegatesToFieldControl(field.fieldType)) {
    return <DelegatedSubControl field={field} value={value} onChange={onChange} localeCtx={localeCtx} />
  }
  switch (field.fieldType) {
    case 'textarea':
      return (
        <textarea
          rows={3}
          value={(value as string) ?? ''}
          placeholder={subFieldPlaceholder(field)}
          onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          className={subInput + ' resize-none'}
        />
      )
    case 'number':
      return (
        <NumericInput
          value={value}
          onChange={onChange}
          min={field.config?.validation?.min}
          max={field.config?.validation?.max}
          integer={field.config?.validation?.integer}
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
      // The placeholder is what the CLOSED select shows while unset, and the
      // empty option is what the open list offers to get back to it. Both
      // describe one state, so both come from the same default: without the
      // placeholder the trigger fell back to the ui package's '- Select -'
      // while the list said otherwise, in one control. The two carry DIFFERENT
      // wording on purpose: the trigger reports a value, the menu offers an
      // action next to that same value.
      return (
        <Select value={(value as string) ?? ''} onValueChange={onChange} placeholder={subFieldSelectPlaceholder(field)}>
          {selectChoices(field, opts).map((o) => (
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
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          placeholder={subFieldPlaceholder(field)}
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
  /** Owned by the field, so one control can fold every row and a reload remembers it. */
  expanded: boolean
  onToggle: () => void
}

function RowCard({ item, fields, index, total, isDragging, dragHandleProps, onChange, onRemove, onMoveUp, onMoveDown, localeCtx, expanded, onToggle }: RowCardProps) {
  const preview = expanded ? '' : buildPreview(item, fields)
  // A row honours `group` the way a block card does, so one declaration reads
  // the same whichever container it sits in. A row that declares none has a
  // single group, so `activeTabs.length > 1` is false and nothing changes for
  // it: no strip, the same flat grid, no migration.
  const [tab, setTab] = useState<string | null>(null)
  // Hidden by its own rule means not drawn here either, on this row's values -
  // the validator skips the same field, so drawing it would ask for a branch
  // the author did not choose and mark it required.
  const shown = useMemo(() => visibleSubFields(fields, item), [fields, item])
  const activeTabs = useMemo(() => activeSubFieldTabs(shown), [shown])
  const inGroup = (g: string) => shown.filter((f) => subFieldGroup(f) === g)
  // A required field left empty decides which tab OPENS. Unlike a block card
  // this does not also mark it red, because a row tracks no touched set: the
  // point here is only that an error never hides behind a tab nobody opened.
  const missingIn = (g: string) => inGroup(g).some((f) => {
    const v = item[f.name]
    return !!f.required && (v == null || v === '' || (Array.isArray(v) && v.length === 0))
  })
  const activeKey = tab ?? activeTabs.find(({ key }) => missingIn(key))?.key ?? activeTabs[0]?.key ?? 'content'

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
          onClick={onToggle}
          aria-expanded={expanded}
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

      {expanded && activeTabs.length > 1 && (
        <Tabs value={activeKey} onValueChange={setTab} variant="underline">
          <TabsList className="px-3">
            {activeTabs.map(({ key, label }) => (
              <TabsTrigger key={key} value={key} {...(missingIn(key) ? { 'data-tab-missing': key } : {})}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {expanded && (
        <div className="px-3 py-3 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-6">
          {inGroup(activeKey).map((f) => (
            // A container sub-field spans the row whatever it declared: a
            // nested repeater in a half column is the layout this fixes.
            <div key={f.name} className={fieldColSpanSm(isContainerSub(f) ? 'full' : subFieldAdmin(f).width)}>
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
              {subFieldAdmin(f).helpText && (
                <p className="mt-1 text-[11px] text-fg-subtle">{subFieldAdmin(f).helpText}</p>
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
  /** Who draws Collapse all; see ComponentBlockEditor. Defaults to 'self'. */
  foldControl?: 'self' | 'host'
}

export function RepeaterEditor({ fields, value, onChange, maxRows, localeCtx, foldControl = 'self' }: RepeaterEditorProps) {
  const items: RepeaterItem[] = Array.isArray(value) ? value : []
  const atMax = maxRows != null && items.length >= maxRows
  const keys = useMemo(() => items.map((r) => r._key), [items])
  const fold = useFoldState(keys)

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
      {/*
        The control sits in the FIELD HEADER for a top-level field, where it
        costs no height; `foldControl` is how that caller says so. A nested
        editor - a repeater inside a block card - has no header to put it in,
        so it draws its own.
      */}
      {foldControl === 'self' && items.length > 1 && (
        <div className="flex justify-end">
          <FoldAllButton anyExpanded={fold.anyExpanded} onToggle={() => fold.setAll(fold.anyExpanded)} noun="items" />
        </div>
      )}
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
              expanded={!fold.isCollapsed(item._key)}
              onToggle={() => fold.toggle(item._key)}
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
