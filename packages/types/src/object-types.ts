/**
 * File Name: object-types.ts
 * Purpose: Core content-modelling types for Tangen CMS — object type definitions,
 *   field configs, validation rules, and admin UI configuration.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — standalone type definitions with no external imports.
 *   That is why `ComponentProtection` is re-declared here structurally rather
 *   than imported from @tangen/studio-schema, which owns the model: this is
 *   the shared layer every package reads, and it must not depend on an
 *   optional Studio package. The two shapes are identical on purpose, and
 *   Studio's validator reads the declaration as data, so the types can never
 *   disagree at runtime.
 */

/**
 * The canonical, framework-agnostic list of icon names shipped by @tangen/icons.
 * It's the single source of truth: `IconName` is derived from it, and a runtime
 * drift test (packages/icons/__tests__/icon-names.test.ts) fails if the package's
 * actual exports diverge from this list. Keep it alphabetized.
 */
export const ICON_NAMES = [
  'IconAlert',
  'IconAlignCenter',
  'IconAlignJustify',
  'IconAlignLeft',
  'IconAlignRight',
  'IconArrowDown',
  'IconArrowLeft',
  'IconArrowLeftRight',
  'IconArrowRight',
  'IconArrowUp',
  'IconArticle',
  'IconAttachment',
  'IconBarChart',
  'IconBrush',
  'IconBuilding',
  'IconCalendar',
  'IconCheck',
  'IconCheckbox',
  'IconCheckCircle',
  'IconChevronDown',
  'IconChevronLeft',
  'IconChevronRight',
  'IconChevronUp',
  'IconClock',
  'IconCloseCircle',
  'IconCloud',
  'IconCode',
  'IconCodeBox',
  'IconCodeSlash',
  'IconComputer',
  'IconCopy',
  'IconDatabase',
  'IconDragMove',
  'IconDropdownList',
  'IconEdit',
  'IconExpandUpDown',
  'IconExternalLink',
  'IconEye',
  'IconEyeFill',
  'IconEyeOff',
  'IconEyeOffFill',
  'IconFile',
  'IconFileList',
  'IconFileText',
  'IconFilm',
  'IconFilter',
  'IconFolder',
  'IconFolderAdd',
  'IconGitBranch',
  'IconGithub',
  'IconGlobe',
  'IconGoogle',
  'IconGripDots',
  'IconH1',
  'IconH2',
  'IconH3',
  'IconH4',
  'IconHash',
  'IconHistory',
  'IconHome',
  'IconImage',
  'IconInbox',
  'IconInfo',
  'IconQuestion',
  'IconBookOpen',
  'IconKey',
  'IconKey2',
  'IconLanguage',
  'IconLayoutColumn',
  'IconLayoutGrid',
  'IconLayoutLeft',
  'IconLayoutRow',
  'IconLink',
  'IconListChecks',
  'IconListOrdered',
  'IconListUnordered',
  'IconLoader',
  'IconLock',
  'IconLockPassword',
  'IconLogout',
  'IconMail',
  'IconMinus',
  'IconMoon',
  'IconMoreHorizontal',
  'IconMusic',
  'IconPalette',
  'IconPencil',
  'IconPhone',
  'IconPin',
  'IconPlay',
  'IconPlayCircle',
  'IconPlus',
  'IconProhibited',
  'IconPuzzle',
  'IconRadioButton',
  'IconRefresh',
  'IconRepeat',
  'IconSave',
  'IconSearch',
  'IconSelect',
  'IconSettings',
  'IconShare',
  'IconShieldCheck',
  'IconShieldUser',
  'IconSmartphone',
  'IconSparkles',
  'IconSpinner',
  'IconStack',
  'IconStar',
  'IconStarFill',
  'IconSun',
  'IconSurvey',
  'IconTable',
  'IconTablet',
  'IconText',
  'IconToggleOff',
  'IconToggleOn',
  'IconTrash',
  'IconUndo',
  'IconUpload',
  'IconUser',
  'IconUserAdd',
  'IconUsers',
  'IconWarning',
  'IconWebhook',
  'IconX',
] as const

/**
 * Valid icon names from @tangen/icons. Config fields accept these string names
 * (resolved at render by DynamicIcon), so a typo like 'IconSpArkles' is a
 * compile error rather than a silently missing icon.
 */
export type IconName = (typeof ICON_NAMES)[number]

/**
 * What an `icon?:` config field accepts: a curated @tangen/icons name
 * (autocompleted via `IconName`), any other icon name the set resolves — the
 * full Remix library is forwarded, and the schema builder's icon picker offers
 * it — or an explicit custom image via `{ src: '/path.svg' }`. The
 * `(string & {})` keeps `IconName` autocomplete while accepting any string, so a
 * builder-chosen `RiHome2Line` type-checks (`DynamicIcon` resolves it too).
 */
export type IconRef = IconName | (string & {}) | { src: string }

