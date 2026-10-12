/**
 * File Name: field-configs.ts
 * Purpose: Per-field-type AUTHORING config interfaces — each field type accepts only the
 *   validation rules, admin settings, and config props that actually apply to it, so
 *   `field.color({ validation: { unique: true } })` is a compile error (mirroring the
 *   schema-builder UI's applicability matrix in field-applicability.ts). The stored/erased
 *   `FieldConfig` stays permissive — only authoring tightens.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Composed from the rule/admin pieces in object-types.ts. Excess
 *   property checks on object literals are what enforce this at authoring time.
 */
import type {
  CommonRules, UniqueRule, TextRules, DomainRules, UrlRules, LinkRules, PhoneRules, NumberRules,
  BooleanRules, DateRules, SelectionRules, MediaRules, RepeaterRules, ComponentRules,
  FieldAdminBase, FieldAdminListable, FieldAdminFilterable, FieldAdminRelationDisplay,
  FieldAIConfig, ImageVariant, ImageOverrides, SubField, ComponentDef,
  FieldHooks, FieldValidateFn, DynamicOptionsFn, FieldConfig,
} from './object-types'
import type { MediaCategory } from './media'
import type { LinkKind } from './link'
import type { DynamicDefault } from './field-applicability'

// ── Shared building blocks ─────────────────────────────────────────────────────

/** Admin settings for filterable scalar/reference types. */
export type ScalarFieldAdmin = FieldAdminBase & FieldAdminListable & FieldAdminFilterable
/** Admin settings for listable-but-not-filterable types (color, time, tags, code). */
export type ListableFieldAdmin = FieldAdminBase & FieldAdminListable
/** Admin settings for container/rich types (no list column, no filter). */
export type ContainerFieldAdmin = FieldAdminBase

/** Config options every field type supports. */
export interface FieldConfigCommon {
  /** Translatable per locale — value lives in the <type>_i18n side table. */
  localized?: boolean
  /** Create a DB index for this column. */
  index?: boolean
  /** MCP exposure — `false` hides the field from MCP reads/writes. */
  mcp?: boolean
  /** Knowledge (RAG) opt-in. */
  knowledge?: boolean
  /** Content AI settings for this field. */
  ai?: FieldAIConfig
}

// ── Per-type configs ───────────────────────────────────────────────────────────

export interface TextFieldConfig extends FieldConfigCommon {
  default?: string | DynamicDefault
  validation?: CommonRules & UniqueRule & TextRules
  admin?: ScalarFieldAdmin
}

export interface SlugFieldConfig extends FieldConfigCommon {
  /** Sibling field name (or 'title') the editor's Generate button derives from. */
  source?: string
  validation?: CommonRules & UniqueRule & TextRules
  admin?: ScalarFieldAdmin
}

export interface RangeFieldConfig extends FieldConfigCommon {
  /** Bounds for BOTH ends (validation.min ≤ value.min ≤ value.max ≤ validation.max). */
  validation?: CommonRules & NumberRules
  admin?: ScalarFieldAdmin
}

export interface EmailFieldConfig extends FieldConfigCommon {
  default?: string
  validation?: CommonRules & UniqueRule & TextRules & DomainRules
  admin?: ScalarFieldAdmin
}

export interface UrlFieldConfig extends FieldConfigCommon {
  default?: string
  validation?: CommonRules & UniqueRule & TextRules & DomainRules & UrlRules
  admin?: ScalarFieldAdmin
}

export interface PhoneFieldConfig extends FieldConfigCommon {
  default?: string
  /** Hint for formatting; not strictly enforced. */
  countryCode?: string | string[]
  validation?: CommonRules & UniqueRule & TextRules & PhoneRules
  admin?: ScalarFieldAdmin
}

export interface TextareaFieldConfig extends FieldConfigCommon {
  default?: string
  validation?: CommonRules & TextRules
  admin?: ScalarFieldAdmin
}

export interface RichtextFieldConfig extends FieldConfigCommon {
  /** Toolbar capability level ('basic' | 'advanced', default 'advanced'). */
  toolbar?: 'basic' | 'advanced'
  /** Enable image embedding inside the richtext editor. */
  media?: boolean
  validation?: CommonRules
  admin?: ContainerFieldAdmin
}

export interface NumberFieldConfig extends FieldConfigCommon {
  default?: number
  validation?: CommonRules & UniqueRule & NumberRules
  admin?: ScalarFieldAdmin
}

export interface BooleanFieldConfig extends FieldConfigCommon {
  default?: boolean
  validation?: CommonRules & BooleanRules
  admin?: ScalarFieldAdmin
}

export interface DateFieldConfig extends FieldConfigCommon {
  /** ISO date/date-time default, or a dynamic { $dynamic: 'now' }. */
  default?: string | DynamicDefault
  includeTime?: boolean
  validation?: CommonRules & DateRules
  admin?: ScalarFieldAdmin
}

