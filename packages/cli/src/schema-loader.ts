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
import { resolve, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { SchemaDefinition } from '@tangen/types'
import { configuredExtensions } from '@tangen/types'
import type { DbClient } from '@tangen/db'
import type { RuntimeSchema } from './types'

/** Which config files codegen must read, resolved the way the RUNTIME resolves them. */
export interface CodegenConfigs {
  /**
   * The root `tangen.config.ts`. The base for `customTables`, and the whole
   * configuration in a project with no workspace registry.
   */
  rootConfigPath: string
  /**
   * The workspace config the runtime would serve. Undefined when the project
   * has no registry, or when the chosen workspace ships no `workspace.config.ts`
   * - the runtime falls back to `{ name }` in that case, so codegen must find
   * nothing rather than reach for the root config's keys.
   */
  workspaceConfigPath?: string
  /** The workspace codegen generated for, for the command to name in its output. */
  workspaceSlug?: string
  /** The other slugs in the registry, so the command can say how to choose. */
  otherSlugs: string[]
}

/**
 * Resolves the config files `tangen types` must read.
 *
 * This mirrors `packages/api/src/services/workspace-loader.ts` deliberately and
 * exactly: the registry is `workspaces/index.ts` NEXT TO the root config, and a
 * workspace's own config is `workspaces/<slug>/workspace.config.ts`. The runtime
 * reads `globals`, `roles` and `localization` from the workspace config ONLY and
 * never consults the root config for them; `customTables` is the one key it
 * merges, with the root as the base.
 *
 * Codegen read the root config for all of it, so a project keeping its globals
 * in the workspace config - the scaffold's own shape - generated no global
 * types at all, and said nothing, because every loader here ends in
 * `catch { return [] }`.
 */
export async function resolveCodegenConfigs(configCwd: string, slug?: string): Promise<CodegenConfigs> {
  const rootConfigPath = resolve(configCwd, 'tangen.config.ts')
  const registryPath = join(configCwd, 'workspaces', 'index.ts')
  if (!existsSync(registryPath)) return { rootConfigPath, otherSlugs: [] }

  let defs: Array<{ slug?: string }> = []
  try {
    const mod = await import(registryPath)
    const raw = mod.default ?? mod
    defs = Array.isArray(raw) ? raw : []
  } catch {
    // An unreadable registry is the pre-workspaces shape as far as codegen is
    // concerned. The command reports it; it does not invent a workspace.
    return { rootConfigPath, otherSlugs: [] }
  }

  const slugs = defs.map((d) => d?.slug).filter((s): s is string => typeof s === 'string')
  if (!slugs.length) return { rootConfigPath, otherSlugs: [] }

  const chosen = slug && slugs.includes(slug) ? slug : slugs[0]!
  const workspaceConfigPath = join(configCwd, 'workspaces', chosen, 'workspace.config.ts')
  return {
    rootConfigPath,
    workspaceConfigPath: existsSync(workspaceConfigPath) ? workspaceConfigPath : undefined,
    workspaceSlug: chosen,
    otherSlugs: slugs.filter((s) => s !== chosen),
  }
}

/**
 * Merges custom tables by name, `base` first, `override` winning - the same
 * rule as `mergeCustomTables` in the workspace loader, which is what makes a
 * table declared on the root adapter reach a workspace that does not restate it.
 */
export function mergeCodegenTables<T extends { name: string }>(base: T[], override: T[]): T[] {
  const out = [...base]
  for (const t of override) {
    const i = out.findIndex((x) => x.name === t.name)
    if (i === -1) out.push(t)
    else out[i] = t
  }
  return out
}

/**
 * Removes code-side behavior (hooks/validate/dynamicOptions) from a schema.
 * Functions don't survive JSON anyway, but `hooks: { fn }` leaves an empty
 * `{}` husk behind — this keeps pushed structure identical to a function-free
 * schema. Behavior belongs to the runtime overlay, never to the DB.
 */
export function stripFieldBehavior(schema: SchemaDefinition): SchemaDefinition {
  for (const type of schema.types ?? []) {
    for (const field of type.fields ?? []) {
      // No cast: `FieldDefinition` declares all three as optional, so this is
      // what `delete` is for. The cast was both unnecessary and refused -
      // `FieldDefinition` and `Record<string, unknown>` do not overlap enough.
      delete field.hooks
      delete field.validate
      delete field.dynamicOptions
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
  // The replacer is imported rather than inlined so one definition serves
  // both the subprocess and its test. `schema-wire.ts` imports nothing, so
  // this adds no module graph to the isolated process.
  const wirePath = resolve(import.meta.dir, 'schema-wire.ts')
  const script = `
const mod = await import('${schemaAbsPath}')
const { schemaJsonReplacer } = await import('${wirePath}')
process.stdout.write(JSON.stringify(mod.default, schemaJsonReplacer))
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
): Promise<Array<{ name: string; label?: string; fields: Array<{ name: string; fieldType: string; required?: boolean; config?: Record<string, unknown> | null }> }>> {
  try {
    const configModule = await import(resolve(configPath))
    const cfg = configModule.default as { globals?: unknown }
    const raw = (cfg?.globals ?? []) as Array<{ name?: string; label?: string; fields?: Array<{ name?: string; fieldType?: string; required?: boolean; config?: Record<string, unknown> | null }> }>
    if (!Array.isArray(raw)) return []
    return raw
      .filter((g) => g && typeof g.name === 'string' && Array.isArray(g.fields))
      .map((g) => ({
        name: g.name as string,
        label: g.label,
        fields: (g.fields ?? [])
          .filter((f) => f && typeof f.name === 'string' && typeof f.fieldType === 'string')
          // `config` is carried through: it holds a relation's `many` and a
          // link's `allowedKinds`, and dropping it typed both from the field
          // kind alone.
          .map((f) => ({ name: f.name as string, fieldType: f.fieldType as string, required: f.required, config: (f as { config?: Record<string, unknown> | null }).config })),
      }))
  } catch {
    return []
  }
}

/**
 * Best-effort load of the workspace's reusable components for `tangen types`.
 * Components live on the config (`components:`, the registry the schema builder
 * maintains) and never in the pushed schema, which carries only their NAMES on
 * a `component` field - so without this read a page builder's blocks can only
 * be typed as `unknown`.
 * Returns [] if none / unresolvable - codegen then leaves those fields loose.
 */
export async function loadLocalComponents(
  configPath: string,
): Promise<Array<{ name: string; label?: string; fields: Array<{ name: string; fieldType: string; required?: boolean; config?: Record<string, unknown> | null }> }>> {
  try {
    const configModule = await import(resolve(configPath))
    const cfg = configModule.default as { components?: unknown }
    const raw = (cfg?.components ?? []) as Array<{ name?: string; label?: string; fields?: Array<Record<string, unknown>> }>
    if (!Array.isArray(raw)) return []
    return raw
      .filter((c) => c && typeof c.name === 'string' && Array.isArray(c.fields))
      .map((c) => ({
        name: c.name as string,
        label: c.label,
        fields: (c.fields ?? [])
          .filter((f) => f && typeof f.name === 'string' && typeof f.fieldType === 'string')
          .map((f) => ({
            name: f.name as string,
            fieldType: f.fieldType as string,
            required: f.required as boolean | undefined,
            // Carried whole: a component's sub-fields keep their options at the
            // field root as often as under `config`, and codegen reads both.
            config: (f.config ?? null) as Record<string, unknown> | null,
          })),
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
    ...(has('object_types', 'path') ? { path: objectTypes.path } : {}),
  }
  const types = await db
    .select(typeCols)
    .from(objectTypes) as Array<{
      id: string; name: string; label: string; singleton: boolean; previousNames: string[]; adminConfig: unknown
      plural?: string | null; disabled?: boolean; localized?: boolean; providedBy?: string | null
      path?: unknown
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
      // Absent on a database that predates the column; null there and here
      // both mean "this type declares no address".
      path: (t.path ?? null) as never,
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
          position: f.position,
        })),
    })),
  }
}