/**
 * The render-layer icon value: any resolved string name (icons synthesised at
 * runtime aren't always statically an IconName) or a custom `{ src }` image.
 * Internal carriers (command catalog, nav trees) use this; DynamicIcon accepts
 * it. Authoring config uses the stricter `IconRef` so typos are caught there.
 */
export type IconValue = string | { src: string }

/**
 * A Tangen workspace record as returned by the API.
 */
export interface Workspace {
  id: string
  name: string
  slug: string
  createdAt: string
}


/**
 * A content type record as stored in and returned from the database.
 */
export interface ObjectType {
  id: string
  workspaceId: string
  name: string
  label: string
  singleton: boolean
  /** Soft delete: content APIs answer TYPE_NOT_FOUND for this type (read AND write);
   *  table + data untouched, entry statuses untouched — fully reversible. */
  disabled?: boolean
  previousNames: string[]
  adminConfig: AdminConfig
  schemaVersion: number
  createdAt: string
  updatedAt: string
  fields: Field[]
}

/** System fields valid as sort targets. */
/**
 * System fields a list may sort by - the same set the objects API accepts
 * (`SORTABLE_SYSTEM_FIELDS` is what its query compiler reads). `title` and
 * `slug` are columns on every object, so a type may default-sort by them
 * (2026-09-13: the type used to admit only the three timestamps and refused
 * `defaultSort: { field: 'title' }` although the API took it).
 */
export const SORTABLE_SYSTEM_FIELDS = ['id', 'title', 'slug', 'status', 'createdAt', 'updatedAt', 'publishedAt'] as const
export type SortableSystemField = (typeof SORTABLE_SYSTEM_FIELDS)[number]

/**
 * System fields that are always valid in listView.columns regardless of
 * declared fields: every sortable system field in its public camelCase
 * spelling, and the three timestamps in their storage spelling too, which
 * existing schemas use (2026-09-13: every default field is available wherever
 * a field is named - columns, sort, conditions).
 */
export type SystemColumnName = SortableSystemField | 'updated_at' | 'created_at' | 'published_at'

/**
 * A column entry: either a field name or a name+label override.
 * When N is the union of declared field names, only valid names are accepted.
 * System column names (title, status, timestamps) are always valid.
 */
export type ColumnEntry<N extends string = string> =
  | N
  | SystemColumnName
  | { name: N | SystemColumnName; label: string }

/**
 * Up to 5 extra columns beyond the fixed title and status columns.
 * TypeScript rejects a 6th element at compile time.
 * When N is the declared field name union, each entry is validated against it.
 */
export type ListViewColumns<N extends string = string> =
  | []
  | [ColumnEntry<N>]
  | [ColumnEntry<N>, ColumnEntry<N>]
  | [ColumnEntry<N>, ColumnEntry<N>, ColumnEntry<N>]
  | [ColumnEntry<N>, ColumnEntry<N>, ColumnEntry<N>, ColumnEntry<N>]
  | [ColumnEntry<N>, ColumnEntry<N>, ColumnEntry<N>, ColumnEntry<N>, ColumnEntry<N>]

/**
 * Admin config for an object type.
 * N is the union of field names declared in the same type — TypeScript infers it
 * automatically when you use defineObjectType, so columns/editorView arrays only
 * accept names that actually exist.
 */
export interface AdminConfig<N extends string = string> {
  listView?: {
    /** Up to 5 extra columns beyond the fixed title and status columns. */
    columns?: ListViewColumns<N>
    defaultSort?: { field: N | SortableSystemField; direction: 'asc' | 'desc' }
    /** Number of items per page in the admin list. Clamped to [5, 50]. Defaults to 10. */
    perPage?: number
  }
  editorView?: {
    main?: Array<N>
    sidebar?: Array<N>
  }
  /** Short grayed description shown in the page header next to the type name. */
  description?: string
  menu?: {
    /** Icon in the sidebar nav — an @tangen/icons name (e.g. 'IconFileText') or a custom `{ src }` image. */
    icon?: IconRef
    label?: string
    order?: number
    show?: boolean
    /**
     * Path of the parent extension page relative to /:workspaceId/:env/.
     * Prepends the extension nav label to the breadcrumb and page title.
     * E.g. 'extensions/pincodes'
     */
    parentExtension?: string
  }
  versioning?: {
    enabled?: boolean   // default true
    maxVersions?: number  // default 10
  }
  /** Marks this type as a taxonomy vocabulary with optional hierarchy and ordering support. */
  taxonomy?: {
    /** Render tree view in the browser and a tree-select parent picker in the editor. */
    hierarchical?: boolean
    /** Nest this type under another type's sidebar nav item instead of showing it top-level. */
    parentType?: string
    /** Enable drag-to-reorder in the browser when a `position` field is present. */
    orderable?: boolean
  }