export interface TimeFieldConfig extends FieldConfigCommon {
  default?: string
  validation?: CommonRules
  admin?: ListableFieldAdmin
}

export interface ColorFieldConfig extends FieldConfigCommon {
  /** Hex colour default, e.g. '#4F46E5'. */
  default?: string
  validation?: CommonRules
  admin?: ListableFieldAdmin
}

export interface TagsFieldConfig extends FieldConfigCommon {
  validation?: CommonRules & SelectionRules
  admin?: ListableFieldAdmin
}

export interface CodeFieldConfig extends FieldConfigCommon {
  /** Language hint for display (e.g. 'json', 'html'). */
  language?: string
  validation?: CommonRules & TextRules
  admin?: ListableFieldAdmin
}

export interface GeopointFieldConfig extends FieldConfigCommon {
  validation?: CommonRules
  admin?: ContainerFieldAdmin
}

export interface CurrencyFieldConfig extends FieldConfigCommon {
  default?: number
  /** ISO currency code shown next to the input (display only, e.g. 'INR'). */
  currencyCode?: string
  validation?: CommonRules & NumberRules
  admin?: ScalarFieldAdmin
}

export interface RatingFieldConfig extends FieldConfigCommon {
  default?: number
  /** Rating scale upper bound (default 5). */
  max?: number
  validation?: CommonRules & NumberRules
  admin?: ScalarFieldAdmin
}

export interface SelectFieldConfig extends FieldConfigCommon {
  /** Pre-selected option value for new entries. */
  default?: string
  options?: { label: string; value: string }[]
  /** 'dynamic' = options served by site code; 'static'/absent = defined in config. */
  optionsSource?: 'static' | 'dynamic'
  validation?: CommonRules
  admin?: ScalarFieldAdmin
}

export interface MultiselectFieldConfig extends FieldConfigCommon {
  options?: { label: string; value: string }[]
  /** 'dynamic' = options served by site code; 'static'/absent = defined in config. */
  optionsSource?: 'static' | 'dynamic'
  validation?: CommonRules & SelectionRules
  admin?: ScalarFieldAdmin
}

export interface RelationFieldConfig extends FieldConfigCommon {
  targetType?: string
  many?: boolean
  /** Block deleting a referenced entry ('restrict') or clear the reference (default 'setNull'). */
  onDelete?: 'restrict' | 'setNull'
  /** Restrict selectable target entries — a query filter on the TARGET type. */
  filter?: Record<string, unknown>
  validation?: CommonRules
  admin?: ScalarFieldAdmin & FieldAdminRelationDisplay
}

/**
 * A link to Tangen content (held by identity) or to an external URL. The
 * config says which destinations this particular field offers and what an
 * internal one may point at; the scheme policy reuses the url field's rules
 * rather than inventing a second one.
 */
export interface LinkFieldConfig extends FieldConfigCommon {
  /** Destinations offered. Absent = both. The editor and validation agree. */
  allowedKinds?: LinkKind[]
  /** Content types an internal link may target. Absent = any readable type. */
  allowedTargets?: string[]
  /** Offer an anchor (default true). */
  anchor?: boolean
  /** Offer query parameters (default true). */
  query?: boolean
  /** Offer a text on the link - a call to action's words - stored as `label` beside the destination (default false). */
  withLabel?: boolean
  /** Offer "Open in a new tab" on a link (default true); stored as `newTab` when on. */
  newTab?: boolean
  validation?: CommonRules & DomainRules & UrlRules & LinkRules
  admin?: ContainerFieldAdmin
}

export interface ObjectFieldConfig extends FieldConfigCommon {
  /** Which content types are selectable. Empty = all types. */
  include?: string[]
  many?: boolean
  validation?: CommonRules
  admin?: ContainerFieldAdmin
}

export interface MediaFieldConfig extends FieldConfigCommon {
  accept?: MediaCategory[]
  mimeTypes?: string[]
  extensions?: string[]
  variants?: ImageVariant[]
  skipPresets?: boolean
  imageOverrides?: ImageOverrides
  many?: boolean
  validation?: CommonRules & MediaRules
  admin?: ContainerFieldAdmin
}

export interface RepeaterFieldConfig extends FieldConfigCommon {
  fields?: SubField[]
  validation?: CommonRules & RepeaterRules
  admin?: ContainerFieldAdmin
}

export interface ComponentFieldConfig extends FieldConfigCommon {
  /** Inline defs and/or reusable-component names (resolved from the registry). */
  components?: (string | ComponentDef)[]
  validation?: CommonRules & ComponentRules
  admin?: ContainerFieldAdmin
}

