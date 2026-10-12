/**
 * File Name: schema-loader.ts
 * Purpose: Loads the local schema definition from the project's TypeScript barrel file and the
 * runtime schema from the live database, providing both sides for the diff computation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Local schema is loaded in a Bun subprocess to avoid module caching side-effects.
 * Runtime schema is fetched from the object_types and fields tables via drizzle-orm, with
 * SELECTs only (the system-column guards belong to the push's apply phase).
 */
import { resolve, dirname } from 'node:path'
import type { SchemaDefinition } from '@tangen/types'
import { configuredExtensions } from '@tangen/types'
import type { DbClient } from '@tangen/db'
import type { RuntimeSchema } from './types'

/**
 * Removes code-side behavior (hooks/validate/dynamicOptions) from a schema.
 * Functions don't survive JSON anyway, but `hooks: { fn }` leaves an empty
 * `{}` husk behind — this keeps pushed structure identical to a function-free
 * schema. Behavior belongs to the runtime overlay, never to the DB.
 */
export function stripFieldBehavior(schema: SchemaDefinition): SchemaDefinition {
  for (const type of schema.types ?? []) {
    for (const field of type.fields ?? []) {
      delete (field as Record<string, unknown>).hooks
      delete (field as Record<string, unknown>).validate
      delete (field as Record<string, unknown>).dynamicOptions
    }
  }
  return schema
}

export async function loadLocalSchema(configPath: string): Promise<SchemaDefinition> {
  const absConfigPath = resolve(configPath)
  const projectRoot = dirname(absConfigPath)

  // Import the config in-process (Bun can import TS directly)
  const configModule = await import(absConfigPath)
  const config = configModule.default as { schema?: string }
  const schemaRelPath = config.schema ?? './schema/index.ts'
  const schemaAbsPath = resolve(projectRoot, schemaRelPath)

  // Spawn a subprocess to import the schema barrel in isolation.
  // This prevents the schema's defineObjectType calls from running in the CLI's
  // own module graph and avoids any module caching side-effects.
  const script = `
const mod = await import('${schemaAbsPath}')
process.stdout.write(JSON.stringify(mod.default))
`
  const proc = Bun.spawn(['bun', '-e', script], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  await proc.exited

  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`Failed to load local schema from "${schemaRelPath}":\n${err}`)
  }

  const json = await new Response(proc.stdout).text()
  return stripFieldBehavior(JSON.parse(json) as SchemaDefinition)
}

/**
 * Best-effort load of the workspace globals for `tangen types`. Globals live in
 * the config (defineGlobals / workspace config), not the pushed schema, so we
 * read them from the config module directly. Returns [] if none / unresolvable
 * — codegen then simply omits the globals block (graceful).
 */
export async function loadLocalGlobals(
  configPath: string,
): Promise<Array<{ name: string; label?: string; fields: Array<{ name: string; fieldType: string; required?: boolean }> }>> {
  try {
    const configModule = await import(resolve(configPath))
    const cfg = configModule.default as { globals?: unknown }
    const raw = (cfg?.globals ?? []) as Array<{ name?: string; label?: string; fields?: Array<{ name?: string; fieldType?: string; required?: boolean }> }>
    if (!Array.isArray(raw)) return []
    return raw
      .filter((g) => g && typeof g.name === 'string' && Array.isArray(g.fields))
      .map((g) => ({
        name: g.name as string,
        label: g.label,
        fields: (g.fields ?? [])
          .filter((f) => f && typeof f.name === 'string' && typeof f.fieldType === 'string')
          .map((f) => ({ name: f.name as string, fieldType: f.fieldType as string, required: f.required })),
      }))
  } catch {
    return []
  }
}

/**
 * Best-effort load of the workspace custom tables for `tangen types`. Like
 * globals, tables live in the config (defineTable), not the pushed schema.
 * Returns [] if none / unresolvable — codegen omits the tables block.
 */
export async function loadLocalTables(
  configPath: string,
): Promise<Array<{ name: string; columns: Array<{ name: string; kind: string; nullable?: boolean }> }>> {
  try {
    const configModule = await import(resolve(configPath))
    const cfg = configModule.default as { customTables?: unknown }
    const raw = (cfg?.customTables ?? []) as Array<{ name?: string; columns?: Record<string, { kind?: string; nullable?: boolean }> }>
    if (!Array.isArray(raw)) return []
    return raw
      .filter((t) => t && typeof t.name === 'string' && t.columns && typeof t.columns === 'object')
      .map((t) => ({
        name: t.name as string,
        columns: Object.entries(t.columns ?? {})
          .filter(([, c]) => c && typeof c.kind === 'string')
          .map(([name, c]) => ({ name, kind: c.kind as string, nullable: c.nullable })),
      }))
  } catch {
    return []
  }
}