  /**
   * Bulk edit modal configuration. Determines which fields appear when the admin
   * user selects multiple items and clicks "Edit fields".
   *
   * title, slug, richtext, repeater, component, and section are always excluded.
   * Group sub-fields are addressed with dotted paths, e.g. 'seo.metaTitle'.
   */
  bulkEdit?: {
    fields?: (N | string)[]
  }

  /**
   * CSV export configuration. Determines which fields appear in the exported CSV.
   * Each field type expands to one or more columns (media → _id + _url,
   * relation → _id + _title + _slug, richtext → plain text, etc.).
   */
  export?: {
    fields?: (N | string)[]
  }

  /**
   * What this type IS to a visual editor (Tangen Studio).
   *
   * A type with a component field is a Studio PAGE by default, which is the
   * right guess for almost everything and the wrong one for an INSTANCE type:
   * one shared authored tree referenced from many pages. The two are edited on
   * the same canvas but listed in different places, so the difference has to be
   * declared rather than inferred - an instance holding a `blocks` field looks
   * exactly like a page from the outside.
   *
   * Stored verbatim in `adminConfig`, so `tangen pull` and the Schema Builder
   * round-trip it with the rest of the admin config.
   */
  studio?: StudioTypeConfig
}

/** What a visual editor treats a content type as. */
export type StudioTypeRole = 'page' | 'instance'

/** The `admin.studio` block of a content type. */
export interface StudioTypeConfig {
  /**
   * `'page'` (the default) is a document Studio opens on the canvas and lists
   * under Pages. `'instance'` is a shared authored tree: listed in the
   * Instances panel, referenced from pages by a `kit.instance` block, and
   * never offered as a page to create.
   */
  role?: StudioTypeRole
}

/**
 * All supported field input types for Tangen content type definitions.
 */
export type FieldType =
  | 'text'
  | 'slug'
  | 'range'
  | 'email'
  | 'url'
  | 'phone'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'time'
  | 'color'
  | 'tags'
  | 'code'
  | 'geopoint'
  | 'currency'
  | 'rating'
  | 'select'
  | 'multiselect'
  | 'relation'
  | 'object'
  | 'media'
  | 'repeater'
  | 'component'
  | 'json'
  | 'group'
  | 'link'

/**
 * The field-type slot as authored and stored — the built-in {@link FieldType}s
 * plus extension-contributed custom type names (e.g. `'credit_card'`). The
 * `(string & {})` keeps autocomplete for the built-ins while accepting any custom
 * name. Custom types inherit a built-in primitive (CustomFieldTypeDef.inherits)
 * for storage + baseline validation; internal `switch`es keep a default branch.
 */
export type FieldTypeRef = FieldType | (string & {})

/**
 * A field record as stored in and returned from the database for a given content type.
 */