export interface JsonFieldConfig extends FieldConfigCommon {
  validation?: CommonRules
  admin?: ContainerFieldAdmin
}

export interface GroupFieldConfig extends FieldConfigCommon {
  /** Sub-fields rendered inside the group accordion (no DB column of its own). */
  groupFields?: SubField[]
  /** Open the group collapsed in the editor. */
  collapsedByDefault?: boolean
  admin?: ContainerFieldAdmin
}

/**
 * Map of built-in fieldType → its config interface. The single source of truth
 * that makes {@link StrictFieldInput} discriminate config by fieldType, so
 * `defineObjectType` red-lines a config key that doesn't belong to the type.
 */
export interface ConfigForType {
  text: TextFieldConfig
  slug: SlugFieldConfig
  range: RangeFieldConfig
  email: EmailFieldConfig
  url: UrlFieldConfig
  phone: PhoneFieldConfig
  textarea: TextareaFieldConfig
  richtext: RichtextFieldConfig
  number: NumberFieldConfig
  boolean: BooleanFieldConfig
  date: DateFieldConfig
  time: TimeFieldConfig
  color: ColorFieldConfig
  tags: TagsFieldConfig
  code: CodeFieldConfig
  geopoint: GeopointFieldConfig
  currency: CurrencyFieldConfig
  rating: RatingFieldConfig
  select: SelectFieldConfig
  multiselect: MultiselectFieldConfig
  relation: RelationFieldConfig
  object: ObjectFieldConfig
  media: MediaFieldConfig
  link: LinkFieldConfig
  repeater: RepeaterFieldConfig
  component: ComponentFieldConfig
  json: JsonFieldConfig
  group: GroupFieldConfig
}

/** One strictly-typed field authoring shape for a given fieldType. */
type StrictFieldFor<K extends keyof ConfigForType> = {
  label: string
  helpText?: string
  fieldType: K
  config: ConfigForType[K]
  previousName?: string[]
  required?: boolean
  /** Soft-disable: keep the column + data but hide the field from every runtime
   *  surface (admin, REST, TangenQL, GraphQL). Reversible; push keeps the column. */
  disabled?: boolean
  hooks?: FieldHooks
  validate?: FieldValidateFn
  dynamicOptions?: DynamicOptionsFn
}

/**
 * Escape hatch for site/extension custom field types (names NOT in
 * `ConfigForType`, e.g. `'form'`, `'credit_card'`) — the shape the schema builder
 * emits for them. A custom type's config is defined by its `configSchema`, not a
 * built-in interface, so `config` is the loose `FieldConfig` (which still
 * excess-property-checks unknown keys — no index signature). Built-in fieldTypes
 * resolve to their strict `StrictFieldFor<K>` variant.
 */
type CustomFieldStrictInput = {
  label: string
  helpText?: string
  fieldType: string & {}
  config?: FieldConfig
  previousName?: string[]
  required?: boolean
  disabled?: boolean
  hooks?: FieldHooks
  validate?: FieldValidateFn
  dynamicOptions?: DynamicOptionsFn
}

/**
 * Discriminated union of all built-in field authoring shapes — `config` is
 * narrowed to the fieldType's own interface. `defineObjectType` accepts this,
 * so an object-literal field with a config key that doesn't belong to its type
 * is a compile error (and IntelliSense offers only the valid keys). Custom
 * (site/extension) field types fall through to `CustomFieldStrictInput`.
 */
export type StrictFieldInput =
  | { [K in keyof ConfigForType]: StrictFieldFor<K> }[keyof ConfigForType]
  | CustomFieldStrictInput

/**
 * Per-field validator. A bare `StrictFieldInput` union can't reject an invalid
 * built-in config on its own: `{ fieldType: 'richtext', config: { targetType } }`
 * matches BOTH `StrictFieldFor<'richtext'>` AND `CustomFieldStrictInput` (whose
 * `fieldType: string & {}` accepts any literal and whose loose `FieldConfig` config
 * aggregates every built-in key, so `targetType` slips through). Discriminated
 * excess-property checking then can't pick a single member, and the loose branch wins.
 *
 * This maps a field back to its EXACT expected shape by `fieldType`: a built-in name
 * → its strict `StrictFieldFor<K>` (so a foreign config key is a compile error); any
 * other name → the loose custom shape. Used per-key in `defineObjectType({ fields })`,
 * where the object literal is then excess-checked against the resolved shape.
 */
export type StrictFieldOf<T> =
  T extends { fieldType: infer K extends keyof ConfigForType }
    ? StrictFieldFor<K>
    : CustomFieldStrictInput

/** Validate every field in a `defineObjectType({ fields })` map by its own fieldType. */
export type ValidateFields<F> = { [K in keyof F]: StrictFieldOf<F[K]> }
