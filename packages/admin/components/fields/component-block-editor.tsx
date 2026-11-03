

import { useState, useRef, useMemo, lazy, Suspense } from 'react'
import { isLocalizableFieldType } from '@tangen/types'
import { clsx } from 'clsx'
import { nestedLocaleCtx, type BlockLocaleCtx } from '@/lib/editor'
import * as Switch from '@radix-ui/react-switch'
import {
  IconArrowUp, IconArrowDown, IconTrash, IconGripDots,
  IconPencil, IconEye, IconEyeOff, IconCopy,
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
import type { ComponentDef, SubField } from '@tangen/types'
import {
  type ComponentBlock,
  addBlock, removeBlock, moveBlockUp, moveBlockDown, reorderBlocks, duplicateBlock, buildBlockPreview,
} from '@/lib/component-editor'
import { useComponentDepth, ComponentDepthProvider } from '@/contexts/component-depth'
import { visibleComponentDefs } from '@/lib/component-editor'
import { ConfirmTrash } from './confirm-trash'
import { isAtMaxDepth } from '@/lib/component-depth'
import { BlockPalette } from './block-palette'
import { useParams } from 'react-router-dom'
import { RelationPicker } from './relation-picker'
import { MultiRelationPicker } from './multi-relation-picker'
import { RepeaterEditor, type RepeaterItem } from './repeater-editor'
import { useContentTypes } from '@/lib/use-content-types'
import { activeSubFieldTabs, subFieldAdmin, subFieldGroup, visibleSubFields, fieldColSpanSm, selectChoices, subFieldPlaceholder, subFieldSelectPlaceholder } from '@/lib/field-presentation'
// The kit's Tabs, used as a CONTROL with the panel rendered below it, which is
// how field-config-sheet.tsx and container-modal.tsx use it. Its triggers are
// real tabs (role=tab, aria-selected) and they come from the kit, so no raw
// control is added to this file's kit-lint budget.
//
// Through the narrow components/ui shim rather than the `@/kit` barrel: the
// barrel transitively reaches the app-ui registry, which imports a VITE
// VIRTUAL module, so pulling it in here would make this editor unrenderable
// outside a Vite dev server. Same reason the Button shim exists.
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ── Sub-field controls ────────────────────────────────────────────────────────

/**
 * CR-2 — first-class relation sub-fields inside component blocks: the real pickers
 * (labels, search), the "Temporarily unavailable" pill for disabled targets. Route
 * params supply env/workspaceId so the block editor's nesting stays prop-free.
 */
function NestedRelationControl({ field, value, onChange }: {
  field: SubField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const params = useParams<{ workspaceId: string }>()
  const types = useContentTypes()
  const cfg = (field.config ?? {}) as { targetType?: string; many?: boolean }
  if (!cfg.targetType) {
    return <p className="text-xs text-fg-subtle italic">Relation sub-field has no target type configured.</p>
  }
  const target = types.find((t) => t.name === cfg.targetType)
  if (target?.disabled) {
    const ids = Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value ? [value] : []
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm bg-surface-sunken border border-border text-fg-subtle cursor-not-allowed"
        title={ids.length ? `Stored reference${ids.length > 1 ? 's' : ''}: ${ids.join(', ')}` : 'The target content type is disabled'}
      >
        <span aria-hidden>⏸</span> Temporarily unavailable
        {ids.length > 0 && <span className="font-mono text-[11px]">({ids.length})</span>}
      </div>
    )
  }
  if (cfg.many === true) {
    return (
      <MultiRelationPicker
        workspaceId={params.workspaceId!}
        targetType={cfg.targetType}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={(ids) => onChange(ids.length > 0 ? ids : null)}
        label={field.label}
      />
    )
  }
  return (
    <RelationPicker
      workspaceId={params.workspaceId!}
      targetType={cfg.targetType}
      value={typeof value === 'string' ? value : null}
      onChange={(id) => onChange(id)}
      label={field.label}
    />
  )
}

const subInput = 'w-full appearance-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus-visible:ring-[3px] focus-visible:ring-focus/25 focus-visible:border-focus-border'

const FullFieldControl = lazy(() => import('./field-control').then((m) => ({ default: m.FieldControl })))

/**
 * Sub-fields the compact switch doesn't hand-roll (media, richtext, dates,
 * color, rating, nested repeaters…) delegate to the REAL FieldControl so a
 * block edits with exactly the same controls as a top-level field.
 */
function DelegatedSubControl({ field, value, onChange }: { field: SubField; value: unknown; onChange: (v: unknown) => void }) {
  const params = useParams<{ workspaceId: string }>()
  return (
    <Suspense fallback={null}>
      <FullFieldControl field={{ ...field, config: field.config ?? {} } as never} value={value} onChange={onChange} workspaceId={params.workspaceId!} />
    </Suspense>
  )
}

function SubFieldControl({
  field,
  value,
  onChange,
  depth,
  localeCtx,
}: {
  field: SubField
  value: unknown
  onChange: (v: unknown) => void
  depth: number
  /** Already scoped to THIS sub-field's slot (`overlay[block._key][sub]`) - only set for container sub-fields. */
  localeCtx?: BlockLocaleCtx
}) {
  switch (field.fieldType) {
    case 'relation':
      return <NestedRelationControl field={field} value={value} onChange={onChange} />

    case 'component': {
      const nestedComponents: ComponentDef[] = field.config?.components ?? []
      if (isAtMaxDepth(depth)) {
        return (
          <p className="text-xs text-fg-subtle italic px-2 py-1.5 rounded bg-surface-sunken border border-border">
            Max nesting depth reached
          </p>
        )
      }
      return (
        <ComponentDepthProvider depth={depth + 1}>
          <div className="rounded-md border border-border bg-surface-sunken p-2">
            <ComponentBlockEditor
              components={nestedComponents}
              value={(value as ComponentBlock[]) ?? []}
              onChange={onChange}
              localeCtx={localeCtx}
            />
          </div>
        </ComponentDepthProvider>
      )
    }
    case 'repeater':
      // Rendered directly (not through the lazy FieldControl) so a button
      // row or an accordion inside a section edits per locale like a
      // top-level repeater: the ctx arrives scoped to this block's slot.
      return (
        <RepeaterEditor
          fields={field.config?.fields ?? []}
          value={(value as RepeaterItem[]) ?? []}
          onChange={onChange}
          maxRows={field.config?.validation?.maxRows}
          localeCtx={localeCtx}
        />
      )
    case 'textarea':
      return (
        <textarea
          rows={3}
          value={(value as string) ?? ''}
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
      function toggle(v: string) {
        const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v]
        onChange(next)
      }
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
    case 'text':
    case 'slug':
    case 'email':
    case 'url':
    case 'phone':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder={subFieldPlaceholder(field)}
          className={subInput}
        />
      )
    default:
      // media, richtext, date/datetime/time, color, rating, repeater, …
      return <DelegatedSubControl field={field} value={value} onChange={onChange} />
  }
}