export interface Field {
  id: string
  workspaceId: string
  typeId: string
  name: string
  label: string
  fieldType: FieldTypeRef
  config: FieldConfig
  previousNames: string[]
  position: number
  required: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Image processing preset defining dimensions, cropping, format, and quality for a variant.
 */
export interface ImageVariant {
  name: string
  width?: number
  height?: number
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  position?: 'center' | 'top' | 'right top' | 'right' | 'right bottom' |
             'bottom' | 'left bottom' | 'left' | 'left top' | 'entropy' | 'attention'
  /** 'original' resizes without format conversion — the source format is kept. */
  format?: 'webp' | 'avif' | 'jpeg' | 'png' | 'original'
  quality?: number
}

/**
 * Schema-level image processing override for a media field — applied to every
 * variant (workspace presets and field variants alike) generated for uploads
 * through that field. Lets a field raise/lower quality or change the target
 * format (e.g. jpeg sources → avif), or opt out of conversion entirely with
 * format: 'original'.
 */
export interface ImageOverrides {
  quality?: number
  format?: 'webp' | 'avif' | 'jpeg' | 'png' | 'original'
}

/**
 * Custom override messages for each individual validation rule on a field.
 */
export interface FieldValidationMessages {
  required?: string
  unique?: string
  minLength?: string
  maxLength?: string
  pattern?: string
  allowedDomains?: string
  blockedDomains?: string
  httpsOnly?: string
  allowedSchemes?: string
  e164?: string
  min?: string
  max?: string
  integer?: string
  positiveOnly?: string
  step?: string
  requiredAcknowledgement?: string
  minDate?: string
  maxDate?: string
  pastOnly?: string
  futureOnly?: string
  minSelections?: string
  maxSelections?: string
  maxFileSize?: string
  maxFileCount?: string
  maxWidth?: string
  maxHeight?: string
  aspectRatio?: string
  minRows?: string
  maxRows?: string
  allowedComponents?: string
  minComponents?: string
  maxComponents?: string
}

/**
 * Validation rules enforced by the Tangen API on every write for a field.
 */
// ── Validation rule pieces (composed per field type in field-configs.ts) ─────

/** Rules every field type supports. */
export interface CommonRules {
  /** Field must have a non-empty value. */
  required?: boolean
  /** Custom error messages that override the defaults for each rule. */
  messages?: FieldValidationMessages
  /** Non-blocking guidance (amber, save proceeds) — see FieldWarningRules. */
  warnings?: import('./field-applicability').FieldWarningRules
}

/** Uniqueness — identity-like scalars only (see UNIQUE_TYPES). */
export interface UniqueRule {
  /** Value must be unique within the same workspace + env + type. */
  unique?: boolean
}

/** Text-length/shape rules — text / email / url / phone / textarea. */
export interface TextRules {
  minLength?: number
  maxLength?: number
  /** Regex that the value must match (text fields). */
  pattern?: string
}

/** Domain allow/deny lists — email + url. */
export interface DomainRules {
  /** Only these email/URL domains are accepted. */
  allowedDomains?: string[]
  /** These email domains are rejected. */
  blockedDomains?: string[]
}

/** URL-specific rules. */
export interface UrlRules {
  /** URL must start with https://. */
  httpsOnly?: boolean
}

/** Link-specific rules - the scheme policy for the EXTERNAL branch. */
export interface LinkRules {
  /**
   * Which URL schemes an external link may use. Defaults to
   * DEFAULT_LINK_SCHEMES (https, http, mailto, tel). `httpsOnly` above
   * narrows further, so the two agree rather than competing.
   */
  allowedSchemes?: string[]
}

/** Phone-specific rules. */
export interface PhoneRules {
  /** Enforce E.164 format (+countrydigits). */
  e164?: boolean
}

/** Numeric rules — number / currency / rating. */
export interface NumberRules {
  min?: number
  max?: number
  /** Value must be a whole number. */
  integer?: boolean
  /** Value must be greater than zero. */
  positiveOnly?: boolean
  /** Value must be a multiple of this step. */
  step?: number
}

/** Boolean-specific rules. */
export interface BooleanRules {
  /** Field must be true (e.g. Terms acceptance). */
  requiredAcknowledgement?: boolean
}

/** Date rules. */
export interface DateRules {
  /** ISO date YYYY-MM-DD lower bound. */
  minDate?: string
  /** ISO date YYYY-MM-DD upper bound. */
  maxDate?: string
  pastOnly?: boolean
  futureOnly?: boolean
}

/** Multiselect / tags selection-count rules. */
export interface SelectionRules {
  minSelections?: number
  maxSelections?: number
}

/** Media upload constraints — enforced at upload time. */
export interface MediaRules {
  /** Max bytes per file; enforced at upload time. */
  maxFileSize?: number
  /** Max number of files (many:true fields); enforced at upload time. */
  maxFileCount?: number
  /** Image max width in px; enforced at upload time. */
  maxWidth?: number
  /** Image max height in px; enforced at upload time. */
  maxHeight?: number
  /** e.g. "16:9"; enforced at upload time. */
  aspectRatio?: string
}

/** Repeater row-count rules. */
export interface RepeaterRules {
  minRows?: number
  maxRows?: number
}

/** Component-block rules. */
export interface ComponentRules {
  /** Restrict to specific component names. */
  allowedComponents?: string[]
  minComponents?: number
  maxComponents?: number
}

/**
 * The full (stored/erased) validation shape — the union of every rule piece. Authoring
 * uses the per-type compositions instead (each `field.*` builder accepts only the rules
 * that apply to its type); this stays permissive for the DB/codegen path.
 */
export interface FieldValidation extends
  CommonRules, UniqueRule, TextRules, DomainRules, UrlRules, LinkRules, PhoneRules, NumberRules,
  BooleanRules, DateRules, SelectionRules, MediaRules, RepeaterRules, ComponentRules {}

/**
 * Configuration options for a field — covers all field types and their type-specific settings.
 */
export interface FieldConfig {
  // ── Field behaviour ──────────────────────────────────────────────────────
  default?: unknown

  // ── Select / Multiselect ─────────────────────────────────────────────────
  options?: { label: string; value: string }[]
  /**
   * 'dynamic' marks options as resolved at runtime by the field's
   * dynamicOptions function (code-side; stripped on push). The admin fetches
   * options from /api/v1/admin/field-options/:type/:field when set.
   */
  optionsSource?: 'static' | 'dynamic'

  // ── Code ─────────────────────────────────────────────────────────────────
  /** Language hint for code fields (display/badge only, e.g. 'json', 'html') */
  language?: string

  // ── Currency / Rating ────────────────────────────────────────────────────
  /** ISO currency code shown next to currency inputs (display only, e.g. 'INR') */
  currencyCode?: string
  /** Rating scale upper bound (default 5) */
  max?: number

  // ── Relation ─────────────────────────────────────────────────────────────
  targetType?: string
  many?: boolean
  /** What happens when a referenced entry is deleted: block it, or clear the
   *  reference here (default 'setNull'). */
  onDelete?: 'restrict' | 'setNull'
  /** Restrict which target entries are selectable (and writable) — a query filter
   *  evaluated against the TARGET type, e.g. { status: 'published' }. */
  filter?: Record<string, unknown>

