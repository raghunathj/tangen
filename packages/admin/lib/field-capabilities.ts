/**
 * File Name: field-capabilities.ts
 * Purpose: The declarative capability model that drives the schema builder's
 *   field-config Sheet. Each field type maps to a list of controls (a control =
 *   a label + kind + the dot-path on the field it reads/writes). The Sheet renders
 *   these generically, so a field's real capabilities (help text, validation,
 *   conditional visibility, per-type options) appear without hardcoded branches.
 *   Custom (extension/site) field types generate controls from their configSchema.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { FieldType } from '@tangen/types'
import { FILTERABLE_TYPES, UNIQUE_TYPES, NON_LISTABLE_TYPES, DEFAULT_VALUE_KIND, DYNAMIC_DEFAULT_OPTIONS, isLocalizableFieldType } from '@tangen/types'
import type { BuilderField } from './schema-builder-model'

export type ControlKind =
  | 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'options' | 'fieldRef' | 'typeRef' | 'typeRefMulti' | 'multiCheck' | 'json'
  | 'stringList' | 'conditional' | 'components' | 'color' | 'date' | 'imageVariants'

export interface Control {
  /** Dot-path on the BuilderField (e.g. 'label', 'required', 'config.admin.helpText'). */
  path: string
  label: string
  kind: ControlKind
  help?: string
  placeholder?: string
  /** Render the input monospace (code ids, patterns). */
  mono?: boolean
  /** Slugify text input (names, option values). */
  slug?: boolean
  /** Fixed choices for `select`. */
  choices?: { label: string; value: string }[]
  /** Only render when the workspace has localization enabled (>1 locale). */
  requiresLocales?: boolean
  /** The value is required for the field to be saveable (shown with an asterisk). */
  mandatory?: boolean
  /** Toggle only: the config defaults to ON, so the switch shows on until explicitly set false. */
  defaultOn?: boolean
  /** Default-value control only: declarative dynamic options ({ $dynamic }) for this type. */
  dynamicChoices?: { value: string; label: string }[]
  /** Force the Sheet tab (overrides the path-based classification). */
  tab?: SheetTab
}

// ── Universal controls (every field type) ─────────────────────────────────────

/** Basics shown at the top for every field. Width is handled separately (main only). */
export const BASIC_CONTROLS: Control[] = [
  { path: 'label', label: 'Label', kind: 'text', mandatory: true },
  { path: 'name', label: 'Name (code id)', kind: 'text', mono: true, slug: true, mandatory: true },
  { path: 'required', label: 'Required', kind: 'toggle', help: 'Entries cannot be saved as complete or published while this field is empty.' },
  { path: 'config.admin.helpText', label: 'Help text', kind: 'text', help: 'Shown below the input in the editor.' },
]

/** Advanced controls (every field) — collapsed by default in the Sheet. */
export const ADVANCED_CONTROLS: Control[] = [
  { path: 'config.admin.placeholder', label: 'Placeholder', kind: 'text' },
  { path: 'config.admin.readonly', label: 'Read-only', kind: 'toggle' },
  { path: 'config.admin.hidden', label: 'Hidden in editor', kind: 'toggle' },
  { path: 'config.admin.showInList', label: 'Show as list column', kind: 'toggle' },
  { path: 'config.admin.showInFilter', label: 'Show as list filter', kind: 'toggle' },
  { path: 'config.localized', label: 'Localized (per-locale value)', kind: 'toggle', requiresLocales: true },
  { path: 'config.validation.unique', label: 'Unique', kind: 'toggle', help: 'No two entries of this type may share this value - writes with a duplicate are rejected (409).' },
  // Per-field AI (the ai.hint convention) — honored by fill, generate, and image tools.
  { path: 'config.ai.enabled', label: 'Allow AI to fill this field', kind: 'toggle', defaultOn: true, help: 'On by default. Turn off to exclude this field from AI fill, content generation, and image tools.' },
  { path: 'config.ai.hint', label: 'AI hint', kind: 'text', help: 'Tells AI what this field holds and how to write it, e.g. "One-sentence teaser, max 160 chars".' },
  { path: 'config.admin.conditionalVisibility', label: 'Show only when…', kind: 'conditional' },
  // Soft-disable — hides the field from EVERY surface (not just the editor like
  // "hidden"); the column + data are kept and it's reversible.
  { path: 'disabled', label: 'Disable field', kind: 'toggle', tab: 'presentation', help: 'Hides this field everywhere - admin editor, REST, TangenQL, and GraphQL - but keeps its column and data. Reversible; stronger than "hidden" (which only hides it in the editor).' },
]

