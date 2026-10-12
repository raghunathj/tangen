/**
 * File Name: field-config-sheet.tsx
 * Purpose: The per-field config Sheet — a GENERIC renderer driven by the field
 *   capability descriptor (lib/field-capabilities). Click a field card to edit its
 *   basics (label, name, required, help text, width), its type-specific capabilities
 *   (validation, options, relation target, media constraints, …) and an Advanced
 *   section (placeholder, visibility, conditional rules). Custom (extension/site)
 *   field types generate controls from their configSchema. Edits dispatch UPDATE_FIELD;
 *   nothing is written until the type is saved.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useMemo, useState, useRef, type ComponentType } from 'react'
import { AnchoredDropdown } from '@/components/ui/anchored-dropdown'
import { Button, Callout, Checkbox, ChoiceRow, Input, Label, Select, SelectItem, Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription, Tabs, TabsList, TabsTrigger, Textarea, Toggle as KitToggle } from '@/kit'
import { clsx } from 'clsx'
import { validateBuilderField, type BuilderField, type Width } from '@/lib/schema-builder-model'
import { RESERVED_FIELD_NAMES, isLocalizableFieldType } from '@tangen/types'
import { isDynamicDefault } from '@tangen/types'
import type { ConditionalRule, ConditionalVisibility, ImageVariant } from '@tangen/types'
import {
  controlsByTab, typeControls, configSchemaToControls, SHEET_TABS,
  conditionOperators, VALUELESS_OPERATORS, matchSiblingFields, readValue, writeValue, resolveToggleChecked, SUBFIELD_EXCLUDED_PATHS,
  type Control, type ConfigSchemaProp, type SheetTab,
} from '@/lib/field-capabilities'
import { IconX, IconTrash, IconPlus, IconChevronDown, IconChevronRight, IconSearch, IconStack, IconListChecks, IconSettings, IconShieldCheck, IconEye, IconGitBranch } from '@tangen/icons'
import { useInstalledFieldTypes } from '@/lib/use-installed-field-types'
import { isControlHidden } from './installed-field-types'
import { useContentTypes } from '@/lib/use-content-types'
import { useReusableComponents } from '@/lib/use-reusable-components'
import { useLocaleStore } from '@/lib/locale'

const WIDTHS: Width[] = ['full', 'half', 'third']
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_')
/** Small icons on the field-config tabs for quick recognition. */
const TAB_ICON: Record<string, ComponentType<{ className?: string }>> = {
  general: IconSettings, validation: IconShieldCheck, presentation: IconEye, logic: IconGitBranch,
}

type Patch = Partial<Omit<BuilderField, 'key'>>
type Option = { label: string; value: string }
/** Minimal shape the conditional editor needs about sibling fields. */
export type SiblingField = { key?: string; name: string; label: string; fieldType: string; config?: Record<string, any> }

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <KitToggle size="sm" checked={checked} onCheckedChange={onChange} label={label} />
}

/** JSON object editor with a local draft — persists only when the text parses. */
function JsonEditor({ label, value, onChange, placeholder, help }: {
  label: string; value: unknown; onChange: (v: unknown) => void; placeholder?: string; help?: string
}) {
  const [text, setText] = useState(() => (value == null ? '' : JSON.stringify(value, null, 2)))
  const [bad, setBad] = useState(false)
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea value={text} placeholder={placeholder} rows={3} className={clsx('font-mono', bad && 'border-danger/40')}
        onChange={(e) => {
          const t = e.currentTarget.value
          setText(t)
          if (!t.trim()) { setBad(false); onChange(undefined); return }
          try {
            const parsed = JSON.parse(t)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { setBad(false); onChange(parsed) }
            else setBad(true)
          } catch { setBad(true) }
        }} />
      {bad && <p className="text-ui-xs text-danger-fg">Not a valid JSON object - last valid value is kept.</p>}
      {help && !bad && <p className="text-ui-xs text-fg-subtle">{help}</p>}
    </div>
  )
}

/** Checkbox list of content types — labels shown, names stored. */
function TypeRefMultiPicker({ value, onChange }: { value: string[]; onChange: (names: string[]) => void }) {
  const types = useContentTypes()
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name])
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
      {types.map((t) => (
        <div key={t.name} className="px-2 py-0.5">
          <ChoiceRow htmlFor={`trm_${t.name}`} label={<span className="flex items-center gap-1.5 truncate">{t.label}{t.disabled && <span className="shrink-0 text-ui-2xs text-warning-fg">disabled</span>}</span>}
            control={<Checkbox id={`trm_${t.name}`} checked={value.includes(t.name)} onCheckedChange={() => toggle(t.name)} />} />
        </div>
      ))}
      {types.length === 0 && <div className="px-2.5 py-2 text-xs text-fg-subtle">No types yet</div>}
    </div>
  )
}