  // ── Object (polymorphic reference) ───────────────────────────────────────
  /** For object fields: which content types are selectable. Empty = all types. */
  include?: string[]

  // ── Slug ─────────────────────────────────────────────────────────────────
  /** Sibling field (or 'title') the editor's "Generate" button derives the slug from. */
  source?: string

  // ── Date ─────────────────────────────────────────────────────────────────
  includeTime?: boolean

  // ── Phone ────────────────────────────────────────────────────────────────
  /** Hint for formatting; not strictly enforced. */
  countryCode?: string | string[]

  // ── Localization ─────────────────────────────────────────────────────────
  /** Translatable per locale — value lives in the <type>_i18n side table for
   *  non-default locales (default locale stays in the main column). */
  localized?: boolean

  // ── Media ────────────────────────────────────────────────────────────────
  /**
   * Ergonomic allow-list by category — 'image' | 'video' | 'audio' |
   * 'document' | 'other'. Combines with mimeTypes as a UNION (a file passes
   * when it matches either). Use mimeTypes for granular control (e.g. only
   * PDFs), accept when the broad kind is what matters.
   */
  accept?: import('./media').MediaCategory[]
  mimeTypes?: string[]
  extensions?: string[]
  variants?: ImageVariant[]
  skipPresets?: boolean
  /** Quality/format override applied to every generated variant for this field. */
  imageOverrides?: ImageOverrides

  // ── Repeater ─────────────────────────────────────────────────────────────
  fields?: SubField[]

  // ── Component ────────────────────────────────────────────────────────────
  /** Inline component defs and/or reusable-component **names** (resolved from the
   * workspace registry at load — see @tangen/schema resolveSchemaComponentRefs). */
  components?: (string | ComponentDef)[]

  // ── Group (admin-only, no DB column) ─────────────────────────────────────
  /** Sub-field definitions for a group field. Stored for admin UI purposes only;
   *  each sub-field becomes a flat column in the DB just like a top-level field. */
  groupFields?: FieldDefinition[]
  /** When true, the group accordion starts collapsed in the editor. */
  collapsedByDefault?: boolean

  // ── RichText ─────────────────────────────────────────────────────────────
  /** Toolbar capability level. 'basic' = bold/italic/headings/lists/link.
   *  'advanced' (default) = adds strike, code, blockquote, HR, underline, undo/redo, HTML source view. */
  toolbar?: 'basic' | 'advanced'
  /** Enable image embedding inside the richtext editor. */
  media?: boolean

  // ── Link ─────────────────────────────────────────────────────────────────
  /** Which destinations a link field offers: internal, external, or both (default). */
  allowedKinds?: import('./link').LinkKind[]
  /** Restrict an internal link's target to these content types. Absent = any. */
  allowedTargets?: string[]
  /** Offer an anchor on a link (default true). */
  anchor?: boolean
  /** Offer query parameters on a link (default true). */
  query?: boolean
  /** Offer a text on the link - the words of a call to action - stored as `label` beside the destination (default false). */
  withLabel?: boolean
  /** Offer "Open in a new tab" on a link (default true); stored as `newTab` when on. */
  newTab?: boolean

  // ── Misc ─────────────────────────────────────────────────────────────────
  index?: boolean