// ── Per-type capability controls ──────────────────────────────────────────────

const TEXTUAL: Control[] = [
  { path: 'config.validation.minLength', label: 'Min length', kind: 'number' },
  { path: 'config.validation.maxLength', label: 'Max length', kind: 'number' },
  // Non-blocking guidance (B4) — amber hint, save proceeds
  { path: 'config.validation.warnings.maxLength', label: 'Warn above length', kind: 'number', help: 'Amber guidance only - saving still succeeds.' },
  { path: 'config.validation.warnings.message', label: 'Warning message', kind: 'text', placeholder: 'Keep it short for SEO' },
]

const CAPABILITIES: Partial<Record<FieldType, Control[]>> = {
  slug: [
    { path: 'config.source', label: 'Generate from', kind: 'fieldRef', help: "Sibling field the editor's Generate button derives the slug from (title works too)." },
    ...TEXTUAL,
    { path: 'config.validation.unique', label: 'Unique', kind: 'toggle', help: 'On by default for slugs - turn off to allow duplicates.' },
  ],
  text: [...TEXTUAL, { path: 'config.validation.pattern', label: 'Pattern (regex)', kind: 'text', mono: true }],
  textarea: TEXTUAL,
  email: [...TEXTUAL, { path: 'config.validation.allowedDomains', label: 'Allowed domains', kind: 'stringList' }],
  url: [...TEXTUAL, { path: 'config.validation.httpsOnly', label: 'HTTPS only', kind: 'toggle' }],
  phone: [{ path: 'config.validation.e164', label: 'Enforce E.164', kind: 'toggle' }],
  richtext: [
    { path: 'config.toolbar', label: 'Toolbar', kind: 'select', choices: [{ label: 'Basic (default)', value: 'basic' }, { label: 'Advanced', value: 'advanced' }], help: 'Basic = bold/italic/headings/lists/link. Advanced adds code, quotes, HR, undo/redo, HTML view.' },
    { path: 'config.media', label: 'Allow embedded images', kind: 'toggle' },
  ],
  number: [
    { path: 'config.validation.min', label: 'Min', kind: 'number' },
    { path: 'config.validation.max', label: 'Max', kind: 'number' },
    { path: 'config.validation.integer', label: 'Integer only', kind: 'toggle' },
    { path: 'config.validation.step', label: 'Step', kind: 'number' },
  
    { path: 'config.admin.displayAs', label: 'Display as', kind: 'select', choices: [
      { label: 'Input (default)', value: 'input' }, { label: 'Slider', value: 'slider' },
    ], help: 'Slider needs Min and Max set under Validation.' },
  ],
  range: [
    { path: 'config.validation.min', label: 'Minimum', kind: 'number', mandatory: true, tab: 'general', help: 'Lowest value either end may take.' },
    { path: 'config.validation.max', label: 'Maximum', kind: 'number', mandatory: true, tab: 'general', help: 'Highest value either end may take.' },
  ],
  currency: [
    { path: 'config.currencyCode', label: 'Currency code', kind: 'text', mono: true, placeholder: 'INR' },
    { path: 'config.validation.min', label: 'Min', kind: 'number' },
    { path: 'config.validation.max', label: 'Max', kind: 'number' },
  ],
  rating: [{ path: 'config.max', label: 'Max rating', kind: 'number' }],
  boolean: [{ path: 'config.validation.requiredAcknowledgement', label: 'Must be accepted', kind: 'toggle', help: 'The toggle must be ON to publish - for consents like “I agree to the terms”.' }],
  date: [
    { path: 'config.includeTime', label: 'Include time', kind: 'toggle' },
    { path: 'config.validation.minDate', label: 'Earliest date', kind: 'text', placeholder: 'YYYY-MM-DD' },
    { path: 'config.validation.maxDate', label: 'Latest date', kind: 'text', placeholder: 'YYYY-MM-DD' },
  ],
  select: [
    { path: 'config.optionsSource', label: 'Options source', kind: 'select', choices: [
      { label: 'Static (defined here)', value: 'static' }, { label: 'Dynamic (served by site code)', value: 'dynamic' },
    ], help: 'Dynamic options come from a dynamicOptions function in code - for developers.' },
    { path: 'config.options', label: 'Options', kind: 'options', mandatory: true },
    { path: 'config.default', label: 'Default value', kind: 'text', placeholder: 'option value', help: 'Pre-selected for new entries - must match an option value.' },
    { path: 'config.admin.displayAs', label: 'Display as', kind: 'select', choices: [
      { label: 'Dropdown (default)', value: 'dropdown' }, { label: 'Radio group', value: 'radio' }, { label: 'Segmented buttons', value: 'segmented' },
    ], help: 'Radio/segmented suit up to ~6 options.' },
  ],
  multiselect: [
    { path: 'config.optionsSource', label: 'Options source', kind: 'select', choices: [
      { label: 'Static (defined here)', value: 'static' }, { label: 'Dynamic (served by site code)', value: 'dynamic' },
    ], help: 'Dynamic options come from a dynamicOptions function in code - for developers.' },
    { path: 'config.options', label: 'Options', kind: 'options', mandatory: true },
    { path: 'config.validation.minSelections', label: 'Min selections', kind: 'number' },
    { path: 'config.validation.maxSelections', label: 'Max selections', kind: 'number' },
    { path: 'config.admin.displayAs', label: 'Display as', kind: 'select', choices: [
      { label: 'Pill toggles (default)', value: 'dropdown' }, { label: 'Checkbox list', value: 'checkboxList' },
    ] },
  ],
  relation: [
    { path: 'config.targetType', label: 'Target type', kind: 'typeRef', mandatory: true },
    { path: 'config.many', label: 'Allow many', kind: 'toggle' },
    { path: 'config.onDelete', label: 'When the target is deleted', kind: 'select', choices: [
      { label: 'Clear the reference (default)', value: 'setNull' },
      { label: 'Block the delete (restrict)', value: 'restrict' },
    ], help: 'Restrict refuses to delete an entry other entries still reference.' },
    { path: 'config.admin.listDisplayField', label: 'Display field', kind: 'text', mono: true, placeholder: 'title' },
    { path: 'config.filter', label: 'Restrict selectable entries', kind: 'json', placeholder: '{ "status": "published" }', help: 'Query filter on the target type - the picker only offers matching entries, and the API rejects others.' },
  ],
  link: [
    { path: 'config.allowedKinds', label: 'Destinations offered', kind: 'multiCheck', choices: [
      { label: 'Content in this workspace', value: 'internal' },
      { label: 'External URL', value: 'external' },
    ], help: 'Nothing checked = both. The editor offers only what is checked here.' },
    { path: 'config.allowedTargets', label: 'Linkable content types', kind: 'typeRefMulti', help: 'Which types an internal link may point at. Empty = every type.' },
    { path: 'config.anchor', label: 'Allow an anchor', kind: 'toggle', defaultOn: true, help: 'A fragment on the destination, stored without the # (e.g. team).' },
    { path: 'config.query', label: 'Allow query parameters', kind: 'toggle', defaultOn: true },
    { path: 'config.validation.allowedSchemes', label: 'Allowed URL schemes', kind: 'stringList', placeholder: 'https', help: 'External links only. Empty = https, http, mailto, tel. javascript: and data: are never accepted.' },
    { path: 'config.validation.httpsOnly', label: 'HTTPS only', kind: 'toggle', help: 'External links must start with https://.' },
    { path: 'config.validation.allowedDomains', label: 'Allowed domains', kind: 'stringList', placeholder: 'example.com' },
  ],
  object: [{ path: 'config.include', label: 'Allowed types', kind: 'typeRefMulti', help: 'Which content types are selectable. Empty = every type.' }],
  media: [
    { path: 'config.accept', label: 'Media kinds', kind: 'multiCheck', choices: [
      { label: 'Images', value: 'image' }, { label: 'Videos', value: 'video' },
      { label: 'Audio', value: 'audio' }, { label: 'Documents', value: 'document' },
      { label: 'Other', value: 'other' },
    ], help: 'Nothing checked = every kind. Combines with MIME types as a union.' },
    { path: 'config.mimeTypes', label: 'Allowed MIME types', kind: 'stringList', placeholder: 'image/png', help: 'Granular allow-list (e.g. only PDFs) - a file passes when it matches a kind OR a MIME type.' },
    { path: 'config.validation.maxFileSize', label: 'Max file size (bytes)', kind: 'number' },
    // Image processing (applies to image uploads only) — overrides the workspace imagePresets.
    { path: 'config.skipPresets', label: 'Skip workspace image presets', kind: 'toggle', help: 'Ignore the workspace-wide image presets for this field.' },
    { path: 'config.imageOverrides.quality', label: 'Image quality (1–100)', kind: 'number', help: 'Output quality for generated image variants.' },
    { path: 'config.imageOverrides.format', label: 'Image format', kind: 'select', choices: [
      { label: 'Original', value: 'original' }, { label: 'WebP', value: 'webp' }, { label: 'AVIF', value: 'avif' },
      { label: 'JPEG', value: 'jpeg' }, { label: 'PNG', value: 'png' },
    ], help: 'Convert image variants to this format.' },
    { path: 'config.variants', label: 'Named image variants', kind: 'imageVariants', help: 'Extra sizes generated for each upload (e.g. thumb 200×200). Referenced by name in the API.' },
  ],
  code: [{ path: 'config.language', label: 'Language', kind: 'text', mono: true, placeholder: 'json' }],
  repeater: [
    { path: 'config.validation.minRows', label: 'Min rows', kind: 'number', help: 'Publishing requires at least this many rows.' },
    { path: 'config.validation.maxRows', label: 'Max rows', kind: 'number' },
  ],
  group: [
    { path: 'config.collapsedByDefault', label: 'Start collapsed', kind: 'toggle', help: 'The group accordion opens collapsed in the editor.' },
  ],
  component: [
    { path: 'config.validation.minComponents', label: 'Min blocks', kind: 'number' },
    { path: 'config.validation.maxComponents', label: 'Max blocks', kind: 'number' },
  ],
}

