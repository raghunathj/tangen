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
import type { SchemaDefinition, FieldType } from '@tangen/types'
import { loadLocalSchema, loadLocalGlobals, loadLocalTables, loadLocalIds } from '../schema-loader'

/**
 * The delivered TS type of a link, narrowed by the field's own configuration:
 * an internal-only field never widens to the external branch, and vice versa.
 * The names resolve to the interfaces emitted in the preamble below.
 */
function linkTs(config?: Record<string, unknown> | null): string {
  const kinds = Array.isArray(config?.allowedKinds) ? (config!.allowedKinds as string[]) : null
  const internal = !kinds || kinds.includes('internal')
  const external = !kinds || kinds.includes('external')
  if (internal && !external) return 'TangenInternalLink'
  if (external && !internal) return 'TangenExternalLink'
  return 'TangenLink'
}

function fieldTypeToTs(fieldType: FieldType, config?: Record<string, unknown> | null): string {
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
  fields: Array<{ name: string; fieldType: string; required?: boolean }>
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
): string {
  const typeBlocks = schema.types.map((type) => {
    const fieldLines = type.fields.flatMap((f) => {
      const ts = fieldTypeToTs(f.fieldType, f.config as Record<string, unknown> | undefined)
      if (ts === 'unknown' && f.fieldType === ('group' as FieldType)) return []
      return f.required
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

  // Globals — one interface per global set + a name→type map, mirroring content.
  const globalBlocks = globals.map((g) => {
    const lines = g.fields.map((f) => {
      const ts = fieldTypeToTs(f.fieldType as FieldType)
      return f.required ? `  ${f.name}: ${ts}` : `  ${f.name}?: ${ts} | null`
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
    return [
      `/** Custom table "${t.name}" */`,
      `export interface ${pascalCase(t.name)}Table {`,
      `  id: string`,
      ...lines,
      `}`,
    ].join('\n')
  })
  const tableMapEntries = tables.map((t) => `  '${t.name}': ${pascalCase(t.name)}Table`)
  const tablesRegistryLine = tables.length ? [`    tables: TangenTables`] : []

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
    `/** A link field as Delivery returns it: content held by identity, or an external URL. */`,
    `export interface TangenInternalLink {`,
    `  type: 'internal'`,
    `  /** The authored identity. Present even when the target cannot be resolved. */`,
    `  targetRef: { type: string; id: string }`,
    `  /** The target's current facts, or null when it is missing, deleted or not public. */`,
    `  target: { type: string; id: string; slug: string | null; title: string | null; status: string } | null`,
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
    `export type TangenLink = TangenInternalLink | TangenExternalLink`,
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
    `}`,
    ``,
    ...typeBlocks.flatMap((b) => [b, '']),
    `/** Map of content type name → object interface, e.g. client.objects<TangenContentTypes['post']>('post') */`,
    `export interface TangenContentTypes {`,
    ...mapEntries,
    `}`,
    ``,
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
export async function runTypesCommand(cwd: string, outPath?: string): Promise<void> {
  const configPath = resolve(cwd, 'tangen.config.ts')
  const schema = await loadLocalSchema(configPath)
  const globals = await loadLocalGlobals(configPath)
  const tables = await loadLocalTables(configPath)
  const { locales, roles, extensions } = await loadLocalIds(configPath)

  const target = resolve(cwd, outPath ?? 'generated/tangen-types.d.ts')
  await Bun.write(target, generateContentTypesCode(schema, globals, tables, locales, roles, extensions))
  const extra = [
    globals.length ? `${globals.length} globals` : '',
    tables.length ? `${tables.length} tables` : '',
    locales.length ? `${locales.length} locales` : '',
    roles.length ? `${roles.length} roles` : '',
    extensions.length ? `${extensions.length} extensions` : '',
  ].filter(Boolean).join(', ')
  console.log(`  Generated ${target} (${schema.types.length} content types${extra ? `, ${extra}` : ''})`)
}