  // ── Nested config objects ─────────────────────────────────────────────────
  /** Validation rules — enforced by the API on every write. */
  validation?: FieldValidation
  /** Admin-panel-specific settings — only affect the CMS UI. */
  admin?: FieldAdminConfig
  /** Content AI settings for this field. */
  ai?: FieldAIConfig
  /**
   * MCP exposure — `false` excludes this field from MCP tool reads AND
   * writes (writes naming it are rejected). Default true when the type is
   * exposed.
   */
  mcp?: boolean
  /**
   * Knowledge (RAG) opt-in — fields are OFF until explicitly allowed
   * (`knowledge: true`). Only opted-in fields are chunked and embedded.
   */
  knowledge?: boolean
}

/**
 * Per-field Content AI configuration. AI fill is enabled by default for
 * content fields; set enabled: false to exclude a field. The hint tells the
 * AI (and coding agents) what this field is for and how to write it.
 */
export interface FieldAIConfig {
  /** Allow AI to fill/suggest this field (default true). */
  enabled?: boolean
  /** What this field contains and how to write it, e.g. "One-sentence teaser, max 160 chars". */
  hint?: string
}

/**
 * A single conditional rule that gates field visibility based on another field's value.
 */
export interface ConditionalRule {
  /** The field name whose value is checked. */
  field: string
  /** Comparison operator. */
  operator: 'eq' | 'neq' | 'empty' | 'notEmpty' | 'gt' | 'lt' | 'contains'
  /** The value to compare against (unused for empty/notEmpty). */
  value?: unknown
}

/**
 * Multiple conditions combined with all (AND) or any (OR). Used anywhere a single
 * {@link ConditionalRule} is accepted — the field stays visible when the group passes.
 */
export interface ConditionalRuleGroup {
  match: 'all' | 'any'
  rules: ConditionalRule[]
}

/** A visibility condition — a single rule (back-compat) or a multi-rule group. */
export type ConditionalVisibility = ConditionalRule | ConditionalRuleGroup

/**
 * Admin panel display and behaviour settings for a field; these do not affect API validation.
 */
// ── Admin-config pieces (composed per field type in field-configs.ts) ────────

/** Admin settings every field type supports. */
export interface FieldAdminBase {
  /** Selection rendering: select → dropdown (default) | radio | segmented;
   *  multiselect → pills (default) | checkboxList. Presentation-only. */
  displayAs?: 'dropdown' | 'radio' | 'segmented' | 'checkboxList' | 'slider'
  /** Hint text rendered below the field input in the editor. */
  helpText?: string
  /** Column width of this field in the editor grid. Defaults to 'full'. */
  width?: 'full' | 'half' | 'third'
  /** Placeholder text shown inside the input when empty. */
  placeholder?: string
  /** Renders the field as read-only in the admin editor. */
  readonly?: boolean
  /** Hides the field entirely in the admin editor. */
  hidden?: boolean
  /** Show this field only when the given condition (single rule or multi-rule group) is true. */
  conditionalVisibility?: ConditionalVisibility
  /**
   * Role-based field access — lists of role names (built-in) or custom role
   * slugs. Absent = everyone. Members whose effective role is missing from
   * `read` never receive the field; missing from `write` see it read-only
   * and their writes to it are stripped. Owner/admin always pass.
   */
  access?: { read?: string[]; write?: string[] }
}

/** Listing/search presence — non-container types (see NON_LISTABLE_TYPES). */
export interface FieldAdminListable {
  /** Show this field as an extra column in the listing table. */
  showInList?: boolean
  /** Include this field in full-text search (profile fields: alongside name + email). */
  searchable?: boolean
}

/** List filtering — scalar/reference types only (see FILTERABLE_TYPES). */
export interface FieldAdminFilterable {
  /** Show this field as a filterable condition in the admin listing view.
   *  Only meaningful on scalar/reference types: text, number, boolean, date,
   *  select, multiselect, relation. Ignored on component, richtext, media, repeater. */
  showInFilter?: boolean
}

/** Relation list display. */
export interface FieldAdminRelationDisplay {
  /** For relation fields: which field on the related object to display in the list view column.
   *  Defaults to 'title'. Example: set to 'email' if the related type uses email as its display name. */
  listDisplayField?: string
}

/**
 * The full (stored/erased) admin-config shape — the union of every piece. Authoring uses
 * the per-type compositions instead; this stays permissive for the DB/codegen path.
 */
export interface FieldAdminConfig extends
  FieldAdminBase, FieldAdminListable, FieldAdminFilterable, FieldAdminRelationDisplay {}

/**
 * A field definition nested inside a Repeater or Component field.
 */
export interface SubField {
  name: string
  label: string
  fieldType: FieldTypeRef
  config?: FieldConfig
  required?: boolean
  /** Rename history — the schema builder emits this so a renamed sub-field keeps
   *  its data across a push (mirrors top-level FieldDefinition.previousName). */
  previousName?: string[]
  admin?: Pick<FieldAdminConfig, 'helpText' | 'width'>
  /**
   * Which inspector tab this prop belongs to in visual editors (Studio).
   * Most props classify themselves - a select whose options are a design-
   * token slot list is styling - so this is only needed for closed enums
   * that are VISUAL but not token-bound (`layout`, `align`, `columns`),
   * which are otherwise indistinguishable from content.
   */
  group?: 'content' | 'style' | 'advanced'

}

/**
 * A named component block available inside a Component field, consisting of sub-fields.
 */
export interface ComponentDef {
  name: string
  label: string
  fields: SubField[]
  /**
   * This block carries no props by design - its whole meaning is its
   * presence (the Builder Kit's divider). Lets `fields: []` pass the
   * empty-container validation that otherwise refuses a component with
   * nothing in it; without it an empty array is still treated as a
   * container someone forgot to fill.
   */
  leaf?: boolean
  /** Block-level visibility: offer/render this block only when the ENTRY's fields
   *  match (evaluated in the editor; schema-local/inline components only). */
  conditionalVisibility?: import('./object-types').ConditionalVisibility
  /** Optional group name for filtering in the block picker (e.g. "Banners", "Cards", "Misc"). */
  group?: string
  /** Optional short description shown in the block picker modal. */
  description?: string
  /**
   * Optional preview image for visual pickers (Studio's palette) — a URL or
   * site-served path (e.g. '/studio/hero.png'). Pickers fall back to an
   * auto letter tile when absent.
   */
  thumbnail?: string
  /**
   * Optional icon for LIST surfaces - Studio's block navigator, where a
   * thumbnail is far too large. A curated @tangen/icons name. Absent is
   * fine: Studio infers one from the component's own fields (a component
   * holding blocks reads as a container, one bound to a relation as data),
   * so a tree is meaningful with nothing declared here.
   */
  icon?: IconRef
  /**
   * How much of this Block's styling its author opens up to Studio's Style
   * panel. Absent means Open - a Block opts IN to protection. Read by Studio
   * only; validated when the config loads, so a malformed declaration is a
   * boot/push error naming the component and the key rather than a Block
   * that is silently unprotected. See docs/studio.md, "Declaring protection".
   */
  protection?: ComponentProtection
}

/** One Style Part a protected Block exposes to outside styling. */
export interface ComponentStylePart {
  /** Style property ids allowed on this part. Omitted means every property. */
  properties?: string[]
}

/**
 * A Block's protection declaration. `open`: ordinary content, everything is
 * stylable. `guided`: only the parts listed may be styled from outside, and
 * a property that can break the Block (display, position, overflow, height)
 * is never offered. `locked`: the same rules, for a Block whose author exposes
 * little or nothing. Structurally identical to BlockProtection in
 * @tangen/studio-schema, which is the model that enforces it.
 */
export interface ComponentProtection {
  level: 'open' | 'guided' | 'locked'
  /** Named Style Parts, `root` included. Absent on a guided or locked Block means nothing is exposed. */
  parts?: Record<string, ComponentStylePart>
}

/**
 * Lifecycle status values for a Tangen content object. 'scheduled' is the
 * schedule route's state between "publish requested for time T" and the
 * scheduler's auto-publish (the union previously drifted from what the
 * writes actually store).
 */
export type ObjectStatus = 'draft' | 'staged' | 'published' | 'scheduled' | 'archived'

/**
 * A content object record as returned by the Tangen API, including draft and published values.
 */
export interface TangenObject {
  id: string
  workspaceId: string
  typeId: string
  type: string
  title: string | null
  slug: string | null
  status: ObjectStatus
  values: Record<string, unknown>
  publishedValues: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

/**
 * The top-level schema container holding all content type definitions for a workspace.
 */
export interface SchemaDefinition {
  types: ObjectTypeDefinition[]
}

/**
 * Developer-authored content type definition used in workspace config and schema push.
 */
export interface ObjectTypeDefinition {
  id?: string  // populated by schema cache (from DB); absent when defined locally in TS files
  name: string
  label: string
  /**
   * Explicit plural word for this type. Optional — inflection derives one from
   * `name` when omitted (`product` → `products`). Set it when the inflection is
   * wrong (`person` → `people`, `person` → not `persons`). Drives the GraphQL
   * list query field (and any plural label). The singular GraphQL type name is
   * still derived from `name`; this only controls the plural.
   */
  plural?: string
  singleton?: boolean
  /** Soft delete: content APIs answer TYPE_NOT_FOUND (read AND write); table + data
   *  untouched, entry statuses untouched — fully reversible. */
  disabled?: boolean
  /**
   * Localization opt-in at the TYPE level. When true (or when any field is
   * `localized: true`), push generates the `<type>_i18n` side table — the title
   * (`__title`) is always translatable, plus a column per localized field.
   * Requires workspace localization to be enabled. Default false.
   */
  localized?: boolean
  previousName?: string[]
  admin?: AdminConfig
  fields: FieldDefinition[]
  /**
   * MCP exposure — `false` hides this type from ALL MCP tools even when the
   * API key could read it. Default true (still gated by workspace McpConfig
   * being enabled + the key's grants).
   */
  mcp?: boolean
  /**
   * Knowledge (RAG) opt-in — types are NOT indexed until this is enabled
   * (and the workspace KnowledgeConfig is on). Fields additionally opt in
   * one by one via FieldConfig.knowledge.
   */
  knowledge?: import('./knowledge').TypeKnowledgeConfig
  /**
   * PROVENANCE - the id of the extension that declares this type, or absent
   * when the site's own code declares it. Never hand-authored: `tangen push`
   * stamps it from the extension the definition came from, stores it on the
   * registry row, and the API reads it back so the admin can say "provided by
   * extension studio" instead of presenting it as site code somebody forgot
   * to write.
   *
   * It is also what makes losing an extension safe. A registry row with a
   * `providedBy` is never turned into a DROP_TYPE by a diff: when the
   * extension stops declaring the type (it was removed, disabled, or simply
   * changed its mind), the type is an ORPHAN - the table and its rows stay,
   * push reports it, doctor reports it. A site takes ownership by declaring
   * the same name in its own schema, which clears `providedBy`, and only then
   * can drop it the ordinary way (with `--confirm`, like any destructive op).
   */
  providedBy?: string
}

/**
 * Context passed to field-level behavior functions (hooks, validate, options).
 * `tangen` is the LocalClient from @tangen/api — typed loosely here to avoid a
 * package cycle; it is the same client custom routes receive as ctx.tangen.
 */
export interface FieldBehaviorContext {
  /** The full row the field belongs to (values as of this operation) */
  row: Record<string, unknown>
  workspaceId: string
  /** LocalClient for querying other types/tables from a hook or resolver */
  tangen?: import('./custom-routes').TangenLocalClient
}

/**
 * Per-field lifecycle hooks. Behavior lives in code only (never in the DB):
 * the API server overlays these onto DB-loaded schemas by type+field name;
 * `tangen push` strips them via its JSON subprocess boundary.
 */
export interface FieldHooks {
  /** Runs before the value is written (create/update/publish). Return the value to store. */
  beforeChange?: (value: unknown, ctx: FieldBehaviorContext) => unknown | Promise<unknown>
  /** Runs when the object is read (get/query). Return the value to expose. */
  afterRead?: (value: unknown, ctx: FieldBehaviorContext) => unknown
}

/** Custom validation escape hatch — return an error message or undefined. */
export type FieldValidateFn = (value: unknown, ctx: FieldBehaviorContext) => string | undefined

/** Resolves select/multiselect options at runtime (another type, a table, an API). */
export type DynamicOptionsFn = (
  ctx: FieldBehaviorContext,
) => Promise<Array<{ label: string; value: string }>> | Array<{ label: string; value: string }>

/** A stored field definition — name is set from the object key in defineObjectType. */
/**
 * The runtime-visible fields of a type: everything except soft-disabled ones.
 * Use this at every runtime surface (admin, REST, TangenQL, GraphQL) so a
 * `disabled` field disappears everywhere at once. Push/codegen keep reading the
 * raw `fields` list so the column and its data are preserved.
 */
export function activeFields<T extends { disabled?: boolean }>(fields: T[]): T[] {
  return fields.filter((f) => !f.disabled)
}

export interface FieldDefinition {
  name: string
  label: string
  helpText?: string
  fieldType: FieldTypeRef
  config: FieldConfig
  previousName: string[]
  required: boolean
  /** Soft-disable: the field keeps its column and data but is hidden from every
   *  runtime surface (admin, REST, TangenQL, GraphQL). Reads omit it, writes drop
   *  it, validation skips it (so a disabled required field can't block publish),
   *  and push never drops the column — fully reversible. */
  disabled?: boolean
  /** Code-side only — stripped by push; overlaid at runtime by the behavior registry */
  hooks?: FieldHooks
  /** Code-side only — custom validate function */
  validate?: FieldValidateFn
  /** Code-side only — dynamic options resolver (config.optionsSource === 'dynamic') */
  dynamicOptions?: DynamicOptionsFn
  /**
   * Set by defineObjectType on the flattened copy of a group sub-field: the
   * name of the group it was declared in. Group sub-fields are stored as flat
   * columns, so they also sit in `fields` beside the group marker; this is how
   * a flattened copy stays distinguishable from a field declared at the top
   * level with the same name (a column collision). Absent on top-level
   * declarations and on rows loaded back from the database.
   */
  group?: string
}

/** What field.* builders return — name comes from the object key, not the builder. */
export interface FieldInput {
  label: string
  helpText?: string
  fieldType: FieldTypeRef
  config: FieldConfig
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
 * Returns only the fields that correspond to real DB columns, stripping out
 * group marker fields (fieldType === 'group'). Sub-fields of groups are already
 * flattened into the array by defineObjectType, so this is a simple filter.
 */
export function flattenFields(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.filter(f => f.fieldType !== 'group')
}

/**
 * The field names every group in `fields` claims, mapped to the group(s)
 * claiming them - read from `config.groupFields`, recursing into nested
 * groups. Works on any shape: the raw declaration (sub-fields only inside the
 * group config), the flattened list defineObjectType produces, and the rows
 * loaded back from the database. Consumers that meet a flattened list and
 * want only the DECLARED top-level fields (the schema builder, `tangen pull`)
 * drop the names found here; the group keeps its editor section.
 */
export function groupMemberNames(
  fields: ReadonlyArray<{ name?: unknown; fieldType?: unknown; config?: unknown }> | undefined,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (list: ReadonlyArray<{ name?: unknown; fieldType?: unknown; config?: unknown }> | undefined) => {
    for (const f of list ?? []) {
      if (f?.fieldType !== 'group' || typeof f.name !== 'string') continue
      const subs = ((f.config as { groupFields?: unknown[] } | undefined)?.groupFields ?? []) as Array<{ name?: unknown; fieldType?: unknown; config?: unknown }>
      for (const sf of subs) {
        if (typeof sf?.name !== 'string') continue
        const owners = out.get(sf.name) ?? []
        owners.push(f.name)
        out.set(sf.name, owners)
      }
      walk(subs)
    }
  }
  walk(fields)
  return out
}