/** The per-type capability controls for a built-in field type (empty for unknown/custom). */
export function typeControls(fieldType: string): Control[] {
  const d = defaultControlFor(fieldType)
  return [...(d ? [d] : []), ...(CAPABILITIES[fieldType as FieldType] ?? [])]
}

// ── Per-type applicability of the "universal" options ─────────────────────────
// The matrix lives in @tangen/types (field-applicability.ts) — one source of truth
// shared with the per-type authoring config interfaces, so UI and code can't drift.

export { FILTERABLE_TYPES, UNIQUE_TYPES } from '@tangen/types'

/**
 * Whether a toggle control renders as ON. Unset (undefined/null) reflects the
 * config's default — ON when the control is `defaultOn`, else OFF — so a
 * default-on config (e.g. AI fill) shows on until the user explicitly turns it off.
 */
export function resolveToggleChecked(value: unknown, defaultOn?: boolean): boolean {
  if (value === undefined || value === null) return !!defaultOn
  return value === true
}

/** Does a universal control apply to this field type? */
export function controlAppliesTo(control: Control, fieldType: string): boolean {
  switch (control.path) {
    case 'config.admin.showInFilter': return FILTERABLE_TYPES.has(fieldType)
    case 'config.admin.showInList': return !NON_LISTABLE_TYPES.has(fieldType)
    // slug carries its OWN unique toggle (on by default) — skip the generic one
    case 'config.validation.unique': return UNIQUE_TYPES.has(fieldType) && fieldType !== 'slug'
    // Localization applies only to types that can hold a per-locale value —
    // hidden for assets, option enums, and containers (single source in @tangen/types).
    case 'config.localized': return isLocalizableFieldType(fieldType)
    default: return true
  }
}

