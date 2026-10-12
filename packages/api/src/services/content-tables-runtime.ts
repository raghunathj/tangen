/**
 * File Name: content-tables-runtime.ts
 * Purpose: The content tables this process serves, built from the ONE schema
 *          registry of the database it holds (tasks/remove-environments-programme.md,
 *          stage R3). A push that changes the registry notifies every
 *          process, which reloads the schema and rebuilds the drizzle table
 *          objects; the generated `content-tables.ts` file is codegen and
 *          type support only.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `contentSpecsOf` is the one derivation of a table's
 *          columns from a type (used by push's codegen too). Components are
 *          the union of every loaded project's components: a localized
 *          container field needs its component's definition to know which
 *          side-table columns exist.
 */
import { flattenFields, fieldTypeToSql, type SchemaDefinition, type WorkspaceProject, type ComponentDef, type ContentTableSpec, type ContentI18nTableSpec } from '@tangen/types'
import { localizedContainerFields } from '@tangen/schema'
import { buildContentTables, setContentTables } from '@tangen/db/content-tables'

export interface ContentSpecs { tables: ContentTableSpec[]; i18n: ContentI18nTableSpec[] }

/** The table and side-table columns a schema needs. */
export function contentSpecsOf(schema: SchemaDefinition, components: ComponentDef[] = []): ContentSpecs {
  const tables: ContentTableSpec[] = []
  const i18n: ContentI18nTableSpec[] = []
  const isLocalizedField = (f: { fieldType: string; config?: unknown }) =>
    (f.config as Record<string, unknown> | undefined)?.localized === true && f.fieldType !== 'media'
  for (const type of schema.types) {
    const columnFields = flattenFields(type.fields)
    const columns: ContentTableSpec['columns'] = []
    for (const f of columnFields) {
      const kind = fieldTypeToSql(f.fieldType, f.config as Record<string, unknown>)
      if (kind) columns.push({ name: f.name, kind })
    }
    tables.push({ name: type.name, columns })
    const containerCols = localizedContainerFields(type.fields as never, components)
    const localized = (type as { localized?: boolean }).localized === true || type.fields.some(isLocalizedField) || containerCols.length > 0
    if (!localized) continue
    const emitted = new Set<string>()
    const side: ContentI18nTableSpec['columns'] = []
    for (const f of columnFields.filter(isLocalizedField)) {
      const kind = fieldTypeToSql(f.fieldType, f.config as Record<string, unknown>)
      if (kind && !emitted.has(f.name)) { emitted.add(f.name); side.push({ name: f.name, kind }) }
    }
    for (const name of containerCols) if (!emitted.has(name)) { emitted.add(name); side.push({ name, kind: 'JSONB' }) }
    i18n.push({ type: type.name, columns: side })
  }
  return { tables, i18n }
}

interface RuntimeState {
  loadSchema: () => Promise<SchemaDefinition>
  components: ComponentDef[]
  specs: ContentSpecs
  log?: (message: string) => void
}

let state: RuntimeState | null = null

function apply(specs: ContentSpecs): void {
  setContentTables(buildContentTables(specs.tables, specs.i18n))
}

export interface RebuildInput {
  projects: ReadonlyArray<WorkspaceProject>
  loadSchema: () => Promise<SchemaDefinition>
  log?: (message: string) => void
}

/** Boot: load the registry once and build the tables every route uses. */
export async function rebuildContentTables(input: RebuildInput): Promise<ContentSpecs> {
  const components = input.projects.flatMap((p) => (p.components ?? []) as ComponentDef[])
  const schema = await input.loadSchema()
  const specs = contentSpecsOf(schema, components)
  state = { loadSchema: input.loadSchema, components, specs, log: input.log }
  apply(specs)
  input.log?.(`content tables: ${specs.tables.length} table${specs.tables.length === 1 ? '' : 's'} from the registry of this database`)
  return specs
}

/** A schema load anywhere in the process (a push notification, a cache refill) rebuilds the tables. */
export function contentTablesSchemaLoaded(schema: SchemaDefinition): void {
  if (!state) return
  state.specs = contentSpecsOf(schema, state.components)
  apply(state.specs)
}

export async function reloadContentTables(): Promise<void> {
  if (!state) return
  contentTablesSchemaLoaded(await state.loadSchema())
}

export function contentTablesRuntimeStatus(): { tables: string[] } | null {
  if (!state) return null
  return { tables: state.specs.tables.map((t) => t.name).sort() }
}

export function __resetContentTablesRuntime(): void { state = null }
