/**
 * File Name: types.ts
 * Purpose: `tangen types` — generates a TypeScript declaration file with one
 *          interface per content type so SDK consumers get fully typed objects
 *          (client.objects<Post>('post')) without hand-written generics.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reuses loadLocalSchema (schema barrel loaded in a
 *          subprocess). Output defaults to tangen-types.d.ts at the project root.
 */
import { resolve } from 'node:path'
import type { SchemaDefinition, FieldType, FieldTypeRef } from '@tangen/types'
import { pathPatternOf } from '@tangen/types'
import { loadLocalSchema, loadLocalGlobals, loadLocalTables, loadLocalIds, loadLocalComponents, resolveCodegenConfigs, mergeCodegenTables } from '../schema-loader'

/**
 * The delivered TS type of a link, narrowed by the field's own configuration:
 * a field that offers one branch never widens to the others, so a consumer of
 * an internal-only field needs no guard at all. The names resolve to the
 * interfaces emitted in the preamble below.
 */
function linkTs(config?: Record<string, unknown> | null): string {
  const kinds = Array.isArray(config?.allowedKinds) ? (config!.allowedKinds as string[]) : null
  const offered = (['internal', 'external', 'path'] as const).filter((k) => !kinds || kinds.includes(k))
  if (offered.length === 0 || offered.length === 3) return 'TangenLink'
  const NAME = { internal: 'TangenInternalLink', external: 'TangenExternalLink', path: 'TangenPathLink' } as const
  return offered.map((k) => NAME[k]).join(' | ')
}

/**
 * The values a select-like field offers, when codegen can know them: a static
 * `config.options` list, each entry either `{ value }` or a bare string.
 *
 * Returns null - keeping the field a plain `string` - when `optionsSource`
 * names anything other than a static list, because those values come from the
 * database at request time, and when the list is empty, because a union of
 * nothing is `never` and no value could satisfy the field.
 */
function selectValues(config?: Record<string, unknown> | null): string[] | null {
  const source = config?.optionsSource
  if (typeof source === 'string' && source !== 'static') return null
  const raw = config?.options
  if (!Array.isArray(raw)) return null
  const values = raw
    .map((o) => (typeof o === 'string' ? o : (o as { value?: unknown } | null)?.value))
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const uniq = [...new Set(values)]
  return uniq.length ? uniq : null
}