/** A sub-field whose translations live as a nested map under this block's entry. */
const isContainerSub = (sf: SubField): boolean => sf.fieldType === 'component' || sf.fieldType === 'repeater'

/**
 * The tabs a block card offers, in order, labelled with the type's own
 * vocabulary. "Style" rather than "Design", "Content" rather than "General":
 * `SubField.group` already says `content | style | advanced`, Gutenberg's block
 * sidebar says Styles and Webflow's panel says Style, and Studio's inspector
 * classifies props with the same three words - so one block reads the same
 * wherever it is edited.
 *
 * These are KINDS, not arrangements. The question they answer is "what sort of
 * thing is this field" - what it says, how it looks, plumbing - which has the
 * same three answers for every block anyone writes. Author-declared tabs would
 * answer "how do I want to lay out my form", which drifts per block and would
 * put a classification and an arrangement in the same row. A block whose
 * Content grows long wants a fieldset WITHIN the tab, not a fourth tab.
 */
// The three kinds live in lib/field-presentation now, because a repeater row
// sorts by them too and the vocabulary has to mean one thing wherever a
// sub-field is edited. SUBFIELD_TABS carries the reasoning.

interface BlockSubFieldProps {
  sf: SubField
  block: ComponentBlock
  depth: number
  forceRequired?: boolean
  touched: Set<string>
  setTouched: React.Dispatch<React.SetStateAction<Set<string>>>
  onChange: (field: string, value: unknown) => void
  localeCtx?: BlockLocaleCtx
}

/**
 * One sub-field of a block, extracted so the content grid and every section
 * render it from one place rather than repeating the label, the required mark,
 * the per-locale inputs and the help text per group.
 */