/** Searchable content-type picker — shows LABELS (names stay internal). */
function TypeRefPicker({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const types = useContentTypes()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const q = query.trim().toLowerCase()
  const filtered = types.filter((t) => !q || t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
  const current = types.find((t) => t.name === value)
  // Close on outside mousedown (the portaled list is outside this subtree).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (triggerRef.current?.contains(t) || t.closest?.('[data-tangen-overlay]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div className="relative">
      <Button ref={triggerRef} variant="secondary" className="w-full justify-between gap-2 font-normal" onClick={() => { setOpen((o) => !o); setQuery('') }}>
        <span className={clsx('truncate', !current && 'text-fg-subtle')}>{current ? current.label : value ? value : 'Pick a content type…'}</span>
        <IconChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </Button>
      <AnchoredDropdown anchorRef={triggerRef} open={open} className="rounded-md border border-border bg-surface shadow-lg overflow-hidden">
          <div className="border-b border-border p-1.5">
            <Input autoFocus value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search types…" icon={<IconSearch className="size-3.5" />} />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map((t) => (
              <Button key={t.name} variant="ghost" size="sm" className={clsx('w-full justify-start gap-2 rounded-none font-normal hover:bg-surface-sunken', t.name === value && 'bg-accent-muted')} onClick={() => { onPick(t.name); setOpen(false) }}>
                <span className="truncate">{t.label}</span>
                {t.disabled && <span className="shrink-0 text-ui-2xs text-warning-fg">disabled</span>}
              </Button>
            ))}
            {filtered.length === 0 && <div className="px-2.5 py-2 text-ui-xs text-fg-subtle">No matching types</div>}
          </div>
      </AnchoredDropdown>
    </div>
  )
}

/** Label input + auto-synced hidden name (mono preview, Edit unlocks the input). */
function LabelWithNameRow({ field, control, onChange, siblings = [], checkReserved = false }: { field: BuilderField; control: Control; onChange: (patch: Patch) => void; siblings?: SiblingField[]; checkReserved?: boolean }) {
  const [editingName, setEditingName] = useState(false)
  const isAutoName = field.name === slug(field.label) || /^[a-z][a-z0-9]*_\d+$/.test(field.name)
  // Real-time availability: duplicate against siblings, reserved system columns.
  const taken = !!field.name && siblings.some((s) => s.name === field.name)
  const reserved = checkReserved && !!field.name && RESERVED_FIELD_NAMES.has(field.name)
  return (
    <div>
      <div className="space-y-1">
        <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
        <Input autoFocus={!field.label} placeholder="e.g. Author name" value={field.label}
          onChange={(e) => { const label = e.currentTarget.value; onChange(isAutoName && !editingName ? { label, name: slug(label) } : { label }) }} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        {editingName ? (
          <Input autoFocus value={field.name} className="h-6 w-40 font-mono text-ui-xs"
            onChange={(e) => onChange({ name: slug(e.currentTarget.value) })} onBlur={() => setEditingName(false)} />
        ) : (
          <>
            <span className="font-mono">{field.name || '-'}</span>
            <Button size="xs" variant="ghost" className="h-5 px-1 text-accent-fg" onClick={() => setEditingName(true)}>edit</Button>
          </>
        )}
        <span>· code id (column name)</span>
        {field.name && (
          taken ? <span className="text-danger-fg">- already used by another field</span>
          : reserved ? <span className="text-danger-fg">- reserved system column</span>
          : <span className="text-success-fg">- available</span>
        )}
      </div>
    </div>
  )
}

/** Renders one descriptor control against the field, via read/writeValue. */
const VARIANT_FIT = ['cover', 'contain', 'fill', 'inside', 'outside'] as const
const VARIANT_FORMAT = ['original', 'webp', 'avif', 'jpeg', 'png'] as const
const VARIANT_POSITION = ['center', 'top', 'right top', 'right', 'right bottom', 'bottom', 'left bottom', 'left', 'left top', 'entropy', 'attention'] as const