/** The advanced ("Admin Settings") controls that apply to this field type. */
export function advancedControlsFor(fieldType: string): Control[] {
  return ADVANCED_CONTROLS.filter((c) => controlAppliesTo(c, fieldType))
}

/** Default-value input kind per DEFAULT_VALUE_KIND primitive. */
const DEFAULT_KIND_TO_CONTROL: Record<string, ControlKind> = {
  string: 'text', number: 'number', boolean: 'toggle', date: 'date', color: 'color',
}

/** Human labels for the declarative dynamic default kinds. */
const DYNAMIC_LABELS: Record<string, string> = {
  now: 'Now (time of creation)', currentUser: 'Current user (actor id)', uuid: 'Random UUID',
}

/** The default-value control for a type, with the right input kind — or null when N/A. */
export function defaultControlFor(fieldType: string): Control | null {
  const primitive = DEFAULT_VALUE_KIND[fieldType]
  if (!primitive) return null   // media/relation/repeater/component/select/… have no simple default
  const kind = fieldType === 'textarea' ? 'textarea' : DEFAULT_KIND_TO_CONTROL[primitive]
  const dynamics = DYNAMIC_DEFAULT_OPTIONS[fieldType] ?? []
  return {
    path: 'config.default', label: 'Default value', kind,
    ...(dynamics.length ? { dynamicChoices: dynamics.map((d) => ({ value: d, label: DYNAMIC_LABELS[d] ?? d })) } : {}),
  }
}

