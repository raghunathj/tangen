/**
 * File Name: container-modal.tsx
 * Purpose: The definitive container editor (plan-container-ux.md) — ONE two-column
 *   master–detail modal for repeater/group (field tree) and component fields
 *   (components + their fields). Left = structure tree (dropzone-style rows, indented
 *   children, add actions at the bottom); right = the selected node's editor.
 *
 *   SHELL STAGE: the left column is fully functional (select/expand/add/remove);
 *   the right column shows placeholder copy describing what gets wired next
 *   (the shared FieldConfigPanel and the component-details form).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useRef, useState } from 'react'
import { Badge, Button, Callout, Input, Label, Tabs, TabsList, TabsTrigger } from '@/kit'
import { clsx } from 'clsx'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconGripDots, IconWarning, IconCopy, IconChevronDown, IconChevronRight, IconPlus, IconSettings, IconGitBranch } from '@tangen/icons'
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/kit'
import { useReusableComponents } from '@/lib/use-reusable-components'
import { AddFieldModal } from './add-field-modal'
import { IconPicker, NamedIcon } from './icon-picker'
import { FieldConfigPanel, ConditionalEditor } from './field-config-sheet'
import { ConfirmX } from './confirm-x'
import { validateSubFields, validateComponentRefs, validateBuilderField, type BuilderField } from '@/lib/schema-builder-model'
import { Link, useParams } from 'react-router-dom'
import { ICON_FOR } from './field-types'

const CONTAINER_TYPES = new Set(['repeater', 'component', 'group'])
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_')

type Def = Record<string, unknown>
type Path = string // dot-joined indices into the tree, e.g. "0" or "1.2"

const childKeyOf = (fieldType: string) => (fieldType === 'group' ? 'groupFields' : 'fields')

/** One sortable row — render-prop hands the drag-handle props to the row content. */
function SortableItem({ id, children }: {
  id: string
  children: (handle: Record<string, unknown>) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={clsx(isDragging && 'opacity-60 z-10 relative')}>
      {children({ ...attributes, ...listeners })}
    </div>
  )
}

/** A reorderable list level (root fields, a container's children, or the component list). */
function SortableLevel({ ids, onReorder, children }: {
  ids: string[]
  onReorder: (from: number, to: number) => void
  children: React.ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return
        const from = ids.indexOf(String(active.id))
        const to = ids.indexOf(String(over.id))
        if (from !== -1 && to !== -1) onReorder(from, to)
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  )
}

/** The fields array at a path inside a root fields array (path segments AFTER the first index navigate containers). */
function getFieldsAt(fields: Def[], segs: number[]): Def[] {
  let cur = fields
  for (const i of segs) {
    const f = cur[i]
    if (!f) return []
    cur = ((f.config as Def | undefined)?.[childKeyOf(f.fieldType as string)] ?? []) as Def[]
  }
  return cur
}

/** Immutably replace the fields array at a path. */
function setFieldsAt(fields: Def[], segs: number[], next: Def[]): Def[] {
  if (segs.length === 0) return next
  const [head, ...rest] = segs
  return fields.map((f, i) => {
    if (i !== head) return f
    const ck = childKeyOf(f.fieldType as string)
    const child = ((f.config as Def | undefined)?.[ck] ?? []) as Def[]
    return { ...f, config: { ...((f.config as Def) ?? {}), [ck]: setFieldsAt(child, rest, next) } }
  })
}

export interface ContainerModalProps {
  open: boolean
  onClose: () => void
  mode: 'fields' | 'components'
  title: string
  schemaLabel?: string
  /** fields mode: the SubField[] being edited. */
  value?: Def[]
  onValueChange?: (next: Def[]) => void
  /** components mode: the component field's config (components: (string|Def)[]). */
  config?: Def
  onConfigChange?: (next: Def) => void
  /** The ENTRY's top-level fields — block-level conditional rules reference these. */
  entryFields?: Array<{ name: string; label: string; fieldType: string; config?: Def }>
}

