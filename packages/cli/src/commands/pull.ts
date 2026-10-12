/**
 * File Name: pull.ts
 * Purpose: Implements the `tangen pull` command, which fetches the live runtime schema
 *   from the database and writes it as local TypeScript schema files in the v2 app
 *   layout (`app/content-objects/<type>/schema.ts`, the layout `tangen migrate layout`
 *   produces and the scaffold ships) - `--layout v1` writes the old `content/` tree.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires `@tangen/db` for DB access; writes one schema.ts per
 *   type and regenerates the directory's index.ts as the defineSchema barrel.
 */
import { resolveDeploymentDatabase, describeDatabaseError } from '../deployment-database'
import { resolve, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { TangenConfig } from '@tangen/types'
import type { RuntimeObjectType } from '../types'
// Codegen shared with the admin Content Object Builder (no drift).
import { generateObjectTypeSource, generateSchemaBarrel } from '@tangen/schema'

/** @deprecated use `generateObjectTypeSource` from @tangen/schema. */
export const generateSchemaFileContent = (type: RuntimeObjectType): string => generateObjectTypeSource(type)

/** @deprecated use `generateSchemaBarrel` from @tangen/schema. */
export const generateBarrelContent = (typeNames: string[]): string => generateSchemaBarrel(typeNames)

/** Where pull writes: the v2 layout (`content-objects/`, default) or the v1 `content/` tree. */
export type PullLayout = 'v1' | 'v2'

/** The schema directory of a layout, relative to the config directory (`app/`). */
export function pullSchemaDir(layout: PullLayout): string {
  return layout === 'v1' ? 'content' : 'content-objects'
}

/**
 * Writes schema files for all provided runtime types into
 * `<configCwd>/content-objects/` (or `content/` for `--layout v1`), then
 * regenerates the barrel index.
 * @param types - Array of runtime object types to write to disk
 * @param configCwd - The config directory (`app/`) that will contain the schema folder
 * @param log - Optional logger; defaults to `console.log`
 * @param opts.layout - `v2` (default) or `v1`
 */
export async function runPullCommand(
  types: RuntimeObjectType[],
  configCwd: string,
  log: (msg: string) => void = console.log,
  opts: { layout?: PullLayout } = {},
): Promise<void> {
  const dir = pullSchemaDir(opts.layout ?? 'v2')
  const contentDir = join(configCwd, dir)

  for (const type of types) {
    const typeDir = join(contentDir, type.name)
    mkdirSync(typeDir, { recursive: true })
    writeFileSync(join(typeDir, 'schema.ts'), generateSchemaFileContent(type))
    log(`  wrote ${dir}/${type.name}/schema.ts`)
  }

  writeFileSync(join(contentDir, 'index.ts'), generateBarrelContent(types.map(t => t.name)))
  log(`  wrote ${dir}/index.ts (${types.length} type${types.length !== 1 ? 's' : ''})`)
}

/**
 * Loads `tangen.config.ts`, connects to the deployment's database, fetches the
 * live schema, and delegates to `runPullCommand` to write the local schema files.
 * @param cwd - Directory containing `tangen.config.ts`
 * @param workspaceId - Optional workspace ID override (reserved, not yet consumed)
 */
export async function runPullFromConfig(
  cwd: string,
  workspaceId?: string,
  opts: { layout?: PullLayout } = {},
): Promise<void> {
  const configPath = resolve(cwd, 'tangen.config.ts')

  let config: TangenConfig
  try {
    const mod = await import(configPath)
    const { resolveEffectiveConfig } = await import('./push-config')
    config = await resolveEffectiveConfig(cwd, mod.default as TangenConfig)
  } catch {
    console.error(`Could not load tangen.config.ts from ${cwd}`)
    process.exit(1)
  }

  let database: { url: string }
  try {
    database = resolveDeploymentDatabase()
  } catch (e) {
    console.error(describeDatabaseError(e))
    process.exit(1)
  }

  const { createDb } = await import('@tangen/db')
  const db = createDb(database.url)

  const { loadRuntimeSchema } = await import('../schema-loader')
  const schema = await loadRuntimeSchema(db)

  // A type an extension provisions is NOT this project's code. Writing a schema
  // file for it would silently create a site OVERRIDE of the extension's
  // definition - the site would then own the type, and stop tracking the
  // extension's changes - which is a decision, not a side effect of `pull`.
  const provided = schema.types.filter((t) => t.providedBy)
  const own = schema.types.filter((t) => !t.providedBy)
  for (const t of provided) {
    console.log(`[tangen pull] skipping "${t.name}" - provided by extension ${t.providedBy} (declare it in your own schema to take it over)`)
  }

  if (own.length === 0) {
    console.log('[tangen pull] No types found in the registry - nothing to write.')
    return
  }

  console.log(`[tangen pull] pulling ${own.length} type(s) from the registry...`)
  await runPullCommand(own, cwd, console.log, opts)
}
