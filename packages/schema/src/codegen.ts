/**
 * File Name: codegen.ts
 * Purpose: Emit `defineObjectType(...)` schema source and the schema barrel from a
 *   plain object-type model. Shared by `tangen pull` (DB → code) and the admin
 *   Content Object Builder (visual model → code), so both produce identical,
 *   idiomatic schema files with no drift.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure string generation, no I/O — trivially testable.
 */
import type { FieldConfig, FieldValidation, FieldAdminConfig, FieldAIConfig, ComponentProtection } from '@tangen/types'
import { BUILT_IN_FIELD_TYPES, groupMemberNames } from '@tangen/types'

/** Minimal field shape needed to serialize a schema field. */
export interface CodegenField {
  /** Accepted for compatibility with older callers — never emitted (FieldInput has no id). */
  id?: string
  name: string
  /**
   * Explicit rename intent, oldest first: this field used to be called these
   * names. Emitted verbatim, because it is the only thing that tells the next
   * push to RENAME the column rather than drop it and add a new one. Never
   * inferred from similarity - the Schema Builder records it when a developer
   * edits a field's technical name, and a hand-written schema sets it directly.
   */
  previousName?: string[]
  label: string
  fieldType: string
  config?: Record<string, unknown>
  required: boolean
  /** Soft-disabled: hidden from every runtime surface; column + data preserved. */
  disabled?: boolean
}

// ── Config sanitizer ─────────────────────────────────────────────────────────
// Emitted schema files are type-checked by `tangen push` against FieldConfig, so any
// stray key (AI drafts have invented e.g. "features", "defaultToNow") breaks the push.
// The key sets are exhaustive by construction: `Record<keyof X, true>` errors here the
// moment the interface changes, so the sanitizer can never silently drop a real key.
const CONFIG_KEYS: Record<keyof FieldConfig, true> = {
  default: true, options: true, optionsSource: true, language: true, currencyCode: true,
  max: true, targetType: true, many: true, onDelete: true, filter: true, include: true, includeTime: true, source: true,
  countryCode: true, localized: true, accept: true, mimeTypes: true, extensions: true,
  variants: true, skipPresets: true, imageOverrides: true, fields: true, components: true,
  groupFields: true, collapsedByDefault: true, toolbar: true, media: true, index: true,
  validation: true, admin: true, ai: true, mcp: true, knowledge: true,
  allowedKinds: true, allowedTargets: true, anchor: true, query: true, withLabel: true, newTab: true,
}
const VALIDATION_KEYS: Record<keyof FieldValidation, true> = {
  required: true, messages: true, warnings: true, unique: true,
  minLength: true, maxLength: true, pattern: true,
  allowedDomains: true, blockedDomains: true, httpsOnly: true, allowedSchemes: true, e164: true,
  min: true, max: true, integer: true, positiveOnly: true, step: true,
  requiredAcknowledgement: true,
  minDate: true, maxDate: true, pastOnly: true, futureOnly: true,
  minSelections: true, maxSelections: true,
  maxFileSize: true, maxFileCount: true, maxWidth: true, maxHeight: true, aspectRatio: true,
  minRows: true, maxRows: true,
  allowedComponents: true, minComponents: true, maxComponents: true,
}
const ADMIN_KEYS: Record<keyof FieldAdminConfig, true> = {
  helpText: true, width: true, placeholder: true, readonly: true, hidden: true, displayAs: true,
  conditionalVisibility: true, access: true,
  showInList: true, searchable: true, showInFilter: true, listDisplayField: true,
}
const AI_KEYS: Record<keyof FieldAIConfig, true> = { enabled: true, hint: true }

function pick(obj: unknown, keys: Record<string, true>): Record<string, unknown> {
  const src = (obj ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) if (keys[k]) out[k] = src[k]
  return out
}

/**
 * Drop config keys FieldConfig doesn't know (incl. inside validation/admin/ai).
 * Custom (extension/site) field types keep their config untouched — their keys are
 * declared by the type's own configSchema, not FieldConfig.
 */