/** Repeatable editor for a media field's named image variants (config.variants). */
function ImageVariantsControl({ label, help, value, onChange }: { label: string; help?: string; value: unknown; onChange: (v: unknown) => void }) {
  const list = Array.isArray(value) ? (value as ImageVariant[]) : []
  const num = (s: string): number | undefined => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : undefined }
  const update = (i: number, patch: Partial<ImageVariant>) => onChange(list.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  const remove = (i: number) => { const next = list.filter((_, idx) => idx !== i); onChange(next.length ? next : undefined) }
  const add = () => onChange([...list, { name: '' }])

  return (
    <div className="text-xs text-fg-muted">
      <span className="block mb-1">{label}</span>
      <div className="space-y-2">
        {list.map((v, i) => (
          <div key={i} className="rounded-md border border-border bg-surface p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Input value={v.name} onChange={(e) => update(i, { name: e.currentTarget.value })} placeholder="name (e.g. thumb)" className="flex-1 font-mono" />
              <Button size="xs" variant="ghost" className="shrink-0 text-danger-fg hover:bg-danger-muted" onClick={() => remove(i)}>Remove</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={v.width ?? ''} onChange={(e) => update(i, { width: num(e.currentTarget.value) })} placeholder="width (px)" />
              <Input type="number" value={v.height ?? ''} onChange={(e) => update(i, { height: num(e.currentTarget.value) })} placeholder="height (px)" />
              <Select value={v.fit ?? '__d'} onValueChange={(x: string) => update(i, { fit: (x === '__d' ? undefined : x) as ImageVariant['fit'] })}>
                <SelectItem value="__d">fit - cover</SelectItem>
                {VARIANT_FIT.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </Select>
              <Select value={v.format ?? '__d'} onValueChange={(x: string) => update(i, { format: (x === '__d' ? undefined : x) as ImageVariant['format'] })}>
                <SelectItem value="__d">format - inherit</SelectItem>
                {VARIANT_FORMAT.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </Select>
              <Select value={v.position ?? '__d'} onValueChange={(x: string) => update(i, { position: (x === '__d' ? undefined : x) as ImageVariant['position'] })}>
                <SelectItem value="__d">position - center</SelectItem>
                {VARIANT_POSITION.map((pp) => <SelectItem key={pp} value={pp}>{pp}</SelectItem>)}
              </Select>
              <Input type="number" value={v.quality ?? ''} onChange={(e) => update(i, { quality: num(e.currentTarget.value) })} placeholder="quality 1–100" />
            </div>
          </div>
        ))}
      </div>
      <Button size="xs" variant="ghost" className="mt-2" icon={<IconPlus className="size-3.5" />} onClick={add}>Add variant</Button>
      {help && <span className="block mt-1 text-[11px] text-fg-subtle">{help}</span>}
    </div>
  )
}

function ControlRow({ field, control, onChange, siblings, checkReserved = false }: { field: BuilderField; control: Control; onChange: (patch: Patch) => void; siblings: SiblingField[]; checkReserved?: boolean }) {
  const value = readValue(field, control.path)
  const set = (v: unknown) => onChange(writeValue(field, control.path, v))

  // The name (code id) hides behind the Label: auto-slugged from it while the field is
  // pristine (starter name or slug of the label), frozen once hand-edited or after Done.
  if (control.path === 'name') return null
  if (control.path === 'label') {
    return <LabelWithNameRow field={field} control={control} onChange={onChange} siblings={siblings} checkReserved={checkReserved} />
  }

  // Default-value controls with dynamic options: a mode select (Static / Now / …) over
  // the plain static input. Dynamic mode stores { $dynamic: kind } — resolved at create.
  if (control.dynamicChoices?.length) {
    const dyn = isDynamicDefault(value) ? value.$dynamic : ''
    return (
      <div className="space-y-1.5">
        <div className="space-y-1">
          <Label>{control.label}</Label>
          <Select value={dyn || '__static'} onValueChange={(v: string) => set(v === '__static' ? undefined : { $dynamic: v })}>
            <SelectItem value="__static">Static value</SelectItem>
            {control.dynamicChoices.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </Select>
        </div>
        {!dyn && (
          <ControlRow field={field} control={{ ...control, label: 'Value', dynamicChoices: undefined }} onChange={onChange} siblings={siblings} />
        )}
      </div>
    )
  }

  if (control.kind === 'toggle') {
    return (
      <div>
        <Toggle checked={resolveToggleChecked(value, control.defaultOn)} onChange={set} label={control.label} />
        {control.help && <p className="mt-1 text-[11px] text-fg-subtle">{control.help}</p>}
      </div>
    )
  }

  if (control.kind === 'number') {
    return (
      <div className="space-y-1">
        <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
        <Input type="number" value={value == null ? '' : String(value)} placeholder={control.placeholder}
          onChange={(e) => { const v = e.currentTarget.value; set(v === '' ? undefined : Number(v)) }} />
        {control.help && <p className="text-ui-xs text-fg-subtle">{control.help}</p>}
      </div>
    )
  }

  if (control.kind === 'color') {
    const v = typeof value === 'string' && value ? value : '#000000'
    return (
      <div className="space-y-1">
        <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Pick a colour" value={v} onChange={(e) => set(e.currentTarget.value)} className="h-8 w-10 rounded border border-border bg-surface p-0.5" />
          <Input value={typeof value === 'string' ? value : ''} placeholder="#000000" className="flex-1 font-mono" onChange={(e) => set(e.currentTarget.value || undefined)} />
        </div>
      </div>
    )
  }

  if (control.kind === 'date') {
    return (
      <div className="space-y-1">
        <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
        <Input type="date" value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.currentTarget.value || undefined)} />
      </div>
    )
  }

  if (control.kind === 'select') {
    return (
      <div className="space-y-1">
        <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
        <Select value={(value as string) || '__none'} onValueChange={(raw: string) => {
          const v = raw === '__none' ? undefined : raw
          set(control.path === 'config.optionsSource' && v === 'static' ? undefined : v)
        }}>
          <SelectItem value="__none">-</SelectItem>
          {control.choices?.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
        </Select>
      </div>
    )
  }

  if (control.kind === 'options') {
    if ((field.config as { optionsSource?: string })?.optionsSource === 'dynamic') {
      return (
        <p className="text-xs text-fg-subtle italic px-2 py-1.5 rounded bg-surface-sunken border border-border">
          Options are served by site code (dynamicOptions) - nothing to define here.
        </p>
      )
    }
    return <OptionsEditor value={Array.isArray(value) ? (value as Option[]) : []} onChange={set} mandatory={control.mandatory} />
  }

  if (control.kind === 'stringList') {
    const arr = Array.isArray(value) ? (value as string[]) : []
    return (
      <div className="space-y-1">
        <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
        <Input value={arr.join(', ')} placeholder={control.placeholder ?? 'a, b, c'} className={clsx(control.mono && 'font-mono')}
          onChange={(e) => { const parts = e.currentTarget.value.split(',').map((x) => x.trim()).filter(Boolean); set(parts.length ? parts : undefined) }} />
      </div>
    )
  }

  if (control.kind === 'imageVariants') {
    return <ImageVariantsControl label={control.label} help={control.help} value={value} onChange={set} />
  }

  if (control.kind === 'multiCheck') {
    const selected = Array.isArray(value) ? (value as string[]) : []
    const toggleChoice = (v: string) =>
      set(selected.includes(v) ? (selected.length === 1 ? undefined : selected.filter((x) => x !== v)) : [...selected, v])
    return (
      <div className="text-xs text-fg-muted">
        <span className="block mb-1">{control.label}{control.mandatory && <span className="text-danger-fg ml-0.5">*</span>}</span>
        <div className="rounded-md border border-border divide-y divide-border">
          {control.choices?.map((c) => (
            <div key={c.value} className="px-2 py-0.5">
              <ChoiceRow htmlFor={`mc_${c.value}`} label={c.label} control={<Checkbox id={`mc_${c.value}`} checked={selected.includes(c.value)} onCheckedChange={() => toggleChoice(c.value)} />} />
            </div>
          ))}
        </div>
        {control.help && <span className="block mt-1 text-[11px] text-fg-subtle">{control.help}</span>}
      </div>
    )
  }

  if (control.kind === 'typeRefMulti') {
    return (
      <label className="block text-xs text-fg-muted">
        <span className="block mb-1">{control.label}{control.mandatory && <span className="text-danger-fg ml-0.5">*</span>}</span>
        <TypeRefMultiPicker value={Array.isArray(value) ? (value as string[]) : []} onChange={(names) => set(names.length ? names : undefined)} />
        {control.help && <span className="block mt-1 text-[11px] text-fg-subtle">{control.help}</span>}
      </label>
    )
  }

  if (control.kind === 'typeRef') {
    return (
      <label className="block text-xs text-fg-muted">
        <span className="block mb-1">{control.label}{control.mandatory && <span className="text-danger-fg ml-0.5">*</span>}</span>
        <TypeRefPicker value={(value as string) ?? ''} onPick={(name) => set(name || undefined)} />
        {control.help && <span className="block mt-1 text-[11px] text-fg-subtle">{control.help}</span>}
      </label>
    )
  }

  if (control.kind === 'fieldRef') {
    // Pick a sibling field by name ('title' offered first — every type has it).
    const withTitle: SiblingField[] = [
      { name: 'title', label: 'Title', fieldType: 'text' },
      ...siblings.filter((s) => ['text', 'textarea', 'email', 'url'].includes(s.fieldType)),
    ]
    return (
      <label className="block text-xs text-fg-muted">
        <span className="block mb-1">{control.label}{control.mandatory && <span className="text-danger-fg ml-0.5">*</span>}</span>
        <FieldPicker value={(value as string) ?? ''} siblings={withTitle} onPick={(name) => set(name || undefined)} />
        {control.help && <span className="block mt-1 text-[11px] text-fg-subtle">{control.help}</span>}
      </label>
    )
  }

  if (control.kind === 'json') {
    return <JsonEditor key={field.key} label={control.label} value={value} onChange={set} placeholder={control.placeholder} help={control.help} />
  }

  if (control.kind === 'conditional') {
    // Key by field identity so the editor's local draft state resets when you switch fields.
    return <ConditionalEditor key={field.key} value={value as ConditionalVisibility | undefined} onChange={set} label={control.label} siblings={siblings} />
  }

  // text / textarea
  const commonOnChange = (raw: string) => set((control.slug ? slug(raw) : raw) || undefined)
  return (
    <div className="space-y-1">
      <Label>{control.label}{control.mandatory && <span className="ml-0.5 text-danger-fg">*</span>}</Label>
      {control.kind === 'textarea' ? (
        <Textarea value={(value as string) ?? ''} placeholder={control.placeholder} rows={2} onChange={(e) => commonOnChange(e.currentTarget.value)} />
      ) : (
        <Input value={(value as string) ?? ''} placeholder={control.placeholder} className={clsx(control.mono && 'font-mono')} onChange={(e) => commonOnChange(e.currentTarget.value)} />
      )}
      {control.help && <p className="text-ui-xs text-fg-subtle">{control.help}</p>}
    </div>
  )
}

/** Parse "Label:Value" bulk lines — blank value slugs from the label, blank label uses the value. */
export function parseBulkOptions(text: string): Option[] {
  const out: Option[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const idx = line.indexOf(':')
    const label = (idx === -1 ? line : line.slice(0, idx)).trim()
    const val = (idx === -1 ? '' : line.slice(idx + 1)).trim()
    const value = slug(val || label)
    if (!value) continue
    out.push({ label: label || value, value })
  }
  return out
}

function OptionsEditor({ value, onChange, mandatory }: { value: Option[]; onChange: (next: Option[]) => void; mandatory?: boolean }) {
  const [bulk, setBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-fg-muted">Options{mandatory && <span className="text-danger-fg ml-0.5">*</span>}</div>
        <Button size="xs" variant="ghost" className="h-5 px-1 text-accent-fg" onClick={() => {
          if (!bulk) setBulkText(value.map((o) => `${o.label}:${o.value}`).join('\n'))
          else onChange(parseBulkOptions(bulkText))
          setBulk((b) => !b)
        }}>{bulk ? 'Done - apply lines' : 'Bulk edit'}</Button>
      </div>
      {bulk ? (
        <>
          <Textarea value={bulkText} onChange={(e) => setBulkText(e.currentTarget.value)} placeholder={'Draft:draft\nPublished:published'} rows={5} className="font-mono" />
          <p className="text-[11px] text-fg-subtle">One option per line as <span className="font-mono">Label:Value</span>. Missing value → slugged from the label; empty lines skipped.</p>
        </>
      ) : (
        <>
          {value.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={o.label} placeholder="Label" onChange={(e) => onChange(value.map((x, j) => j === i ? { ...x, label: e.currentTarget.value } : x))} />
              <Input value={o.value} placeholder="value" className={clsx('font-mono', !o.value && 'border-danger/40')}
                onChange={(e) => onChange(value.map((x, j) => j === i ? { ...x, value: slug(e.currentTarget.value) } : x))}
                onBlur={() => { if (!o.value && o.label) onChange(value.map((x, j) => j === i ? { ...x, value: slug(o.label) } : x)) }} />
              <Button size="xs" variant="ghost" aria-label="Remove option" className="size-7 shrink-0 p-0 text-fg-subtle hover:text-danger-fg" icon={<IconX className="size-3.5" />} onClick={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="xs" variant="ghost" icon={<IconPlus className="size-3.5" />} onClick={() => onChange([...value, { label: '', value: '' }])}>Add option</Button>
        </>
      )}
    </div>
  )
}

/** Searchable sibling-field picker for condition rules (types can have many fields). */
function FieldPicker({ value, siblings, onPick }: {
  value: string
  siblings: SiblingField[]
  onPick: (name: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = siblings.find((s) => s.name === value)
  const matches = matchSiblingFields(siblings, query)
  // Close on outside mousedown (the portaled list is outside this subtree).
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (triggerRef.current?.contains(t) || t.closest?.('[data-tangen-overlay]')) return
      setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])
  return (
    <div className="min-w-0 flex-1">
      <Button ref={triggerRef} variant="secondary" className="w-full justify-between gap-2 font-normal" onClick={() => { setPickerOpen((o) => !o); setQuery('') }}>
        <span className={clsx('truncate', !selected && 'text-fg-subtle')}>{selected ? (selected.label || selected.name) : 'Select field…'}</span>
        <IconChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </Button>
      {/* Portaled overlay so it floats above the fields instead of pushing them. */}
      <AnchoredDropdown anchorRef={triggerRef} open={pickerOpen} className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-popover">
        <div className="border-b border-border p-1.5">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search fields…" icon={<IconSearch className="size-3.5" />} />
        </div>
        <div className="max-h-44 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-ui-xs text-fg-subtle">No fields match “{query}”.</p>
          ) : matches.map((s) => (
            <Button key={s.name} variant="ghost" size="sm" className={clsx('w-full justify-start gap-2 rounded-none font-normal hover:bg-surface-sunken', s.name === value && 'text-accent-fg')} onClick={() => { onPick(s.name); setPickerOpen(false) }}>
              <span className="truncate">{s.label || s.name}</span>
              <span className="ml-auto shrink-0 font-mono text-ui-2xs text-fg-subtle">{s.name}</span>
            </Button>
          ))}
        </div>
      </AnchoredDropdown>
    </div>
  )
}

/** Value input for one rule, adapted to the referenced field's type. */
function RuleValueInput({ sibling, value, onChange }: { sibling: SiblingField | undefined; value: unknown; onChange: (v: unknown) => void }) {
  const ft = sibling?.fieldType
  if (ft === 'boolean') {
    return (
      <Select value={value === true ? 'true' : value === false ? 'false' : '__n'} onValueChange={(x: string) => onChange(x === 'true')}>
        <SelectItem value="__n">-</SelectItem>
        <SelectItem value="true">True</SelectItem>
        <SelectItem value="false">False</SelectItem>
      </Select>
    )
  }
  if ((ft === 'select' || ft === 'multiselect') && Array.isArray(sibling?.config?.options)) {
    return (
      <Select value={(value as string) || '__n'} onValueChange={(x: string) => onChange(x === '__n' ? '' : x)}>
        <SelectItem value="__n">-</SelectItem>
        {(sibling!.config!.options as Option[]).map((o) => <SelectItem key={o.value} value={o.value}>{o.label || o.value}</SelectItem>)}
      </Select>
    )
  }
  const numeric = ft === 'number' || ft === 'currency' || ft === 'rating'
  return (
    <Input type={numeric ? 'number' : ft === 'date' ? 'date' : 'text'} value={value == null ? '' : String(value)} placeholder="value"
      onChange={(e) => { const v = e.currentTarget.value; onChange(numeric ? (v === '' ? undefined : Number(v)) : v) }} />
  )
}

/** Multi-condition visibility editor — field dropdown + type-aware operator/value, all/any. */
export function ConditionalEditor({ value, onChange, label, siblings }: {
  value: ConditionalVisibility | undefined
  onChange: (v: unknown) => void
  label: string
  siblings: SiblingField[]
}) {
  // Local draft rows — keeps in-progress rules (empty field) visible; we persist only the
  // clean ones. (The saved config can't represent an incomplete rule, so it must live here.)
  const init = value && 'rules' in value ? value.rules : value ? [value as ConditionalRule] : []
  const initMatch = value && 'rules' in value ? value.match : 'all'
  const [rules, setRules] = useState<ConditionalRule[]>(init)
  const [match, setMatch] = useState<'all' | 'any'>(initMatch)

  const persist = (nextRules: ConditionalRule[], nextMatch: 'all' | 'any') => {
    const clean = nextRules.filter((r) => r.field)
    if (clean.length === 0) onChange(undefined)
    else if (clean.length === 1) onChange(clean[0])          // single → back-compat shape
    else onChange({ match: nextMatch, rules: clean })
  }
  const update = (nextRules: ConditionalRule[], nextMatch: 'all' | 'any' = match) => {
    setRules(nextRules); setMatch(nextMatch); persist(nextRules, nextMatch)
  }
  const setRule = (i: number, patch: Partial<ConditionalRule>) => update(rules.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addRule = () => update([...rules, { field: '', operator: 'eq' }])
  const removeRule = (i: number) => update(rules.filter((_, j) => j !== i))

  return (
    <div className="space-y-2">
      <span className="block text-ui-xs font-medium text-fg-muted">{label}</span>

      {rules.length > 0 && (
        <div className="space-y-1.5">
          {rules.map((rule, i) => {
            const sibling = siblings.find((s) => s.name === rule.field)
            const ops = conditionOperators(sibling?.fieldType)
            const needsValue = !VALUELESS_OPERATORS.includes(rule.operator)
            return (
              <div key={i} className="space-y-1.5">
                {/* The AND/OR joiner between rules - click to flip all vs any. */}
                {i > 0 && (
                  <div className="flex items-center gap-2">
                    <Button size="xs" variant="secondary" onClick={() => update(rules, match === 'all' ? 'any' : 'all')}
                      className="h-6 rounded-full px-2.5 text-ui-2xs font-semibold uppercase tracking-wide"
                      title="Toggle whether all or any of the rules must match">
                      {match === 'all' ? 'And' : 'Or'}
                    </Button>
                    <span className="text-ui-2xs text-fg-subtle">{match === 'all' ? 'all must match' : 'any can match'}</span>
                  </div>
                )}
                {/* One rule, read as "When <field> <operator> <value>". */}
                <div className="rounded-md border border-border bg-surface-raised p-2">
                  <div className="flex items-center gap-2">
                    <span className="w-9 shrink-0 text-ui-2xs font-medium text-fg-subtle">{i === 0 ? 'When' : (match === 'all' ? 'And' : 'Or')}</span>
                    <FieldPicker value={rule.field} siblings={siblings} onPick={(name) => setRule(i, { field: name })} />
                    <Button size="xs" variant="ghost" onClick={() => removeRule(i)} aria-label="Remove condition" className="size-6 shrink-0 p-0 text-fg-subtle hover:text-danger-fg" icon={<IconTrash className="size-3.5" />} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 pl-11">
                    <div className="min-w-0 flex-1">
                      <Select value={rule.operator} onValueChange={(x: string) => setRule(i, { operator: x as ConditionalRule['operator'] })}>
                        {ops.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </Select>
                    </div>
                    {needsValue && (
                      <div className="min-w-0 flex-1">
                        <RuleValueInput sibling={sibling} value={rule.value} onChange={(v) => setRule(i, { value: v })} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Button size="xs" variant="ghost" icon={<IconPlus className="size-3.5" />} onClick={addRule}>Add condition</Button>
      {siblings.length === 0 && <p className="text-ui-2xs text-fg-subtle">Add other fields first to condition on them.</p>}
    </div>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      {title && <div className="text-[11px] font-medium text-fg-subtle uppercase tracking-wide">{title}</div>}
      {children}
    </div>
  )
}

/**
 * The 4-tab capability panel (CU-1) — shared by the side Sheet and the container
 * modal's detail pane. Owns tab state (resets on field switch) and renders every
 * applicable control for the field's type.
 */
export function FieldConfigPanel({ field, onChange, siblings, showWidth = false, subfieldMode = false, checkReserved = false, onManageFields }: {
  field: BuilderField
  onChange: (patch: Patch) => void
  siblings: SiblingField[]
  showWidth?: boolean
  subfieldMode?: boolean
  checkReserved?: boolean
  onManageFields?: () => void
}) {
  const [tab, setTab] = useState<SheetTab>('general')
  const installed = useInstalledFieldTypes(true)
  const localesEnabled = useLocaleStore((s) => s.enabled)
  useEffect(() => { setTab('general') }, [field.key])

  // Every applicable control for this type, grouped into the four tabs. A custom
  // (extension/site) type has no built-in capabilities — its configSchema-generated
  // controls land on General.
  const tabs = useMemo(() => {
    const meta = installed.find((f) => f.name === field.fieldType)
    const extra = typeControls(field.fieldType).length
      ? []
      : configSchemaToControls(meta?.configSchema as Record<string, ConfigSchemaProp> | undefined)
    const groups = controlsByTab(field.fieldType, extra)
    // General option suppression: a field type may hide arbitrary controls via
    // defineFieldType `hideControls` (e.g. a `form` reference has no default value),
    // plus `config.ai` when it opts out of AI. The trailing `aiEnabled` term is a
    // fallback for API responses predating `hiddenControls`.
    const hidden = [
      ...(meta?.hiddenControls ?? []),
      ...(meta?.aiEnabled === false ? ['config.ai'] : []),
    ]
    // Locale-gated controls (e.g. Localized on General) only show when locales are on;
    // sub-fields drop admin list/filter options — rows never appear as columns.
    for (const key of Object.keys(groups) as SheetTab[]) {
      groups[key] = groups[key].filter((c) =>
        (!c.requiresLocales || localesEnabled)
        // The server only accepts per-locale values for LOCALIZABLE_TYPES -
        // never offer the toggle where a save would 422 (e.g. multiselect).
        && (c.path !== 'config.localized' || isLocalizableFieldType(field.fieldType))
        && (!subfieldMode || !SUBFIELD_EXCLUDED_PATHS.has(c.path))
        && !isControlHidden(c.path, hidden),
      )
    }
    return groups
  }, [field.fieldType, installed, localesEnabled, subfieldMode])

  return (
    <div className="space-y-4">
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 border-b border-border-subtle bg-surface px-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} variant="underline">
          <TabsList className="w-full justify-center gap-6 border-b-0">
            {SHEET_TABS.map((t) => { const Ico = TAB_ICON[t.id]; return (
              <TabsTrigger key={t.id} value={t.id}>{Ico && <Ico className="size-4" />}{t.label}</TabsTrigger>
            ) })}
          </TabsList>
        </Tabs>
      </div>

      {/* Containers: the fields themselves live in the Manage Fields modal. */}
      {tab === 'general' && onManageFields && ['repeater', 'group', 'component'].includes(field.fieldType) && (
        (() => {
          const isComponent = field.fieldType === 'component'
          const cfg = field.config as { fields?: unknown[]; groupFields?: unknown[]; components?: unknown[] }
          const n = (field.fieldType === 'group' ? cfg.groupFields?.length : field.fieldType === 'repeater' ? cfg.fields?.length : (cfg.components ?? []).length) ?? 0
          const noun = isComponent ? 'component' : 'field'
          const ManageIcon = isComponent ? IconStack : IconListChecks
          return (
            <Button variant="secondary" onClick={onManageFields} disabled={!field.label.trim()}
              title={!field.label.trim() ? 'Give the field a label first' : undefined}
              className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left font-normal hover:border-accent">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-muted text-accent-fg"><ManageIcon className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-ui-sm font-medium text-fg">{isComponent ? 'Manage components' : 'Manage fields'}</span>
                <span className="block text-ui-xs text-fg-muted">{n} {noun}{n === 1 ? '' : 's'} inside{n === 0 ? ' - add some' : ''}</span>
              </span>
              <IconChevronRight className="size-4 shrink-0 text-fg-subtle" />
            </Button>
          )
        })()
      )}

      {tab === 'presentation' && showWidth && (
        <div className="text-xs text-fg-muted">
          <span className="block mb-1">Width</span>
          <div className="flex w-fit gap-1">
            {WIDTHS.map((w) => (
              <Button key={w} size="sm" variant={field.width === w ? 'primary' : 'secondary'} className="capitalize" onClick={() => onChange({ width: w })}>{w}</Button>
            ))}
          </div>
        </div>
      )}

      {tabs[tab].length > 0 ? (
        <Section>
          {tabs[tab].map((c) => <ControlRow key={c.path} field={field} control={c} onChange={onChange} siblings={siblings} checkReserved={checkReserved} />)}
        </Section>
      ) : tab !== 'presentation' || !showWidth ? (
        <p className="text-xs text-fg-subtle py-4 text-center">Nothing to configure here for a {field.fieldType} field.</p>
      ) : null}
    </div>
  )
}

export function FieldConfigSheet({ field, onChange, onClose, showWidth = true, checkReserved = false, subfieldMode = false, onManageFields, allFields = [] }: {
  field: BuilderField | null
  onChange: (patch: Patch) => void
  onClose: () => void
  /** Width only applies in the Main stage — hidden for sidebar fields. */
  showWidth?: boolean
  /** Flag reserved (system-column) names — content-type builder only. */
  checkReserved?: boolean
  /** Sub-fields (container rows): hide admin list/filter options — they never apply. */
  subfieldMode?: boolean
  /** Containers: opens the Manage Fields modal for this field (button on General). */
  onManageFields?: () => void
  /** Sibling fields (for the conditional-visibility field dropdown). */
  allFields?: SiblingField[]
}) {
  const open = !!field

  // Exclude the edited field by KEY (not name) — otherwise a renamed-to-duplicate field
  // would filter out its collision partner and dodge the duplicate check.
  const siblings = useMemo(
    () => allFields.filter((f) => (f.key ? f.key !== field?.key : f.name !== field?.name)),
    [allFields, field],
  )

  // Validate this field's mandatory values when Done is hit; block close with problems.
  const [problems, setProblems] = useState<string[]>([])
  useEffect(() => { setProblems([]) }, [field?.key])
  function done() {
    if (!field) return onClose()
    const errs = validateBuilderField(field, new Set(siblings.map((s) => s.name)), { checkReserved, sheetLevel: true })
    if (errs.length) { setProblems(errs); return }
    setProblems([])
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit field</SheetTitle>
          <SheetDescription className="mt-1">{field?.fieldType} field</SheetDescription>
        </SheetHeader>

        {field && (
          <SheetBody>
            <FieldConfigPanel
              field={field}
              onChange={onChange}
              siblings={siblings}
              showWidth={showWidth}
              subfieldMode={subfieldMode}
              checkReserved={checkReserved}
              onManageFields={onManageFields}
            />
          </SheetBody>
        )}

        {problems.length > 0 && (
          <Callout variant="danger" className="mx-6 mb-2">
            <ul className="space-y-0.5 text-xs">
              {problems.map((p, i) => <li key={i}>• {p}</li>)}
            </ul>
          </Callout>
        )}
        <SheetFooter>
          <Button size="sm" onClick={done}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