// ── Sheet tabs: General | Validation | Presentation | Conditional ─────────────

export type SheetTab = 'general' | 'validation' | 'presentation' | 'logic'

export const SHEET_TABS: { id: SheetTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'validation', label: 'Validation' },
  { id: 'presentation', label: 'Presentation' },
  { id: 'logic', label: 'Conditional' },
]

/** Controls that make no sense on SUB-fields (rows inside containers). */
export const SUBFIELD_EXCLUDED_PATHS: ReadonlySet<string> = new Set([
  'config.admin.showInList', 'config.admin.showInFilter', 'config.admin.searchable', 'config.admin.listDisplayField',
  // disable applies to a real column, not a container row-field
  'disabled',
])

/** Display-oriented admin options (Presentation tab). Localized lives on General. */
const PRESENTATION_PATHS = new Set([
  'config.admin.displayAs',
  'config.admin.readonly', 'config.admin.hidden', 'config.admin.showInList',
  'config.admin.showInFilter', 'config.admin.listDisplayField',
])

/**
 * Which Sheet tab a control belongs on — classified by its dot-path: validation rules
 * (incl. `required`) → Validation; display toggles → Presentation; the conditional
 * editor → Conditional; identity/help/default/type-config → General.
 */
export function tabForControl(control: Control): SheetTab {
  if (control.tab) return control.tab
  if (control.kind === 'conditional') return 'logic'
  if (control.path === 'required' || control.path.startsWith('config.validation.')) return 'validation'
  if (PRESENTATION_PATHS.has(control.path)) return 'presentation'
  return 'general'
}

/**
 * Every applicable control for a field type, grouped by Sheet tab. `extra` carries a
 * custom type's configSchema-generated controls (they land on General). Width is a
 * bespoke Presentation control rendered by the Sheet itself.
 */
export function controlsByTab(fieldType: string, extra: Control[] = []): Record<SheetTab, Control[]> {
  const all = [
    ...BASIC_CONTROLS,
    ...advancedControlsFor(fieldType),
    ...typeControls(fieldType),
    ...extra,
  ]
  const groups: Record<SheetTab, Control[]> = { general: [], validation: [], presentation: [], logic: [] }
  for (const c of all) groups[tabForControl(c)].push(c)
  // Localized reads best as the final General option (after default + type config).
  const li = groups.general.findIndex((c) => c.path === 'config.localized')
  if (li !== -1) groups.general.push(...groups.general.splice(li, 1))
  return groups
}

// ── Custom field type configSchema → controls ─────────────────────────────────