export function sanitizeFieldConfig(config: Record<string, unknown> | undefined, fieldType: string): Record<string, unknown> {
  const cfg = config ?? {}
  if (!BUILT_IN_FIELD_TYPES.has(fieldType)) return cfg
  const out = pick(cfg, CONFIG_KEYS)
  if (out.validation != null) out.validation = pick(out.validation, VALIDATION_KEYS)
  if (out.admin != null) out.admin = pick(out.admin, ADMIN_KEYS)
  if (out.ai != null) out.ai = pick(out.ai, AI_KEYS)
  return out
}

/** Serialize a field's config for emission — sanitized, '{}' when empty. */
function configCode(f: CodegenField): string {
  const cfg = sanitizeFieldConfig(f.config, f.fieldType)
  return Object.keys(cfg).length > 0 ? JSON.stringify(cfg) : '{}'
}

/** Minimal object-type shape needed to serialize a schema file. */
export interface CodegenObjectType {
  id: string
  name: string
  label: string
  /** Explicit plural word — round-tripped so `tangen pull` preserves it. */
  plural?: string | null
  fields: CodegenField[]
  /** Explicit type rename intent, oldest first. Same rule as the field one. */
  previousName?: string[]
  /** Optional short description shown in the type header. */
  description?: string
  /** Soft delete — content APIs 404 while set (see ObjectTypeDefinition.disabled). */
  disabled?: boolean
  /** Single-entry type — one editor, no list view. */
  singleton?: boolean
  /** Optional admin config (editorView stages, menu.icon, etc.). */
  admin?: Record<string, unknown>
  /** Accepted for compatibility with pull's RuntimeObjectType. */
  adminConfig?: Record<string, unknown>
}

/** Built-in field types that have a `field.<type>()` helper (everything but
 *  `group`; custom/extension types have no helper either). */
const HELPER_TYPES = new Set([
  'text', 'slug', 'range', 'email', 'url', 'phone', 'textarea', 'richtext',
  'number', 'boolean', 'date', 'media', 'json', 'time', 'color', 'tags', 'code',
  'geopoint', 'currency', 'rating', 'select', 'multiselect', 'relation',
  'repeater', 'component', 'object', 'link',
])

/** Serialize one field. Built-ins use the typed `field.<type>()` helper (better
 *  authoring autocomplete); `group` and custom types fall back to the object
 *  form since no helper exists. `required` folds into `config.validation`
 *  (where the helper reads it from) instead of a top-level property. */
/** A reusable-component name ref that a field imports by value. */
interface ComponentImport { ident: string; name: string }
interface FieldCodeResult { code: string; imports: ComponentImport[] }

function fieldCode(f: CodegenField): FieldCodeResult {
  const cfg = sanitizeFieldConfig(f.config, f.fieldType) as Record<string, unknown>
  if (f.required) {
    cfg.validation = { ...(cfg.validation as Record<string, unknown> | undefined), required: true }
  }

  // Reusable-component fields reference blocks by IMPORTED VALUE, not by name
  // string — autocomplete + compile-time typo checks, and consistent with
  // hand/AI-authored schemas. Inline defs (objects) stay inline. Each string ref
  // becomes a hoisted default import; a placeholder token lets us keep the single
  // JSON.stringify pass, then we unquote it back to the bare identifier.
  const imports: ComponentImport[] = []
  if (f.fieldType === 'component' && Array.isArray(cfg.components)) {
    cfg.components = (cfg.components as unknown[]).map((c) => {
      if (typeof c !== 'string') return c
      const ident = schemaDirIdentifier(c)
      imports.push({ ident, name: c })
      return `__TGN_CREF__${ident}__`
    })
  }

  // Two places, one rule (fields.ts): the platform keys are written at the top
  // level of the builder, the type's own options under config.
  const TOP_LEVEL = ['localized', 'index', 'mcp', 'knowledge', 'validation', 'admin'] as const
  const flat: Record<string, unknown> = {}
  for (const k of TOP_LEVEL) if (cfg[k] !== undefined) { flat[k] = cfg[k]; delete cfg[k] }
  const flatStr = Object.entries(flat).map(([k, v]) => `, ${k}: ${JSON.stringify(v)}`).join('')
  let cfgStr = Object.keys(cfg).length > 0 ? JSON.stringify(cfg) : '{}'
  if (imports.length) cfgStr = cfgStr.replace(/"__TGN_CREF__([A-Za-z0-9_$]+)__"/g, '$1')

  const label = JSON.stringify(f.label)
  // Soft-disable is a top-level field prop (kept out of config, like required).
  const disabledProp = f.disabled ? ', disabled: true' : ''
  // Rename intent is a TOP-LEVEL prop, beside label. Inside config the
  // sanitizer would drop it and the rename would be silently lost.
  const prevProp = f.previousName?.length ? `, previousName: ${JSON.stringify(f.previousName)}` : ''
  const code = HELPER_TYPES.has(f.fieldType)
    ? `    ${f.name}: field.${f.fieldType}({ label: ${label}${prevProp}${flatStr}, config: ${cfgStr}${disabledProp} }),`
    // group / custom types — object form, required stays top-level
    : `    ${f.name}: { label: ${label}${prevProp}, fieldType: '${f.fieldType}', config: ${cfgStr}, required: ${f.required}${disabledProp} },`
  return { code, imports }
}