/** Read-only card for a reusable component + the edit link (blast radius stays visible). */
function ReusableDetail({ name, reusable }: { name: string; reusable: Array<{ name: string; label?: string; group?: string; description?: string; fields?: unknown[] }> }) {
  const params = useParams<{ workspaceId: string }>()
  const meta = reusable.find((c) => c.name === name)
  return (
    <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3.5 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-fg">{meta?.label || name}</p>
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-muted text-accent-fg">reusable</span>
        {meta?.group && <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface border border-border text-fg-muted">{meta.group}</span>}
      </div>
      {meta?.description && <p className="text-xs text-fg-muted">{meta.description}</p>}
      <p className="text-xs text-fg-muted">{meta?.fields?.length ?? 0} fields · shared across schemas - editing it changes every place it's used.</p>
      <Link
        to={`/${params.workspaceId}/schema/components/${name}/edit`}
        className="inline-block text-xs text-accent-fg hover:underline"
      >
        Edit in Reusable Components →
      </Link>
    </div>
  )
}

/** Inline component details — label, block id, group, description. Fields live in the tree. */
function ComponentDetail({ def, groups, onChange, entryFields = [] }: {
  def: Def
  groups: string[]
  onChange: (patch: Def) => void
  entryFields?: Array<{ name: string; label: string; fieldType: string; config?: Def }>
}) {
  const autoName = !def.name || def.name === slugify((def.label as string) ?? '')
  // Same tab grammar as the field panel — General | Conditional.
  const [tab, setTab] = useState<'general' | 'logic'>('general')
  return (
    <div className="space-y-4">
      <div className="sticky -top-5 z-10 -mx-6 -mt-5 border-b border-border-subtle bg-surface px-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'general' | 'logic')} variant="underline">
          <TabsList className="w-full justify-center gap-6 border-b-0">
            <TabsTrigger value="general"><IconSettings className="size-4" />General</TabsTrigger>
            <TabsTrigger value="logic"><IconGitBranch className="size-4" />Conditional</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'general' && (
      <div className="space-y-4">
      <p className="text-ui-sm font-medium text-fg">{(def.label as string) || 'Untitled component'}</p>
      <div className="space-y-1">
        <Label>Label<span className="ml-0.5 text-danger-fg">*</span></Label>
        <Input autoFocus={!def.label} value={(def.label as string) ?? ''}
          onChange={(e) => { const label = e.currentTarget.value; onChange({ label, ...(autoName ? { name: slugify(label) } : {}) }) }} />
      </div>
      <div className="space-y-1">
        <Label>Name (block id)<span className="ml-0.5 text-danger-fg">*</span></Label>
        <Input className="font-mono" value={(def.name as string) ?? ''} onChange={(e) => onChange({ name: slugify(e.currentTarget.value) })} />
        <p className="text-ui-2xs text-fg-subtle">Stored on every block - renaming orphans existing content.</p>
      </div>
      <div className="space-y-1">
        <Label>Group <span className="font-normal text-fg-subtle">(block-picker section)</span></Label>
        <Input value={(def.group as string) ?? ''} list="container-modal-groups" placeholder="e.g. Banners" onChange={(e) => onChange({ group: e.currentTarget.value || undefined })} />
        <datalist id="container-modal-groups">
          {groups.map((g) => <option key={g} value={g} />)}
        </datalist>
      </div>
      <div className="space-y-1">
        <Label>Description <span className="font-normal text-fg-subtle">(shown in the picker)</span></Label>
        <Input value={(def.description as string) ?? ''} onChange={(e) => onChange({ description: e.currentTarget.value || undefined })} />
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label>Icon <span className="font-normal text-fg-subtle">(shown in the picker)</span></Label>
          {typeof def.icon === 'string' && def.icon && <span className="flex items-center gap-1 text-ui-xs text-fg"><NamedIcon name={def.icon} className="size-4" /> {def.icon}</span>}
        </div>
        <IconPicker value={(def.icon as string) ?? ''} onChange={(icon) => onChange({ icon })} />
      </div>
      <p className="text-xs text-fg-subtle">Fields are managed in the tree on the left - expand the component.</p>
      </div>
      )}
      {tab === 'logic' && (
      <div className="text-xs text-fg-muted">
        <span className="block mb-1">Show this block only when…</span>
        <ConditionalEditor
          key={(def.name as string) || 'block'}
          value={def.conditionalVisibility as never}
          onChange={(v) => onChange({ conditionalVisibility: v ?? undefined })}
          label="Block visibility"
          siblings={entryFields as never}
        />
        <span className="block mt-1 text-[11px] text-fg-subtle">Rules reference the entry's fields - the block hides from the picker and the editor when they don't match.</span>
      </div>
      )}
    </div>
  )
}