/** A TS string-literal union of the given values, each quoted safely. */
function literalUnion(values: string[]): string {
  return values.map((v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(' | ')
}

// Same reason as `subFieldTs` below: a custom type's name is a legal field
// type, and the switch already falls through to 'unknown' for one it does not
// recognise.
function fieldTypeToTs(fieldType: FieldTypeRef, config?: Record<string, unknown> | null): string {
  // A relation's cardinality decides its SHAPE, and `columnKindFor` in
  // @tangen/types is the authority: `many === true` makes the column `TEXT[]`,
  // so the stored value is a list of ids. This read is `=== true` for the same
  // reason that one is - anything else is a single relation in the database,
  // and a type that disagrees with the column is worse than a loose one
  // because the generated file is what a developer trusts instead of checking.
  if (fieldType === 'relation' && (config as { many?: boolean } | undefined)?.many === true) return 'string[]'
  // A select's own options are the type. Narrowing is deliberate: the editor
  // cannot store a value outside the list, so `string` is looser than the
  // field really is and a typo in a consumer's switch goes uncaught.
  if (fieldType === 'select' || fieldType === 'multiselect') {
    const values = selectValues(config)
    if (values) return fieldType === 'select' ? literalUnion(values) : `Array<${literalUnion(values)}>`
  }
  switch (fieldType) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'url':
    case 'phone':
    case 'select':
    case 'relation':
    case 'media':
    case 'color':
    case 'time':
    case 'code':
      return 'string'
    case 'number':
    case 'currency':
    case 'rating':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'string'
    case 'multiselect':
    case 'tags':
      return 'string[]'
    case 'geopoint':
      return '{ lat: number; lng: number }'
    case 'link':
      return linkTs(config)
    default:
      // richtext, repeater, component, json, object, group and future types
      return 'unknown'
  }
}

/**
 * The depth a nested repeater is typed to, matching MAX_SUBFIELD_DEPTH in the
 * API's field validator: a row the server will not validate is a row this file
 * should not promise either.
 */
const MAX_SUBFIELD_DEPTH = 10

/**
 * A sub-field's options live in two places depending on where the field was
 * declared. A content type's sub-fields pass through `defineObjectType`, which
 * backfills `config`; a global's are read straight off the config file and keep
 * their options at the sub-field root. Reading only one of the two typed half
 * the sub-fields in the project from their kind alone - a link in a global
 * widened to the whole union, a many relation narrowed to one id. Config wins
 * where both carry a key, because it is the resolved copy.
 */
/**
 * Whether a read is guaranteed to carry this field's value.
 *
 * `required` alone does not promise it. A field hidden by its own
 * `conditionalVisibility` rule is SKIPPED by validation - `validateFieldValues`
 * waives it, and the same check runs inside repeater rows and component blocks -
 * because a field an editor cannot see is a field they cannot fill. So
 * `required` on a conditional field means "required while its rule holds", and
 * every other row has nothing there.
 *
 * Reading only `required` therefore typed a sometimes-field as always present:
 * a work entry with no video claims a `videoFile: string`, and the frontend
 * that trusted it never wrote the null check. Optional is the honest shape, and
 * the rule the editor applies is the rule the type has to state.
 */
function alwaysPresent(
  f: { required?: boolean },
  cfg: Record<string, unknown> | null | undefined,
): boolean {
  if (f.required !== true) return false
  const admin = (cfg?.admin ?? null) as Record<string, unknown> | null
  return admin == null || admin.conditionalVisibility == null
}

/**
 * The names of fields that sit inside a GROUP carrying a visibility rule.
 *
 * A group's rule hides its children, and `validateFieldValues` skips every one
 * of them (`hiddenByGroup`) without ever looking at the child's own config. So
 * a child with `required: true` inside a gated group is in exactly the same
 * position as a conditionally required field, and must type the same way -
 * which reading only the child's own `admin` could not tell.
 *
 * Group children are flattened into `type.fields` as well as living under the
 * group's `groupFields`, so this is the only place the link between them is
 * visible to the emitter.
 */
function namesGatedByTheirGroup(
  fields: Array<{ fieldType: string; config?: Record<string, unknown> | null }>,
): Set<string> {
  const gated = new Set<string>()
  for (const f of fields) {
    if (f.fieldType !== 'group') continue
    const cfg = (f.config ?? {}) as Record<string, unknown>
    const admin = (cfg.admin ?? null) as Record<string, unknown> | null
    if (admin?.conditionalVisibility == null) continue
    for (const sub of (cfg.groupFields ?? []) as Array<{ name?: unknown }>) {
      if (typeof sub?.name === 'string') gated.add(sub.name)
    }
  }
  return gated
}

function subFieldConfig(sub: Record<string, unknown>): Record<string, unknown> {
  const own = sub.config as Record<string, unknown> | null | undefined
  return own ? { ...sub, ...own } : sub
}

/**
 * One repeater row, as the admin's repeater editor stores it: `_key` plus the
 * declared sub-fields (`RepeaterItem` in repeater-editor.tsx). `_key` is what
 * the editor reorders by and what a localized overlay is keyed on, so it is
 * part of the shape a consumer receives, not an implementation detail.
 *
 * Returns null for a repeater that declares no fields: an empty row object
 * would claim the field holds `[{ _key }]` and nothing else, which is a
 * stronger statement than `unknown` and a wrong one.
 */
function repeaterRowTs(fields: unknown, indent: string, depth: number, comps: ComponentForCodegen[]): string | null {
  if (!Array.isArray(fields) || fields.length === 0) return null
  const inner = `${indent}  `
  const lines = [`${inner}_key: string`]
  for (const raw of fields as Array<Record<string, unknown>>) {
    if (!raw || typeof raw.name !== 'string' || typeof raw.fieldType !== 'string') continue
    const cfg = subFieldConfig(raw)
    const ts = subFieldTs(raw.fieldType, cfg, inner, depth, comps)
    lines.push(alwaysPresent(raw as { required?: boolean }, cfg) ? `${inner}${raw.name}: ${ts}` : `${inner}${raw.name}?: ${ts} | null`)
  }
  return `{\n${lines.join('\n')}\n${indent}}`
}

/**
 * The block names a `component` field allows, in declaration order. The field's
 * own `config.components` holds plain names in the pushed schema and whole
 * definitions once the API has resolved them (field-validator reads it as
 * `ComponentDef[]`), so both spellings are accepted - reading one would have
 * typed the field from whichever side of the boundary it was loaded on.
 * A name with no registered component is dropped: a union member that does not
 * exist would not compile.
 */
function allowedBlockNames(config: Record<string, unknown> | null | undefined, comps: ComponentForCodegen[]): string[] {
  const raw = config?.components
  if (!Array.isArray(raw) || comps.length === 0) return []
  const known = new Set(comps.map((c) => c.name))
  const names = raw
    .map((entry) => (typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name))
    .filter((n): n is string => typeof n === 'string' && known.has(n))
  return [...new Set(names)]
}

/**
 * A field's TS type with repeaters expanded in place. Nesting inline rather
 * than emitting a named interface per row keeps the generated file free of
 * invented names (two types may each have a `results` repeater of a different
 * shape) and reads as the value a consumer destructures.
 */
// `FieldTypeRef`: a field's type may be a CUSTOM type's name. Declaring the
// narrower `FieldType` made every call site cast, and the comparisons inside
// cast a plain string literal back again - six casts to express that the
// parameter was declared too narrowly. An unrecognised type falls through to
// 'unknown', which is exactly what a custom type should generate until its
// declaration says otherwise.
function subFieldTs(
  fieldType: FieldTypeRef,
  config: Record<string, unknown> | null | undefined,
  indent: string,
  depth: number,
  comps: ComponentForCodegen[] = [],
): string {
  if (fieldType === 'repeater' && depth < MAX_SUBFIELD_DEPTH) {
    const row = repeaterRowTs(config?.fields, indent, depth + 1, comps)
    if (row) return `Array<${row}>`
  }
  if (fieldType === 'component') {
    const names = allowedBlockNames(config, comps)
    if (names.length) return `Array<${names.map((n) => `${pascalCase(n)}Block`).join(' | ')}>`
  }
  return fieldTypeToTs(fieldType, config)
}

function pascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Generates the tangen-types.d.ts source for a schema — TangenSystemFields,
 * one interface per content type, and the TangenContentTypes name→type map.
 * @param schema - Loaded schema definition.
 * @returns TypeScript declaration source code.
 */
/** A global (Options/Metafield) set, as read from the workspace config. */
export interface GlobalForCodegen {
  name: string
  label?: string
  /**
   * `config` matters here for the same reasons it does on a content field: it
   * carries a relation's `many` and a link's `allowedKinds`, and without it a
   * global's field is typed from its kind alone and silently gets both wrong.
   */
  fields: Array<{ name: string; fieldType: string; required?: boolean; config?: Record<string, unknown> | null }>
}

/**
 * A reusable component (a page-builder block), as read from the workspace
 * config. Its `fields` are shaped like a global's: options may sit at the
 * field root or under `config`, so `subFieldConfig` reads both.
 */
export interface ComponentForCodegen {
  name: string
  label?: string
  fields: Array<{ name: string; fieldType: string; required?: boolean; config?: Record<string, unknown> | null }>
}

/** A custom table, as read from the workspace config. */
export interface TableForCodegen {
  name: string
  columns: Array<{ name: string; kind: string; nullable?: boolean }>
}

/** Custom-table column kind → TS type. */
function colKindToTs(kind: string): string {
  switch (kind) {
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'json': return 'unknown'
    case 'timestamp': return 'string'
    default: return 'string' // text (+ future scalar kinds)
  }
}

const BUILT_IN_ROLE_SLUGS = ['owner', 'admin', 'editor', 'viewer']

// No built-in extension remains: Auth and Forms are declared like any other
// (tasks/plan-core-slimming.md); the ids come from the project's config.
const BUILT_IN_EXTENSION_IDS: string[] = []

/** Emit a TS string-literal union from a list of names, or 'never' if empty. */
function stringUnion(names: string[]): string {
  const uniq = [...new Set(names)].filter(Boolean)
  return uniq.length ? uniq.map((n) => `'${n}'`).join(' | ') : 'never'
}

export function generateContentTypesCode(
  schema: SchemaDefinition,
  globals: GlobalForCodegen[] = [],
  tables: TableForCodegen[] = [],
  locales: string[] = [],
  roles: string[] = [],
  extensions: string[] = [],
  components: ComponentForCodegen[] = [],
): string {
  const typeBlocks = schema.types.map((type) => {
    const gatedByGroup = namesGatedByTheirGroup(
      type.fields as unknown as Array<{ fieldType: string; config?: Record<string, unknown> | null }>,
    )
    const fieldLines = type.fields.flatMap((f) => {
      const ts = subFieldTs(f.fieldType, f.config as Record<string, unknown> | undefined, '  ', 0, components)
      if (ts === 'unknown' && f.fieldType === 'group') return []
      const present = alwaysPresent(f, f.config as Record<string, unknown> | undefined) && !gatedByGroup.has(f.name)
      return present
        ? [`  ${f.name}: ${ts}`]
        : [`  ${f.name}?: ${ts} | null`]
    })
    return [
      `/** Content type "${type.name}" (${type.label}) */`,
      `export interface ${pascalCase(type.name)} extends TangenSystemFields {`,
      ...fieldLines,
      `}`,
    ].join('\n')
  })

  const mapEntries = schema.types.map(
    (type) => `  '${type.name}': ${pascalCase(type.name)}`,
  )

  // Component blocks - one interface per registered component. The keys are
  // the admin block editor's: `_type` is the discriminant it reads everywhere,
  // `_key` is what reordering and a localized overlay are keyed on, and
  // `_disabled` marks an eye-hidden block, which publish strips - so it is
  // optional and a published read never carries it.
  const componentBlocks = components.map((c) => {
    const lines = c.fields.flatMap((f) => {
      if (!f || typeof f.name !== 'string' || typeof f.fieldType !== 'string') return []
      const cfg = subFieldConfig(f as unknown as Record<string, unknown>)
      const ts = subFieldTs(f.fieldType, cfg, '  ', 0, components)
      return [alwaysPresent(f, cfg) ? `  ${f.name}: ${ts}` : `  ${f.name}?: ${ts} | null`]
    })
    return [
      `/** Component block "${c.name}"${c.label ? ` (${c.label})` : ''} */`,
      `export interface ${pascalCase(c.name)}Block {`,
      `  _key: string`,
      `  _type: '${c.name}'`,
      `  /** Present and true while the block is hidden in the editor; published output omits it. */`,
      `  _disabled?: boolean`,
      ...lines,
      `}`,
    ].join('\n')
  })

  // Globals — one interface per global set + a name→type map, mirroring content.
  const globalBlocks = globals.map((g) => {
    const lines = g.fields.map((f) => {
      const ts = subFieldTs(f.fieldType, f.config, '  ', 0, components)
      return alwaysPresent(f, f.config) ? `  ${f.name}: ${ts}` : `  ${f.name}?: ${ts} | null`
    })
    return [
      `/** Global "${g.name}"${g.label ? ` (${g.label})` : ''} */`,
      `export interface ${pascalCase(g.name)}Global {`,
      ...lines,
      `}`,
    ].join('\n')
  })
  const globalMapEntries = globals.map((g) => `  '${g.name}': ${pascalCase(g.name)}Global`)
  const globalsRegistryLine = globals.length
    ? [`    globals: TangenGlobals`]
    : []
  const globalsSection = globals.length
    ? [
        ...globalBlocks.flatMap((b) => [b, '']),
        `/** Map of global name → data interface. */`,
        `export interface TangenGlobals {`,
        ...globalMapEntries,
        `}`,
        ``,
      ]
    : []

  // Custom tables — one interface per table (id + columns) + a name→row map.
  const tableBlocks = tables.map((t) => {
    const lines = t.columns.map((c) => {
      const ts = colKindToTs(c.kind)
      return c.nullable ? `  ${c.name}?: ${ts} | null` : `  ${c.name}: ${ts}`
    })
    // `customTablePg` in @tangen/db creates `id` itself and then adds the
    // declared columns, so a table declaring `id` is ordinary rather than
    // wrong. Emitting both produced `id` twice in one interface, which is
    // TS2300 - the generated file stopped compiling at all. The declaration
    // wins, because it is the one that can carry a different kind.
    const declaresId = t.columns.some((c) => c.name === 'id')
    return [
      `/** Custom table "${t.name}" */`,
      `export interface ${pascalCase(t.name)}Table {`,
      ...(declaresId ? [] : [`  id: string`]),
      ...lines,
      `}`,
    ].join('\n')
  })
  const tableMapEntries = tables.map((t) => `  '${t.name}': ${pascalCase(t.name)}Table`)
  const tablesRegistryLine = tables.length ? [`    tables: TangenTables`] : []

  // The declared ADDRESS of each type that declares a PATTERN, as a string
  // literal type - slice 9. The site owns parsing an address, so its
  // catch-all route and this pattern are two statements of one shape; a site
  // that pins its route against this entry stops compiling when the pattern
  // moves, instead of discovering it as a 404.
  //
  // `{ field }` and a code-side function are left out on purpose: neither has
  // a shape a route could be checked against, and emitting something for them
  // would be a route the site cannot rely on.
  const pathEntries = schema.types.flatMap((type) => {
    const declared = pathPatternOf((type as { path?: unknown }).path)
    if (!declared) return []
    // `root` is not part of the route shape - it names the ONE object that
    // skips the pattern - so it rides a comment rather than the type.
    const note = declared.root ? `   // the object with slug '${declared.root}' lives at '/'` : ''
    return [`  '${type.name}': '${declared.pattern.replaceAll("'", "\\'")}'${note}`]
  })
  const pathsSection = pathEntries.length
    ? [
        `/** Each content type's declared address PATTERN. Pin a route against it:`,
        ` *  \`const route: TangenContentPaths['post'] = '/blog/:slug'\` stops`,
        ` *  compiling when the pattern moves. Types addressed by a field or by a`,
        ` *  code-side function are absent: neither has a shape to pin to. */`,
        `export interface TangenContentPaths {`,
        ...pathEntries,
        `}`,
        ``,
      ]
    : []

  // ID unions — narrow locale codes / role slugs from string to a literal union.
  const localesRegistryLine = locales.length ? [`    locales: ${stringUnion(locales)}`] : []
  const roleSlugs = [...BUILT_IN_ROLE_SLUGS, ...roles]
  const rolesRegistryLine = roles.length ? [`    roles: ${stringUnion(roleSlugs)}`] : []
  const extensionIds = [...BUILT_IN_EXTENSION_IDS, ...extensions]
  const extensionsRegistryLine = extensions.length ? [`    extensions: ${stringUnion(extensionIds)}`] : []
  const tablesSection = tables.length
    ? [
        ...tableBlocks.flatMap((b) => [b, '']),
        `/** Map of custom table name → row interface. */`,
        `export interface TangenTables {`,
        ...tableMapEntries,
        `}`,
        ``,
      ]
    : []

  return [
    `// DO NOT EDIT - generated by \`tangen types\``,
    `// Re-run \`tangen types\` after schema changes.`,
    ``,
    `/** A link field as Delivery returns it: content held by identity, an external URL, or a path on this site. */`,
    `export interface TangenInternalLink {`,
    `  type: 'internal'`,
    `  /** The authored identity. Present even when the target cannot be resolved. */`,
    `  targetRef: { type: string; id: string }`,
    `  /** The target's current facts, or null when it is missing, deleted or not public. */`,
    `  target: { type: string; id: string; slug: string | null; title: string | null; status: string; path: string | null } | null`,
    `  /** Where this link goes: the target's address with the query and anchor appended. Absent when there is no address. */`,
    `  href?: string`,
    `  /** The link's own text (a call to action), when the field offers one. */`,
    `  label?: string`,
    `  /** Present and true when the link should open in a new tab. */`,
    `  newTab?: boolean`,
    `  locale?: string`,
    `  anchor?: string`,
    `  query?: Record<string, string>`,
    `  /** The query and anchor ready to append to the route you build: '?source=footer#team', or ''. */`,
    `  postfix: string`,
    `}`,
    ``,
    `export interface TangenExternalLink {`,
    `  type: 'external'`,
    `  /** The URL with the stored query and anchor applied. Derived from the authored URL. */`,
    `  href: string`,
    `  /** The link's own text (a call to action), when the field offers one. */`,
    `  label?: string`,
    `  /** Present and true when the link should open in a new tab. */`,
    `  newTab?: boolean`,
    `}`,
    ``,
    `export interface TangenPathLink {`,
    `  type: 'path'`,
    `  /** A route on YOUR site, with the stored query and anchor applied: '/pricing?source=footer#plans'. */`,
    `  href: string`,
    `  /** The link's own text (a call to action), when the field offers one. */`,
    `  label?: string`,
    `  /** Present and true when the link should open in a new tab. */`,
    `  newTab?: boolean`,
    `}`,
    ``,
    `export type TangenLink = TangenInternalLink | TangenExternalLink | TangenPathLink`,
    ``,
    `export interface TangenSystemFields {`,
    `  id: string`,
    `  title: string | null`,
    `  slug: string | null`,
    `  status: 'draft' | 'published' | 'archived'`,
    `  publishedAt: string | null`,
    `  scheduledAt: string | null`,
    `  scheduledBy: string | null`,
    `  createdAt: string`,
    `  updatedAt: string`,
    `  createdBy: string | null`,
    `  updatedBy: string | null`,
    `  /** The actor kind behind each attribution: 'member' | 'api_key' | 'system' | 'site_user' */`,
    `  createdByKind: string | null`,
    `  updatedByKind: string | null`,
    `  publishedByKind: string | null`,
    `  /** The composed address, on a read that asked for it: client.objects('page').includePath(). */`,
    `  _path?: string | null`,
    `}`,
    ``,
    ...componentBlocks.flatMap((b) => [b, '']),
    ...typeBlocks.flatMap((b) => [b, '']),
    `/** Map of content type name → object interface, e.g. client.objects<TangenContentTypes['post']>('post') */`,
    `export interface TangenContentTypes {`,
    ...mapEntries,
    `}`,
    ``,
    ...pathsSection,
    ...globalsSection,
    ...tablesSection,
    `// Registry augmentation - makes objects()/globals()/table()/hooks auto-typed`,
    `// WITHOUT manual generics. Declared against the anchor package @tangen/types.`,
    `declare module '@tangen/types' {`,
    `  interface TangenRegistry {`,
    `    content: TangenContentTypes`,
    ...globalsRegistryLine,
    ...tablesRegistryLine,
    ...localesRegistryLine,
    ...rolesRegistryLine,
    ...extensionsRegistryLine,
    `  }`,
    `}`,
    ``,
  ].join('\n')
}

/**
 * Runs `tangen types`: loads the local schema and writes the generated
 * declaration file.
 * @param cwd - Project root containing tangen.config.ts.
 * @param outPath - Optional output path; defaults to generated/tangen-types.d.ts under the config dir.
 */
export async function runTypesCommand(cwd: string, outPath?: string, workspace?: string): Promise<void> {
  // Codegen must read what the RUNTIME reads. `globals`, `roles` and
  // `localization` live on the workspace config and the root config is never
  // consulted for them; `customTables` merges with the root as the base. See
  // `resolveCodegenConfigs`, which mirrors the workspace loader.
  const { rootConfigPath, workspaceConfigPath, workspaceSlug, otherSlugs } =
    await resolveCodegenConfigs(cwd, workspace)

  // The schema barrel is named by the root config and shared by every
  // workspace ("Schema (content types) is always shared across all
  // workspaces - never inherited", WorkspaceDefinition.master).
  const schema = await loadLocalSchema(rootConfigPath)

  const configForWorkspaceKeys = workspaceConfigPath ?? rootConfigPath
  const globals = await loadLocalGlobals(configForWorkspaceKeys)
  const { locales, roles, extensions } = await loadLocalIds(configForWorkspaceKeys)
  // Components are declared beside globals on the workspace config; the root
  // is read too so a project that keeps them there is typed just the same.
  const components = await loadLocalComponents(configForWorkspaceKeys)
  const rootComponents = workspaceConfigPath ? await loadLocalComponents(rootConfigPath) : []
  const allComponents = [
    ...rootComponents.filter((c) => !components.some((w) => w.name === c.name)),
    ...components,
  ]
  const tables = mergeCodegenTables(
    await loadLocalTables(rootConfigPath),
    workspaceConfigPath ? await loadLocalTables(workspaceConfigPath) : [],
  )

  const target = resolve(cwd, outPath ?? 'generated/tangen-types.d.ts')
  await Bun.write(target, generateContentTypesCode(schema, globals, tables, locales, roles, extensions, allComponents))
  const extra = [
    globals.length ? `${globals.length} globals` : '',
    tables.length ? `${tables.length} tables` : '',
    allComponents.length ? `${allComponents.length} blocks` : '',
    locales.length ? `${locales.length} locales` : '',
    roles.length ? `${roles.length} roles` : '',
    extensions.length ? `${extensions.length} extensions` : '',
  ].filter(Boolean).join(', ')
  console.log(`  Generated ${target} (${schema.types.length} content types${extra ? `, ${extra}` : ''})`)

  // Which workspace this describes is part of the answer, not a detail: the
  // same project generates different globals per workspace, and a silent
  // choice is how the previous version went wrong.
  if (workspaceSlug) {
    console.log(`  Workspace: ${workspaceSlug}${workspaceConfigPath ? '' : ' (no workspace.config.ts - nothing to read)'}`)
    if (otherSlugs.length) {
      console.log(`  Other workspaces: ${otherSlugs.join(', ')} - use --workspace <slug> for one of those`)
    }
  }
}