function BlockSubField({ sf, block, depth, forceRequired, touched, setTouched, onChange, localeCtx }: BlockSubFieldProps) {
  const sv = block[sf.name]
  const empty = sv == null || sv === '' || (Array.isArray(sv) && sv.length === 0)
  const missing = !!sf.required && empty && (forceRequired || touched.has(sf.name))
  return (
    <div className={fieldColSpanSm(isContainerSub(sf) ? 'full' : subFieldAdmin(sf).width)}>
      <label className={clsx('block text-xs font-medium mb-1', missing ? 'text-danger-fg' : 'text-fg')}>
        {sf.label}
        {sf.required && <span className="text-danger-fg ml-0.5">*</span>}
      </label>
      <div className={clsx(missing && 'rounded-md ring-1 ring-danger/25')}>
        <SubFieldControl
          field={sf}
          value={block[sf.name]}
          onChange={(v) => {
            setTouched((prev) => (prev.has(sf.name) ? prev : new Set(prev).add(sf.name)))
            onChange(sf.name, v)
          }}
          depth={depth}
          localeCtx={localeCtx && isContainerSub(sf) ? nestedLocaleCtx(localeCtx, block._key, sf.name) : undefined}
        />
      </div>
      {missing && <p className="mt-1 text-[11px] text-danger-fg">Required - publishing will fail while empty.</p>}
      {/* BL-4: one input per working locale beneath localized sub-fields */}
      {localeCtx && (sf.config as { localized?: boolean } | undefined)?.localized === true && isLocalizableFieldType(sf.fieldType)
        && localeCtx.locales.map((loc) => {
          const overlay = localeCtx.getOverlay(loc.code)
          const lv = overlay?.[block._key]?.[sf.name] ?? null
          return (
            <div key={loc.code} className={clsx('mt-1.5 pl-2 border-l-2', loc.railClass)}>
              <span className={clsx('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mb-1', loc.badgeClass)}>{loc.label}</span>
              <SubFieldControl
                field={sf}
                value={lv}
                onChange={(v) => localeCtx.setSub(loc.code, block._key, sf.name, v)}
                depth={depth}
              />
            </div>
          )
        })}
      {subFieldAdmin(sf).helpText && (
        <p className="mt-1 text-[11px] text-fg-subtle">{subFieldAdmin(sf).helpText}</p>
      )}
    </div>
  )
}

// ── Single block card ─────────────────────────────────────────────────────────

interface BlockCardProps {
  block: ComponentBlock
  def: ComponentDef
  index: number
  total: number
  depth: number
  isDragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
  onChange: (field: string, value: unknown) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: (label: string) => void
  onToggleDisabled: () => void
  onDuplicate: () => void
  onCopy: () => void
  /** Mark ALL empty required sub-fields red (a publish attempt already failed). */
  forceRequired?: boolean
  /** Per-locale inputs for localized sub-fields (BL-4). */
  localeCtx?: BlockLocaleCtx
  /** Owned by the field, so one control can fold every block and a reload remembers it. */
  expanded: boolean
  onToggle: () => void
}