/**
 * Best-effort load of locale codes + role slugs + extension ids for
 * `tangen types`, read from the config's localization + roles + extensions.
 * Extension ids are derived the same way the /extensions list route does:
 * the last segment of the resolve path ('../../extensions/flows' → 'flows').
 * Returns empty lists if unresolvable — codegen then omits those registry
 * unions (names stay loose `string`).
 */
export async function loadLocalIds(
  configPath: string,
): Promise<{ locales: string[]; roles: string[]; extensions: string[] }> {
  try {
    const configModule = await import(resolve(configPath))
    const cfg = configModule.default as {
      localization?: { locales?: Array<{ code?: string } | string> }
      roles?: Array<{ slug?: string; name?: string } | string>
    }
    const locales = (cfg?.localization?.locales ?? [])
      .map((l) => (typeof l === 'string' ? l : l?.code))
      .filter((c): c is string => typeof c === 'string')
    const roles = (cfg?.roles ?? [])
      .map((r) => (typeof r === 'string' ? r : (r?.slug ?? r?.name)))
      .filter((r): r is string => typeof r === 'string')
    // The same reading the server does - `extensions`, then the deprecated
    // `plugins`/`apps` - so an ambiguous config cannot mean two things.
    const extensions = configuredExtensions(cfg as never).entries
      .map((e) => (e as { resolve?: string })?.resolve)
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.split('/').pop() ?? p)
      .filter(Boolean)
    return { locales, roles, extensions }
  } catch {
    return { locales: [], roles: [], extensions: [] }
  }
}

/**
 * Reads the registry (object_types + fields) for one environment. READ-ONLY:
 * it selects only the columns the database actually has, so a not-yet-migrated
 * registry (missing `disabled`, `plural`, `localized`) still loads - the
 * optional columns default. The idempotent system-column guards run in the
 * push's apply phase, never here, so `--plan` and `tangen diff` write nothing.
 */
export async function loadRuntimeSchema(
  db: DbClient,
): Promise<RuntimeSchema> {
  const { objectTypes, fields } = await import('@tangen/db')
  const { eq, inArray, sql } = await import('drizzle-orm')

  const present = await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name IN ('object_types', 'fields')
  `) as unknown as Array<{ table_name: string; column_name: string }> | { rows?: Array<{ table_name: string; column_name: string }> }
  const presentRows = Array.isArray(present) ? present : (present.rows ?? [])
  const has = (table: string, column: string) => presentRows.some((r) => r.table_name === table && r.column_name === column)

  const typeCols = {
    id: objectTypes.id,
    name: objectTypes.name,
    label: objectTypes.label,
    singleton: objectTypes.singleton,
    previousNames: objectTypes.previousNames,
    adminConfig: objectTypes.adminConfig,
    ...(has('object_types', 'plural') ? { plural: objectTypes.plural } : {}),
    ...(has('object_types', 'disabled') ? { disabled: objectTypes.disabled } : {}),
    ...(has('object_types', 'localized') ? { localized: objectTypes.localized } : {}),
    ...(has('object_types', 'provided_by') ? { providedBy: objectTypes.providedBy } : {}),
  }
  const types = await db
    .select(typeCols)
    .from(objectTypes) as Array<{
      id: string; name: string; label: string; singleton: boolean; previousNames: string[]; adminConfig: unknown
      plural?: string | null; disabled?: boolean; localized?: boolean; providedBy?: string | null
    }>

  if (types.length === 0) return { types: [] }

  const typeIds = types.map(t => t.id)
  const fieldCols = {
    id: fields.id,
    typeId: fields.typeId,
    name: fields.name,
    label: fields.label,
    fieldType: fields.fieldType,
    config: fields.config,
    previousNames: fields.previousNames,
    position: fields.position,
    required: fields.required,
    ...(has('fields', 'disabled') ? { disabled: fields.disabled } : {}),
  }
  const allFields = await db
    .select(fieldCols)
    .from(fields)
    .where(inArray(fields.typeId, typeIds)) as Array<{
      id: string; typeId: string; name: string; label: string; fieldType: string; config: unknown
      previousNames: string[]; position: number; required: boolean; disabled?: boolean
    }>

  return {
    types: types.map(t => ({
      id: t.id,
      name: t.name,
      label: t.label,
      plural: t.plural ?? null,
      singleton: t.singleton,
      disabled: t.disabled ?? false,
      localized: t.localized ?? false,
      previousNames: t.previousNames,
      adminConfig: t.adminConfig as Record<string, unknown>,
      providedBy: t.providedBy ?? null,
      fields: allFields
        .filter(f => f.typeId === t.id)
        .sort((a, b) => a.position - b.position)
        .map(f => ({
          id: f.id,
          name: f.name,
          label: f.label,
          fieldType: f.fieldType,
          config: f.config as Record<string, unknown>,
          previousNames: f.previousNames,
          required: f.required,
          disabled: f.disabled ?? false,
        })),
    })),
  }
}