/** Generate the `schema.ts` source for a single object type. */
export function generateObjectTypeSource(type: CodegenObjectType): string {
  // Only DECLARED fields are written. The input may be the flattened field
  // list (the runtime schema `tangen pull` and the export route read, or
  // defineObjectType output): a group's sub-fields sit beside the group marker
  // as rows of their own, because they are real columns. The group declares
  // them; writing the rows back as top-level fields as well is how a schema
  // grew `metaTitle` twice and broke the next push.
  const claimed = groupMemberNames(type.fields)
  const declared = type.fields.filter((f) => !(f as { group?: string }).group && !claimed.has(f.name))
  const hasFields = declared.length > 0
  // defineObjectType takes fields as a RECORD keyed by field name (Record<string,
  // FieldInput> — no id/name inside). The array form we used to emit both failed the
  // push typecheck and, worse, ran: Object.entries on an array names fields '0','1',…
  const fieldResults = declared.map(fieldCode)
  const fieldsCode = fieldResults.map((r) => r.code).join('\n')
  // Import `field` only when some field uses a helper.
  const usesHelper = declared.some((f) => HELPER_TYPES.has(f.fieldType))

  // Hoist a default import for each reusable-component value referenced by a
  // component field (deduped by identifier). Content-object schemas live at
  // app/content-objects/<type>/schema.ts, so components/ is two levels up.
  const componentImports = new Map<string, string>() // ident → folder name
  for (const r of fieldResults) for (const ci of r.imports) componentImports.set(ci.ident, ci.name)
  const componentImportLines = [...componentImports]
    .map(([ident, name]) => `import ${ident} from '../../components/${name}/schema'`)
    .join('\n')

  // Persist description + admin config (stages/icon/…) so the builder's layout
  // round-trips. Field width already rides in each field's config.admin.width.
  const admin = type.admin ?? type.adminConfig
  const extras = [
    type.previousName?.length ? `  previousName: ${JSON.stringify(type.previousName)},` : '',
    type.plural ? `  plural: ${JSON.stringify(type.plural)},` : '',
    type.singleton ? '  singleton: true,' : '',
    type.disabled ? '  disabled: true,' : '',
    type.description ? `  description: ${JSON.stringify(type.description)},` : '',
    admin && Object.keys(admin).length > 0 ? `  admin: ${JSON.stringify(admin)},` : '',
  ].filter(Boolean).join('\n')

  return `// Generated by the Tangen Schema Builder (also written by \`tangen pull\`).
// Regenerated on every builder save — schema edits belong in the builder or here,
// but hand edits to THIS file are overwritten by the next builder save.
import { defineObjectType${usesHelper ? ', field' : ''} } from '@tangen/schema'
${componentImportLines ? componentImportLines + '\n' : ''}
export default defineObjectType({
  id: '${type.id}',
  name: '${type.name}',
  label: '${type.label}',
${extras ? extras + '\n' : ''}  fields: ${hasFields ? `{\n${fieldsCode}\n  }` : '{}'},
})
`
}