export function ContainerModal(props: ContainerModalProps) {
  const { open, onClose, mode, title, schemaLabel, entryFields = [] } = props
  const reusable = useReusableComponents(open && mode === 'components')
  const [selected, setSelected] = useState<Path | null>(null)
  const [expanded, setExpanded] = useState<Set<Path>>(new Set())
  const [addingUnder, setAddingUnder] = useState<Path | null>(null) // '' = root
  const [picking, setPicking] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  // Snapshot the value/config as the modal opened, so Cancel discards edits.
  const initialRef = useRef({ value: props.value, config: props.config })
  function cancel() {
    if (mode === 'fields') props.onValueChange?.(initialRef.current.value ?? [])
    else props.onConfigChange?.(initialRef.current.config ?? ({} as never))
    onClose()
  }
  if (!open) return null

  const refs = mode === 'components'
    ? ((Array.isArray(props.config?.components) ? props.config!.components : []) as Array<string | Def>)
    : []
  const rootFields = mode === 'fields' ? (props.value ?? []) : []

  const commitFields = (segsFromRoot: number[], next: Def[]) => {
    if (mode === 'fields') {
      props.onValueChange?.(setFieldsAt(rootFields, segsFromRoot, next))
    } else {
      // first seg = component index; rest navigate that component's fields
      const [ci, ...rest] = segsFromRoot
      const comp = refs[ci]
      if (typeof comp === 'string' || !comp) return
      const inner = setFieldsAt(((comp.fields ?? []) as Def[]), rest, next)
      props.onConfigChange?.({ ...(props.config ?? {}), components: refs.map((r, i) => (i === ci ? { ...comp, fields: inner } : r)) })
    }
  }
  const commitRefs = (next: Array<string | Def>) =>
    props.onConfigChange?.({ ...(props.config ?? {}), components: next })
  const componentGroups = [...new Set([
    ...refs.filter((r): r is Def => typeof r !== 'string').map((d) => d.group as string),
    ...reusable.map((c) => c.group as string),
  ].filter(Boolean))]

  const toggle = (p: Path) => setExpanded((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n })

  /** Fields list containing the node at `path`, plus its index there. */
  const parentListOf = (path: Path): { list: Def[]; idx: number; segs: number[] } => {
    const segs = path.split('.').map(Number)
    const parentSegs = segs.slice(0, -1)
    const list = mode === 'fields'
      ? getFieldsAt(rootFields, parentSegs)
      : getFieldsAt((((refs[parentSegs[0] ?? segs[0]] as Def)?.fields ?? []) as Def[]), parentSegs.slice(1))
    return { list, idx: segs[segs.length - 1], segs: parentSegs }
  }

  const patchFieldAt = (path: Path, patch: Partial<BuilderField>) => {
    const { list, idx, segs } = parentListOf(path)
    const merged = list.map((f, j) => {
      if (j !== idx) return f
      const next: Def = { ...f }
      if ('label' in patch) next.label = patch.label
      if ('name' in patch) next.name = patch.name
      if ('required' in patch) next.required = patch.required
      if ('config' in patch) next.config = patch.config as Def
      return next
    })
    commitFields(segs, merged)
  }

  /** Reorders shift indices — remap path-keyed selection/expansion at that level. */
  const remapAfterReorder = (parent: Path, from: number, to: number) => {
    const remapIdx = (i: number) => {
      if (i === from) return to
      if (from < to && i > from && i <= to) return i - 1
      if (to < from && i >= to && i < from) return i + 1
      return i
    }
    const remap = (p: Path): Path => {
      const prefix = parent === '' ? '' : `${parent}.`
      if (parent !== '' && !p.startsWith(prefix) && p !== parent) return p
      if (parent === '' && p === '') return p
      const rest = parent === '' ? p : p.slice(prefix.length)
      if (!rest) return p
      const segs = rest.split('.')
      const head = remapIdx(Number(segs[0]))
      return `${prefix}${[head, ...segs.slice(1)].join('.')}`
    }
    setSelected((sel) => (sel === null ? sel : remap(sel)))
    setExpanded((prev) => new Set([...prev].map(remap)))
  }

  const reorderFields = (parent: Path, from: number, to: number) => {
    const segs = parent === '' ? [] : parent.split('.').map(Number)
    const list = mode === 'fields'
      ? getFieldsAt(rootFields, segs)
      : getFieldsAt((((refs[segs[0]] as Def)?.fields ?? []) as Def[]), segs.slice(1))
    commitFields(segs, arrayMove(list, from, to))
    remapAfterReorder(parent, from, to)
  }

  // ── Left tree ───────────────────────────────────────────────────────────────

  const fieldRow = (f: Def, path: Path, depth: number) => {
    const Icon = ICON_FOR[(f.fieldType as string) ?? 'text']
    const isContainer = CONTAINER_TYPES.has(f.fieldType as string) && f.fieldType !== 'component' && depth < 2
    const ck = childKeyOf(f.fieldType as string)
    const children = isContainer ? (((f.config as Def | undefined)?.[ck] ?? []) as Def[]) : []
    const segs = path.split('.').map(Number)
    const parentSegs = segs.slice(0, -1)
    const idx = segs[segs.length - 1]
    // Live error state: own rules (dups checked against level siblings) + subtree.
    const { list } = parentListOf(path)
    const levelNames = new Set(list.filter((_, j) => j !== idx).map((x) => (x.name as string) ?? ''))
    const ownErrors = validateBuilderField({
      name: (f.name as string) ?? '', label: (f.label as string) ?? '',
      fieldType: (f.fieldType as string) ?? 'text', config: (f.config as Def) ?? {},
    }, levelNames)
    const subErrors = isContainer ? validateSubFields(children) : []
    const hasError = ownErrors.length > 0 || subErrors.length > 0
    return (
      <SortableItem key={path} id={path}>
        {(handle) => (
      <div>
        <div
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer',
            selected === path ? 'border-accent bg-accent-muted' : hasError ? 'border-danger/40 bg-surface hover:bg-surface-hover' : 'border-border bg-surface hover:bg-surface-hover',
          )}
          onClick={() => setSelected(path)}
        >
          <span {...handle} className="cursor-grab text-fg-subtle hover:text-fg-muted shrink-0" onClick={(e) => e.stopPropagation()}>
            <IconGripDots className="size-3" />
          </span>
          {hasError && (
            <span
              title={ownErrors[0] ?? (expanded.has(path) ? subErrors[0] : `Problems inside - expand to see (${subErrors.length})`)}
              className="shrink-0 flex"
            >
              <IconWarning className="size-3.5 text-danger-fg" />
            </span>
          )}
          {isContainer ? (
            <Button size="xs" variant="ghost" className="size-5 shrink-0 p-0" aria-label={expanded.has(path) ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(path) }} icon={expanded.has(path) ? <IconChevronDown className="size-3.5" /> : <IconChevronRight className="size-3.5" />} />
          ) : <span className="w-4 shrink-0" />}
          {Icon ? <Icon className="size-3.5 text-fg-subtle shrink-0" /> : <span className="size-3.5 shrink-0" />}
          <span className="flex-1 min-w-0 truncate text-sm text-fg">
            {(f.label as string) || <span className="text-fg-subtle italic">unnamed</span>}
          </span>
          <span className="text-[10px] text-fg-subtle shrink-0">{f.fieldType as string}{isContainer ? ` · ${children.length}` : ''}</span>
          <Button size="xs" variant="ghost" title="Duplicate field" aria-label="Duplicate field" className="size-6 shrink-0 p-0" icon={<IconCopy className="size-3" />}
            onClick={(e) => {
              e.stopPropagation()
              const names = new Set(list.map((x) => (x.name as string) ?? ''))
              let cname = `${(f.name as string) ?? ''}_copy`
              for (let n = 2; names.has(cname); n++) cname = `${f.name}_copy${n}`
              const clone: Def = { ...JSON.parse(JSON.stringify(f)), name: f.name ? cname : '', label: f.label ? `${f.label} (copy)` : '' }
              const next = [...list]
              next.splice(idx + 1, 0, clone)
              commitFields(parentSegs, next)
            }} />
          <ConfirmX
            title="Remove field"
            onConfirm={() => {
              commitFields(parentSegs, list.filter((_, j) => j !== idx))
              if (selected === path) setSelected(null)
            }}
          />
        </div>
        {isContainer && expanded.has(path) && (
          <div className="ml-4 mt-1 pl-2.5 border-l-2 border-border space-y-1">
            <SortableLevel ids={children.map((_, j) => `${path}.${j}`)} onReorder={(from, to) => reorderFields(path, from, to)}>
              {children.map((c, j) => fieldRow(c, `${path}.${j}`, depth + 1))}
            </SortableLevel>
            <Button variant="ghost" size="xs" className="w-full justify-center border border-dashed border-border text-fg-subtle" icon={<IconPlus className="size-3.5" />} onClick={() => setAddingUnder(path)}>Add Field</Button>
          </div>
        )}
      </div>
        )}
      </SortableItem>
    )
  }

  const componentRow = (r: string | Def, i: number) => {
    if (typeof r === 'string') {
      const meta = reusable.find((c) => c.name === r)
      const path = `${i}`
      return (
        <SortableItem key={path} id={path}>
          {(handle) => (
        <div
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer',
            selected === path ? 'border-accent bg-accent-muted' : 'border-border bg-surface hover:bg-surface-hover',
          )}
          onClick={() => setSelected(path)}
        >
          <span {...handle} className="cursor-grab text-fg-subtle hover:text-fg-muted shrink-0" onClick={(e) => e.stopPropagation()}>
            <IconGripDots className="size-3" />
          </span>
          <span className="flex-1 min-w-0 truncate text-sm text-fg">{meta?.label || r}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-muted text-accent-fg shrink-0">reusable</span>
          <ConfirmX
            title="Remove component"
            onConfirm={() => { commitRefs(refs.filter((_, j) => j !== i)); if (selected === path) setSelected(null) }}
          />
        </div>
          )}
        </SortableItem>
      )
    }
    const path = `${i}`
    const fields = ((r.fields ?? []) as Def[])
    const compErrors = validateComponentRefs([r])
    return (
      <SortableItem key={path} id={path}>
        {(handle) => (
      <div>
        <div
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer',
            selected === path ? 'border-accent bg-accent-muted' : compErrors.length > 0 ? 'border-danger/40 bg-surface hover:bg-surface-hover' : 'border-border bg-surface hover:bg-surface-hover',
          )}
          onClick={() => setSelected(path)}
        >
          <span {...handle} className="cursor-grab text-fg-subtle hover:text-fg-muted shrink-0" onClick={(e) => e.stopPropagation()}>
            <IconGripDots className="size-3" />
          </span>
          {compErrors.length > 0 && (
            <span title={compErrors[0]} className="shrink-0 flex">
              <IconWarning className="size-3.5 text-danger-fg" />
            </span>
          )}
          <Button size="xs" variant="ghost" className="size-5 shrink-0 p-0" aria-label={expanded.has(path) ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(path) }} icon={expanded.has(path) ? <IconChevronDown className="size-3.5" /> : <IconChevronRight className="size-3.5" />} />
          <span className="flex-1 min-w-0 truncate text-sm text-fg">{(r.label as string) || <span className="text-fg-subtle italic">unnamed component</span>}</span>
          {typeof r.group === 'string' && r.group ? <Badge variant="neutral">{r.group}</Badge> : null}
          <span className="text-[10px] text-fg-subtle shrink-0">{fields.length} fields</span>
          <ConfirmX
            title="Remove component"
            onConfirm={() => { commitRefs(refs.filter((_, j) => j !== i)); if (selected === path) setSelected(null) }}
          />
        </div>
        {expanded.has(path) && (
          <div className="ml-4 mt-1 pl-2.5 border-l-2 border-border space-y-1">
            <SortableLevel ids={fields.map((_, j) => `${path}.${j}`)} onReorder={(from, to) => reorderFields(path, from, to)}>
              {fields.map((c, j) => fieldRow(c, `${path}.${j}`, 1))}
            </SortableLevel>
            <Button variant="ghost" size="xs" className="w-full justify-center border border-dashed border-border text-fg-subtle" icon={<IconPlus className="size-3.5" />} onClick={() => setAddingUnder(path)}>Add Field</Button>
          </div>
        )}
      </div>
        )}
      </SortableItem>
    )
  }

  // ── Right panel (placeholder stage) ────────────────────────────────────────

  const breadcrumb = (() => {
    if (selected === null) return null
    const segs = selected.split('.').map(Number)
    const labels: string[] = []
    if (mode === 'components') {
      const r = refs[segs[0]]
      labels.push(typeof r === 'string' ? (reusable.find((c) => c.name === r)?.label || r) : ((r?.label as string) || 'Untitled component'))
      let cur = typeof r === 'string' ? [] : ((r?.fields ?? []) as Def[])
      for (const i of segs.slice(1)) {
        labels.push(((cur[i]?.label as string) || 'Untitled field'))
        cur = ((cur[i]?.config as Def | undefined)?.[childKeyOf(cur[i]?.fieldType as string)] ?? []) as Def[]
      }
    } else {
      let cur = rootFields
      for (const i of segs) {
        labels.push(((cur[i]?.label as string) || 'Untitled field'))
        cur = ((cur[i]?.config as Def | undefined)?.[childKeyOf(cur[i]?.fieldType as string)] ?? []) as Def[]
      }
    }
    return labels.join(' › ')
  })()

  const selectedIsReusable = mode === 'components' && selected !== null && !selected.includes('.') && typeof refs[Number(selected)] === 'string'
  const selectedIsComponent = mode === 'components' && selected !== null && !selected.includes('.') && typeof refs[Number(selected)] !== 'string'

  return (
    <Dialog open onOpenChange={(o) => { if (!o) cancel() }}>
      <DialogContent
        className="max-w-5xl"
        showClose={false}
        onEscapeKeyDown={(e: Event) => e.preventDefault()}
        onPointerDownOutside={(e: Event) => e.preventDefault()}
        onInteractOutside={(e: Event) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'components'
              ? `Editors pick these as blocks. New components created here belong to ${schemaLabel ? `“${schemaLabel}”` : 'this schema'} only.`
              : 'Rows behave like any field - select one to configure it on the right.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex" style={{ minHeight: '480px', maxHeight: '72vh' }}>
          {/* STRUCTURE */}
          <div className="w-80 shrink-0 border-r border-border px-4 py-5 overflow-y-auto space-y-1.5">
            {mode === 'fields' && (
              <>
                {rootFields.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border-strong px-3 py-5 text-center text-xs text-fg-subtle">No fields yet.</div>
                )}
                <SortableLevel ids={rootFields.map((_, i) => `${i}`)} onReorder={(from, to) => reorderFields('', from, to)}>
                  {rootFields.map((f, i) => fieldRow(f, `${i}`, 1))}
                </SortableLevel>
                <Button variant="ghost" size="sm" className="w-full justify-center border border-dashed border-border-strong text-fg-muted" icon={<IconPlus className="size-3.5" />} onClick={() => setAddingUnder('')}>Add Field</Button>
              </>
            )}
            {mode === 'components' && (
              <>
                {refs.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border-strong px-3 py-5 text-center text-xs text-fg-subtle">No components yet.</div>
                )}
                <SortableLevel
                  ids={refs.map((_, i) => `${i}`)}
                  onReorder={(from, to) => { commitRefs(arrayMove(refs, from, to)); remapAfterReorder('', from, to) }}
                >
                  {refs.map((r, i) => componentRow(r, i))}
                </SortableLevel>
                {(() => {
                  const pickable = reusable.filter((c) => !refs.includes(c.name))
                  const noneLeft = pickable.length === 0
                  return (
                    <>
                      <Button variant="ghost" size="sm" disabled={noneLeft}
                        title={noneLeft ? (reusable.length === 0 ? 'No reusable components available' : 'Everything reusable is already picked') : undefined}
                        className="w-full justify-center border border-dashed border-border-strong text-fg-muted"
                        icon={<IconPlus className="size-3.5" />} onClick={() => setPicking((p) => !p)}>Pick reusable</Button>
                      {picking && !noneLeft && (
                        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-surface-sunken p-1.5">
                          {pickable.map((c) => (
                            <Button key={c.name} variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-md font-normal" onClick={() => { commitRefs([...refs, c.name]); setPicking(false) }}>
                              <span className="flex-1 truncate text-left">{c.label || c.name}</span>
                              {c.group && <Badge variant="neutral">{c.group}</Badge>}
                            </Button>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
                <Button variant="ghost" size="sm" className="w-full justify-center border border-dashed border-border-strong text-fg-muted" icon={<IconPlus className="size-3.5" />}
                  onClick={() => {
                    const next = [...refs, { name: '', label: '', fields: [] }]
                    commitRefs(next)
                    setSelected(`${next.length - 1}`)
                    setExpanded((prev) => new Set(prev).add(`${next.length - 1}`))
                  }}>New component{schemaLabel ? ` for ${schemaLabel}` : ''}</Button>
              </>
            )}
          </div>

          {/* DETAIL - the selected node's editor */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
            {selected === null ? (
              <div className="h-full flex items-center justify-center text-sm text-fg-subtle text-center px-8">
                Select something on the left to configure it here.
              </div>
            ) : (
              <div className="space-y-4">
{!selectedIsComponent && <div className="text-ui-sm font-medium text-fg">{breadcrumb}</div>}
                {selectedIsReusable ? (
                  <ReusableDetail name={refs[Number(selected)] as string} reusable={reusable} />
                ) : selectedIsComponent ? (
                  <ComponentDetail
                    def={refs[Number(selected)] as Def}
                    groups={componentGroups}
                    entryFields={entryFields}
                    onChange={(patch) => commitRefs(refs.map((r, j) => (j === Number(selected) ? { ...(r as Def), ...patch } : r)))}
                  />
                ) : (
                  (() => {
                    const { list, idx } = parentListOf(selected)
                    const f = list[idx]
                    if (!f) return null
                    const asBuilder: BuilderField = {
                      key: `node_${selected}`,
                      name: (f.name as string) ?? '',
                      label: (f.label as string) ?? '',
                      fieldType: (f.fieldType as string) ?? 'text',
                      config: (f.config as Def) ?? {},
                      required: f.required === true,
                      width: 'full',
                    }
                    const siblings = list
                      .filter((_, j) => j !== idx)
                      .map((x) => ({ name: (x.name as string) ?? '', label: (x.label as string) ?? '', fieldType: (x.fieldType as string) ?? 'text', config: (x.config as Def) ?? {} }))
                    return (
                      <FieldConfigPanel
                        field={asBuilder}
                        siblings={siblings}
                        subfieldMode
                        onChange={(patch) => patchFieldAt(selected, patch)}
                      />
                    )
                  })()
                )}
              </div>
            )}
          </div>
        </div>

        {problems.length > 0 && (
          <Callout variant="danger" className="mx-6 mb-2 max-h-28 overflow-y-auto">
            <ul className="space-y-0.5 text-xs">
              {problems.map((p, i) => <li key={i}>• {p}</li>)}
            </ul>
          </Callout>
        )}
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
          <Button size="sm" onClick={() => {
            // Done validates the whole tree — Apply Schema re-checks as the backstop.
            const errs = mode === 'fields' ? validateSubFields(rootFields) : validateComponentRefs(refs)
            if (errs.length > 0) { setProblems(errs); return }
            setProblems([])
            onClose()
          }}>Done</Button>
        </DialogFooter>

        <AddFieldModal
          open={addingUnder !== null}
          onOpenChange={(o) => { if (!o) setAddingUnder(null) }}
          // fields mode: root = level 1 (containers ok); under a container = level 2 (capped).
          // components mode: a component's fields = level 1; anything deeper = level 2.
          excludeTypes={(mode === 'fields' ? (addingUnder ?? '') !== '' : (addingUnder ?? '').includes('.')) ? CONTAINER_TYPES : new Set(['component', 'group'])}
          onPick={(fieldType) => {
            const under = addingUnder ?? ''
            const segs = under === '' ? [] : under.split('.').map(Number)
            const parent = mode === 'fields'
              ? getFieldsAt(rootFields, segs)
              : getFieldsAt((((refs[segs[0]] as Def)?.fields ?? []) as Def[]), segs.slice(1))
            const blank = { name: '', label: '', fieldType, config: {}, required: false }
            commitFields(segs, [...parent, blank])
            setAddingUnder(null)
            setSelected(under === '' ? `${parent.length}` : `${under}.${parent.length}`)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