function BlockCard({
  block, def, index, total, depth, isDragging, dragHandleProps,
  onChange, onRemove, onMoveUp, onMoveDown, onRename, onToggleDisabled, onDuplicate, onCopy,
  forceRequired, localeCtx, expanded, onToggle,
}: BlockCardProps) {
  // Required-empty marks only appear once a sub-field was interacted with — a
  // freshly added block must not open covered in red.
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Grouping is presentation only: `group` classifies a field for the
  // inspector and stores nothing, so sections cost no migration and a block
  // that declares none is unaffected.
  const [tab, setTab] = useState<string | null>(null)
  // A sub-field its own rule hides is not drawn, is not counted as missing,
  // and does not put its tab in the strip - the same answer the validator
  // gives, from the same reader. Its stored value is kept.
  const shown = visibleSubFields(def.fields, block)
  const grouped = (g: string) => shown.filter((f) => subFieldGroup(f) === g)
  const isMissing = (sf: SubField) => {
    const sv = block[sf.name]
    const empty = sv == null || sv === '' || (Array.isArray(sv) && sv.length === 0)
    return !!sf.required && empty && (forceRequired || touched.has(sf.name))
  }
  const missingIn = (g: string) => grouped(g).some(isMissing)
  const activeTabs = activeSubFieldTabs(shown)
  // Before the editor has picked a tab, a tab holding a required-empty field
  // wins: an error behind a tab nobody opened is worse than no grouping. Once
  // they click, their choice holds - computed rather than an effect, so it
  // reacts to a failed publish without fighting them afterwards.
  const activeKey = tab ?? activeTabs.find(({ key }) => missingIn(key))?.key ?? activeTabs[0]?.key ?? 'content'
  // A tab of shared settings says so while locales are in play. A note, never
  // a disabled state: there is no non-base editing mode, so the base input is
  // the only surface a shared value has.
  const noteShared = Boolean(localeCtx)
    && activeKey !== 'content'
    && !grouped(activeKey).some((f) => (f.config as { localized?: boolean } | undefined)?.localized === true)
  const subProps = (sf: SubField) => ({ sf, block, depth, forceRequired, touched, setTouched, onChange, localeCtx })

  const isDisabled = !!block._disabled
  const customLabel = block._label as string | undefined
  const displayLabel = customLabel || def.label
  const preview = !expanded ? buildBlockPreview(block, def) : ''

  function startRename() {
    setRenameVal(customLabel ?? '')
    setRenaming(true)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  function commitRename() {
    onRename(renameVal.trim())
    setRenaming(false)
  }

  return (
    <div className={clsx(
      'border rounded-lg bg-surface transition-all',
      isDragging ? 'border-accent/30 shadow-lg ring-1 ring-focus/25 opacity-90' : 'border-border',
      isDisabled && !isDragging && 'opacity-55',
    )}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        {/* Drag handle */}
        <button
          type="button"
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-fg-faint hover:text-fg-muted shrink-0 transition-colors touch-none"
          {...dragHandleProps}
        >
          <IconGripDots className="size-4" />
        </button>

        {/* Label / inline rename input */}
        {renaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameVal}
            onChange={(e) => setRenameVal((e.target as HTMLInputElement).value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { setRenaming(false) }
            }}
            placeholder={def.label}
            className="flex-1 min-w-0 text-sm font-medium border border-accent/30 rounded-md px-2 py-0.5 outline-none focus-visible:ring-[3px] focus-visible:ring-focus/25"
          />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex-1 min-w-0 text-left"
          >
            <span className={clsx(
              'block text-sm font-medium truncate',
              isDisabled ? 'line-through text-fg-subtle' : 'text-fg hover:text-fg',
            )}>
              {displayLabel}
              {customLabel && (
                <span className="ml-1.5 text-[10px] font-normal text-fg-subtle">({def.label})</span>
              )}
            </span>
            {!expanded && preview && (
              <span className="block text-xs text-fg-subtle truncate mt-0.5">{preview}</span>
            )}
          </button>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Rename */}
          {!renaming && (
            <button
              type="button"
              onClick={startRename}
              title="Rename"
              className="p-1 rounded text-fg-subtle hover:text-accent hover:bg-accent-muted transition-colors"
            >
              <IconPencil className="size-3.5" />
            </button>
          )}

          {/* Toggle visibility */}
          <button
            type="button"
            onClick={onToggleDisabled}
            title={isDisabled ? 'Show section' : 'Hide section'}
            className={clsx(
              'p-1 rounded transition-colors',
              isDisabled
                ? 'text-warning hover:text-warning-fg hover:bg-warning-muted'
                : 'text-fg-subtle hover:text-fg-muted hover:bg-surface-hover',
            )}
          >
            {isDisabled ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}
          </button>

          {/* Duplicate */}
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate"
            className="p-1 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-hover transition-colors"
          >
            <IconCopy className="size-3.5" />
          </button>

          {/* Copy to clipboard */}
          <button
            type="button"
            onClick={onCopy}
            title="Copy to clipboard"
            className="p-1 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-hover transition-colors"
          >
            <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="5" width="9" height="9" rx="1.5" />
              <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
            </svg>
          </button>

          {/* Divider */}
          <span className="w-px h-3.5 bg-surface-hover mx-0.5 shrink-0" />

          {/* Move up / down */}
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            className="p-1 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <IconArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            className="p-1 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <IconArrowDown className="size-3.5" />
          </button>

          {/* Delete - two-step: arm, then confirm (auto-disarms) */}
          <ConfirmTrash onConfirm={onRemove} title="Remove section" />
        </div>
      </div>

      {/* Hidden notice bar */}
      {isDisabled && (
        <div className="px-3 py-1.5 bg-warning-muted border-b border-amber-100">
          <p className="text-xs text-warning-fg">Hidden - won't appear in published content.</p>
        </div>
      )}

      {/* Fields by kind. One kind present means no tab row at all: a lonely
          tab is chrome for nothing, and a content-only block stays as bare as
          it was before tabs existed. Only the active tab's fields are in the
          DOM, which is the kit's Tabs used as a control the way
          field-config-sheet does it. */}
      {expanded && (
        <>
          {activeTabs.length > 1 && (
            <Tabs value={activeKey} onValueChange={setTab} variant="underline">
              <TabsList className="px-3">
                {activeTabs.map(({ key, label }) => (
                  <TabsTrigger
                    key={key}
                    value={key}
                    {...(missingIn(key) ? { 'data-tab-missing': key } : {})}
                  >
                    {label}
                    {missingIn(key) && <span className="ml-1 text-danger-fg" aria-hidden="true">*</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <div className="px-3 py-3">
            {noteShared && (
              <p className="mb-2 text-[11px] text-fg-subtle">
                Shared across every language. Change it once and it applies everywhere.
              </p>
            )}
            <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-6">
              {grouped(activeKey).map((sf) => <BlockSubField key={sf.name} {...subProps(sf)} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Sortable wrapper ──────────────────────────────────────────────────────────

function SortableBlockCard(props: Omit<BlockCardProps, 'isDragging' | 'dragHandleProps'>) {
  const { block } = props
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block._key })

  const style: React.CSSProperties = {
    // Translate (not Transform): dnd-kit's scale factor stretches the dragged
    // card when siblings have different heights.
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  }

  return (
    <div ref={setNodeRef} style={style}>
      <BlockCard
        {...props}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface ComponentBlockEditorProps {
  components: ComponentDef[]
  value: ComponentBlock[]
  onChange: (blocks: ComponentBlock[]) => void
  /** Entry values accessor — block-level conditional visibility evaluates against it. */
  getEntryValue?: (field: string) => unknown
  /** True when the server rejected this field (failed publish) — marks every empty
   *  required sub-field red. Latched: stays on for the session once seen, so fixing
   *  one sub-field doesn't un-mark the others. */
  showRequired?: boolean
  /** Per-locale inputs for localized sub-fields (BL-4). */
  localeCtx?: BlockLocaleCtx
  /**
   * Who draws Collapse all. 'host' means the caller already drew a header and
   * put it there, which is how a top-level field spends no extra height on it.
   * Defaults to 'self', so a nested editor keeps the control it would
   * otherwise silently lose.
   */
  foldControl?: 'self' | 'host'
}

export function ComponentBlockEditor({ components, value, onChange, getEntryValue, showRequired, localeCtx, foldControl = 'self' }: ComponentBlockEditorProps) {
  const [requiredLatched, setRequiredLatched] = useState(false)
  if (showRequired && !requiredLatched) setRequiredLatched(true)
  const forceRequired = !!showRequired || requiredLatched
  // Block-level conditionals: defs whose rules fail are neither offered nor rendered
  // (stored values stay untouched — the lazy-data rule).
  const visibleComponents = getEntryValue ? visibleComponentDefs(components, getEntryValue) : components
  // Guard first: a non-array value (e.g. null/'' from legacy or mis-typed data)
  // must not crash the editor on load with "value.filter is not a function".
  const blocks: ComponentBlock[] = Array.isArray(value) ? value : []
  const hiddenCount = blocks.filter((b) => components.some((c) => c.name === b._type) && !visibleComponents.some((c) => c.name === b._type)).length
  const depth = useComponentDepth()
  const [pasteError, setPasteError] = useState<string | null>(null)
  // Only the blocks that actually RENDER: a block hidden by a visibility rule
  // must not decide whether the control says Collapse all.
  const foldKeys = useMemo(
    () => blocks.filter((b) => visibleComponents.some((c) => c.name === b._type)).map((b) => b._key),
    [blocks, visibleComponents],
  )
  const fold = useFoldState(foldKeys)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = blocks.findIndex((b) => b._key === active.id)
    const toIndex = blocks.findIndex((b) => b._key === over.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      onChange(reorderBlocks(blocks, fromIndex, toIndex))
    }
  }

  function handleAdd(def: ComponentDef) { onChange(addBlock(blocks, def)) }
  function handleRemove(index: number) { onChange(removeBlock(blocks, index)) }
  function handleMoveUp(index: number) { onChange(moveBlockUp(blocks, index)) }
  function handleMoveDown(index: number) { onChange(moveBlockDown(blocks, index)) }
  function handleDuplicate(index: number) { onChange(duplicateBlock(blocks, index)) }

  function handleFieldChange(index: number, field: string, val: unknown) {
    onChange(blocks.map((b, i) => (i === index ? { ...b, [field]: val } : b)))
  }

  function handleRename(index: number, label: string) {
    onChange(blocks.map((b, i) => {
      if (i !== index) return b
      const { _label: _removed, ...rest } = b as any
      return label ? { ...rest, _label: label } : rest
    }))
  }

  function handleToggleDisabled(index: number) {
    onChange(blocks.map((b, i) => {
      if (i !== index) return b
      return b._disabled ? { ...b, _disabled: undefined } : { ...b, _disabled: true }
    }))
  }

  async function handleCopy(index: number) {
    const block = blocks[index]
    if (!block) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(block))
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  async function handlePaste() {
    setPasteError(null)
    try {
      const text = await navigator.clipboard.readText()
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || !parsed._type) {
        setPasteError('Clipboard does not contain a valid section.')
        return
      }
      const matchingDef = components.find((c) => c.name === parsed._type)
      if (!matchingDef) {
        setPasteError(`Section type "${parsed._type}" is not available here.`)
        return
      }
      const newBlock: ComponentBlock = {
        ...parsed,
        _key: Math.random().toString(36).slice(2, 14),
        _disabled: undefined,
      }
      onChange([...blocks, newBlock])
    } catch {
      setPasteError('Could not read from clipboard.')
    }
  }

  return (
    <div className="space-y-2">
      {/*
        The control sits in the FIELD HEADER for a top-level field, where it
        costs no height; `foldControl` is how that caller says so. A nested
        editor - a repeater inside a block card - has no header to put it in,
        so it draws its own.
      */}
      {foldControl === 'self' && foldKeys.length > 1 && (
        <div className="flex justify-end">
          <FoldAllButton anyExpanded={fold.anyExpanded} onToggle={() => fold.setAll(fold.anyExpanded)} noun="sections" />
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((b) => b._key)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, i) => {
            // hidden-by-condition defs render nothing; their stored values stay put
            const def = visibleComponents.find((c) => c.name === block._type)
            if (!def) return null
            return (
              <SortableBlockCard
                key={block._key}
                block={block}
                def={def}
                index={i}
                total={blocks.length}
                depth={depth}
                onChange={(field, val) => handleFieldChange(i, field, val)}
                onRemove={() => handleRemove(i)}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
                onRename={(label) => handleRename(i, label)}
                onToggleDisabled={() => handleToggleDisabled(i)}
                onDuplicate={() => handleDuplicate(i)}
                onCopy={() => handleCopy(i)}
                forceRequired={forceRequired}
                localeCtx={localeCtx}
                expanded={!fold.isCollapsed(block._key)}
                onToggle={() => fold.toggle(block._key)}
              />
            )
          })}
        </SortableContext>
      </DndContext>

      {/* Add / paste palette */}
      <div className={clsx(blocks.length > 0 && 'pt-1', 'space-y-1.5')}>
        {hiddenCount > 0 && (
          <p className="text-[11px] text-fg-subtle italic">
            {hiddenCount} block{hiddenCount === 1 ? '' : 's'} hidden by visibility rules - values are kept.
          </p>
        )}
        <BlockPalette components={visibleComponents} onSelect={handleAdd} />
        <button
          type="button"
          onClick={handlePaste}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-fg-muted border border-dashed border-border-strong hover:border-violet-400 hover:text-violet-600 transition-colors w-full justify-center"
        >
          <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="5" width="9" height="9" rx="1.5" />
            <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
          </svg>
          Paste section from clipboard
        </button>
        {pasteError && (
          <p className="text-xs text-danger-fg text-center">{pasteError}</p>
        )}
      </div>
    </div>
  )
}