/**
 * A folder name → a valid JS import identifier. Kebab-case folders (whose name is
 * NOT a legal identifier, e.g. `post-category`) become camelCase (`postCategory`)
 * while the import PATH keeps the raw folder name. Already-valid names — including
 * snake_case (`post_category`) and single words — are used verbatim so existing
 * barrels stay byte-for-byte stable.
 */
export function schemaDirIdentifier(name: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(name)) return name
  return name
    .replace(/[-\s]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase())
    .replace(/[^\w$]/g, '')
}

/** Generate the `content-objects/index.ts` barrel importing every type schema. */
export function generateSchemaBarrel(typeNames: string[]): string {
  const imports = typeNames.map((n) => `import ${schemaDirIdentifier(n)} from './${n}/schema'`).join('\n')
  const typeList = typeNames.map(schemaDirIdentifier).join(', ')
  return `import { defineSchema } from '@tangen/schema'
${imports}

export default defineSchema({
  types: [${typeList}],
})
`
}

/** A reusable component model to serialize. */
export interface CodegenComponent {
  name: string
  label: string
  fields: CodegenField[]
  group?: string
  description?: string
  /**
   * The Block's Studio protection declaration, round-tripped as-is. A pull
   * then push that dropped it would silently leave a Guided Block Open,
   * which is the one outcome the declaration exists to prevent.
   */
  protection?: ComponentProtection
}

/** Generate the `defineComponent(...)` source for a reusable component. */
export function generateComponentSource(comp: CodegenComponent): string {
  const hasFields = comp.fields.length > 0
  // ComponentDef.fields is SubField[] — name stays, but there is no `id` key.
  const fieldsCode = comp.fields
    // previousName is the ONLY record that two JSONB keys are the same field:
    // there is no components table, so nothing else remembers.
    .map((f) => {
      const prev = f.previousName?.length ? `, previousName: ${JSON.stringify(f.previousName)}` : ''
      return `    { name: '${f.name}', label: '${f.label}', fieldType: '${f.fieldType}', config: ${configCode(f)}, required: ${f.required}${prev} },`
    })
    .join('\n')
  const extras = [
    comp.group ? `  group: ${JSON.stringify(comp.group)},` : '',
    comp.description ? `  description: ${JSON.stringify(comp.description)},` : '',
    comp.protection ? `  protection: ${JSON.stringify(comp.protection)},` : '',
  ].filter(Boolean).join('\n')

  return `import { defineComponent } from '@tangen/schema'

export default defineComponent({
  name: '${comp.name}',
  label: '${comp.label}',
${extras ? extras + '\n' : ''}  fields: ${hasFields ? `[\n${fieldsCode}\n  ]` : '[]'},
})
`
}

/** Generate the `components/index.ts` registry barrel (a plain array). */
export function generateComponentsBarrel(names: string[]): string {
  const imports = names.map((n) => `import ${schemaDirIdentifier(n)} from './${n}/schema'`).join('\n')
  return `${imports}

export default [${names.map(schemaDirIdentifier).join(', ')}]
`
}

/** A workspace global for codegen (name/label + fields, like a component + icon). */
export interface CodegenGlobal {
  name: string
  label: string
  description?: string
  icon?: string
  fields: CodegenField[]
}

/**
 * Generate the whole `app/globals/index.ts` — a single `defineGlobals([...])` array
 * (globals aren't folder-per-item like content types/components). Emits every global.
 */
export function generateGlobalsFileContent(globals: CodegenGlobal[]): string {
  const body = globals.map((g) => {
    const fields = g.fields.map((f) => {
      const req = f.required ? `, required: true` : ''
      return `      { name: '${f.name}', label: '${f.label}', fieldType: '${f.fieldType}', config: ${configCode(f)}${req} },`
    }).join('\n')
    const extras = [
      g.description ? `    description: ${JSON.stringify(g.description)},` : '',
      g.icon ? `    icon: ${JSON.stringify(g.icon)},` : '',
    ].filter(Boolean).join('\n')
    return `  {
    name: '${g.name}',
    label: '${g.label}',
${extras ? extras + '\n' : ''}    fields: ${g.fields.length ? `[\n${fields}\n    ]` : '[]'},
  },`
  }).join('\n')

  return `import { defineGlobals } from '@tangen/cms'

export default defineGlobals([
${body}
])
`
}