/** A property in a custom field type's `configSchema`. */
export interface ConfigSchemaProp {
  type?: 'string' | 'number' | 'boolean'
  label?: string
  description?: string
  default?: unknown
  options?: { label: string; value: string }[]
}

/**
 * Generates controls from a custom field type's `configSchema` (a flat map of
 * config keys). Each key writes to `config.<key>`. Unknown types fall back to text.
 */
export function configSchemaToControls(schema: Record<string, ConfigSchemaProp> | undefined | null): Control[] {
  if (!schema) return []
  return Object.entries(schema).map(([key, prop]) => {
    const base = { path: `config.${key}`, label: prop.label ?? key, help: prop.description }
    if (prop.options?.length) return { ...base, kind: 'select' as const, choices: prop.options }
    if (prop.type === 'number') return { ...base, kind: 'number' as const }
    if (prop.type === 'boolean') return { ...base, kind: 'toggle' as const }
    return { ...base, kind: 'text' as const }
  })
}

// ── Conditional-rule operators (per referenced field type) ────────────────────

const OP = {
  eq: { label: 'equals', value: 'eq' },
  neq: { label: 'not equals', value: 'neq' },
  gt: { label: 'greater than', value: 'gt' },
  lt: { label: 'less than', value: 'lt' },
  contains: { label: 'contains', value: 'contains' },
  empty: { label: 'is empty', value: 'empty' },
  notEmpty: { label: 'is not empty', value: 'notEmpty' },
}

/** Operators offered for a condition whose referenced field is of `fieldType`. */
export function conditionOperators(fieldType?: string): { label: string; value: string }[] {
  switch (fieldType) {
    case 'boolean':
      return [OP.eq, OP.neq]
    case 'number': case 'currency': case 'rating': case 'date':
      return [OP.eq, OP.neq, OP.gt, OP.lt, OP.empty, OP.notEmpty]
    default:
      return [OP.eq, OP.neq, OP.contains, OP.empty, OP.notEmpty]
  }
}

/** Operators that don't take a value. */
export const VALUELESS_OPERATORS = ['empty', 'notEmpty']

/** Filter sibling fields by a search query (name or label substring, case-insensitive). */
export function matchSiblingFields<T extends { name: string; label: string }>(fields: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return fields
  return fields.filter((f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
}

// ── Component field: allowed-component refs ────────────────────────────────────

/** A component field's `config.components` entry — a reusable name (string) or an inline def. */
export type ComponentRef = string | { name: string; [k: string]: unknown }

/** True when the reusable component `name` is currently selected. */
export function hasComponentRef(components: ComponentRef[] | undefined, name: string): boolean {
  return (components ?? []).some((c) => (typeof c === 'string' ? c === name : c.name === name))
}

/** Adds/removes a reusable component name; preserves inline (object) defs and order. */
export function toggleComponentRef(components: ComponentRef[] | undefined, name: string): ComponentRef[] {
  const list = components ?? []
  return hasComponentRef(list, name)
    ? list.filter((c) => (typeof c === 'string' ? c !== name : c.name !== name))
    : [...list, name]
}

// ── Dot-path read / write on a BuilderField ───────────────────────────────────

/** Reads a control's current value from a field by dot-path. */
export function readValue(field: BuilderField, path: string): unknown {
  return path.split('.').reduce<any>((cur, key) => (cur == null ? undefined : cur[key]), field)
}

/**
 * Produces the reducer patch that sets `path` to `value` — cloning the affected
 * top-level object (label/name/required at the root, or a nested config object).
 */
export function writeValue(field: BuilderField, path: string, value: unknown): Partial<Omit<BuilderField, 'key'>> {
  const parts = path.split('.')
  const [top, ...rest] = parts
  if (rest.length === 0) return { [top]: value } as Partial<BuilderField>

  const root: any = { ...((field as any)[top] ?? {}) }
  let cur = root
  for (let i = 0; i < rest.length - 1; i++) {
    cur[rest[i]] = { ...(cur[rest[i]] ?? {}) }
    cur = cur[rest[i]]
  }
  cur[rest[rest.length - 1]] = value
  return { [top]: root } as Partial<BuilderField>
}
