/**
 * File Name: schema-regenerate.ts
 * Purpose: `tangen schema regenerate` - rewrites the generated
 *          content-tables.ts (and custom-tables.ts) from the environment's
 *          REGISTRY through the same generator push uses, so the file is
 *          byte-identical to what a successful push would have written. No
 *          DDL, no registry change. The recovery for a generated file that is
 *          behind the registry (a push that stopped after its apply, a scoped
 *          push from another environment, a git pull): the API silently drops
 *          writes to the missing columns until the file is regenerated.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Refuses (exit 1) when doctor's registry-vs-database
 *          checks show the database behind the registry, because a file that
 *          names columns the database lacks makes every read of that type fail
 *          with 42703; `--force` overrides with a warning. tangen-types.d.ts is
 *          derived from local code by `tangen types`, not from this artifact,
 *          so it is left alone. `regenerateFromRegistry` takes an injected
 *          query function and output directory so the test runs it against
 *          PGlite into a temp dir.
 */
import { resolveDeploymentDatabase, describeDatabaseError, type DeploymentDatabase } from '../deployment-database'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { SchemaDefinition, TangenConfig, CustomTableDefinition } from '@tangen/types'
import { checkSchemaDrift, type DriftFinding } from '@tangen/schema'
import { generatePushArtifacts, writePushArtifacts, type PushArtifacts } from '../push-pipeline'
import { resolveContentTablesDir } from '../codegen'
import { parseGeneratedSource } from '../doctor-checks'
import { schemaFromRegistry, diffGeneratedSnapshots, renderArtifactDiff, type ArtifactDiff } from '../regenerate-artifacts'
import { loadLocalSchema } from '../schema-loader'
import { readRegistry, readDatabase, describeDbTarget, queryOver, type DoctorQuery } from './doctor'
import { resolveEffectiveConfig, gatherCustomTables } from './push'
import { c, sym, log } from '../ui'

export interface RegenerateOptions {
  query: DoctorQuery
  /** Local code, for column order only; a failure falls back to registry order. */
  loadLocal: () => Promise<SchemaDefinition>
  /** Where content-tables.ts / custom-tables.ts live (resolveContentTablesDir for the real command). */
  outDir: string
  components?: unknown[]
  customTables?: CustomTableDefinition[]
  localizationEnabled?: boolean
  force?: boolean
}

export type RegenerateResult =
  | { ok: true; written: string[]; diff: ArtifactDiff; customTablesChanged: boolean | null; unchanged: boolean; forced: DriftFinding[]; localOrder: boolean }
  | { ok: false; reason: 'db-behind-registry'; blockers: DriftFinding[] }

/** Registry-vs-database findings that make a regenerated file dangerous to load. */
function blockingFindings(findings: DriftFinding[]): DriftFinding[] {
  return findings.filter((f) => f.pair === 'registry/db' && f.severity === 'error')
}

/** The core: read the registry, guard, generate, compare, write. Pure apart from the injected reads and the file writes. */
export async function regenerateFromRegistry(opts: RegenerateOptions): Promise<RegenerateResult> {
  const [{ registry, runtime }, db] = await Promise.all([
    readRegistry(opts.query),
    readDatabase(opts.query),
  ])

  // The doctor guard: a registry field whose column the database lacks would
  // become a column in the file, and every read of that type would 42703.
  const report = checkSchemaDrift({
    registry,
    db,
    components: (opts.components ?? []) as never,
    localizationEnabled: opts.localizationEnabled === true,
  })
  const blockers = blockingFindings(report.findings)
  if (blockers.length > 0 && !opts.force) return { ok: false, reason: 'db-behind-registry', blockers }

  let localOrder: SchemaDefinition | null = null
  try { localOrder = await opts.loadLocal() } catch { /* registry order */ }

  const schema = schemaFromRegistry(runtime, localOrder)
  const artifacts: PushArtifacts = generatePushArtifacts(schema, (opts.components ?? []) as never, opts.customTables)

  const contentPath = resolve(opts.outDir, 'content-tables.ts')
  const customPath = resolve(opts.outDir, 'custom-tables.ts')
  const before = existsSync(contentPath) ? readFileSync(contentPath, 'utf8') : ''
  const diff = diffGeneratedSnapshots(
    parseGeneratedSource(before, contentPath),
    parseGeneratedSource(artifacts.contentTables, contentPath),
  )
  const customBefore = existsSync(customPath) ? readFileSync(customPath, 'utf8') : null
  const customTablesChanged = artifacts.customTables === undefined ? null : customBefore !== artifacts.customTables
  // Unchanged means BOTH files already say this - the per-environment file
  // is what a pinned process loads, so its absence is a change to make.
  const unchanged = before === artifacts.contentTables && customTablesChanged !== true

  const written = unchanged ? [] : writePushArtifacts(artifacts, opts.outDir)
  return { ok: true, written, diff, customTablesChanged, unchanged, forced: blockers, localOrder: localOrder !== null }
}

export interface RegenerateCommandOptions { force?: boolean; json?: boolean }

/** Loads the config, connects, runs the core, prints. Sets process.exitCode (0 written or unchanged, 1 refused, 2 unreachable). */
export async function runSchemaRegenerateCommand(cwd: string, opts: RegenerateCommandOptions = {}): Promise<RegenerateResult | null> {
  const configPath = resolve(cwd, 'tangen.config.ts')
  const fail = (message: string): null => {
    if (opts.json) console.log(JSON.stringify({ version: 1, ok: false, exitCode: 2, error: message }, null, 2))
    else log.error(message)
    process.exitCode = 2
    return null
  }

  let config: TangenConfig
  try {
    const mod = await import(`${configPath}?t=${Date.now()}`)
    config = await resolveEffectiveConfig(cwd, mod.default as TangenConfig)
  } catch (e) {
    return fail(`Could not load tangen.config.ts from ${cwd}: ${e instanceof Error ? e.message : String(e)}`)
  }
  let database: DeploymentDatabase
  try {
    database = resolveDeploymentDatabase()
  } catch (e) {
    return fail(describeDatabaseError(e))
  }

  const { createDb } = await import('@tangen/db')
  const { sql } = await import('drizzle-orm')
  const db = createDb(database.url)
  const query = queryOver(db, (text) => sql.raw(text))
  try {
    await query('SELECT 1')
  } catch (e) {
    return fail(`Could not connect to ${describeDbTarget(database.url)}: ${e instanceof Error ? e.message : String(e)}`)
  }

  const outDir = resolveContentTablesDir(cwd, cwd)
  const customTables = await gatherCustomTables(cwd, config.customTables) as CustomTableDefinition[]
  const result = await regenerateFromRegistry({
    query,
    loadLocal: () => loadLocalSchema(configPath),
    outDir,
    components: (config as { components?: unknown[] }).components,
    customTables,
    localizationEnabled: (config as { localization?: { enabled?: boolean } }).localization?.enabled === true,
    force: opts.force,
  })

  const rel = (p: string) => p.replace(cwd + '/', '').replace(resolve(cwd, '..') + '/', '')
  if (!result.ok) {
    process.exitCode = 1
    if (opts.json) {
      console.log(JSON.stringify({ version: 1, ok: false, exitCode: 1, reason: result.reason, blockers: result.blockers }, null, 2))
      return result
    }
    log.error(`Refusing to regenerate: the database is behind its registry, so the regenerated file would name columns the database lacks and every read of those types would fail with 42703.`)
    for (const b of result.blockers) {
      console.error(`     ${sym.cross}  ${c.bold(b.subject)}  ${b.cause}`)
      console.error(`        ${sym.arrow} ${c.cyan(b.fix)}`)
    }
    console.error(`  ${sym.bullet}  ${c.dim(`fix the database first (tangen doctor lists everything), or re-run with --force to write the file anyway.`)}`)
    return result
  }

  process.exitCode = 0
  if (opts.json) {
    console.log(JSON.stringify({ version: 1, ok: true, exitCode: 0, unchanged: result.unchanged, written: result.written, diff: result.diff, customTablesChanged: result.customTablesChanged, forced: result.forced.length > 0 }, null, 2))
    return result
  }
  if (result.forced.length > 0) {
    log.warn(`--force: the database is behind its registry; the file now names ${result.forced.length} column${result.forced.length === 1 ? '' : 's'} the database lacks (reads of those types fail with 42703 until the database catches up):`)
    for (const b of result.forced) console.warn(`     ${sym.cross}  ${c.bold(b.subject)}  ${c.dim(b.fix)}`)
  }
  if (!result.localOrder) log.info('local code did not load - columns follow the registry order, so the file can differ from a push in order only')
  if (result.unchanged) {
    console.log(`  ${sym.dash}  ${c.dim(`content-tables.ts already matches the registry - nothing written`)}`)
  } else {
    const lines = renderArtifactDiff(result.diff)
    if (lines.length > 0) {
      console.log(`  ${c.dim(`content-tables.ts - changes against the file on disk:`)}`)
      for (const l of lines) console.log(l)
    }
    for (const p of result.written) log.ok(`${p.endsWith('custom-tables.ts') ? 'custom tables' : 'content tables'} ${sym.arrow} ${rel(p)}${p.endsWith('custom-tables.ts') && result.customTablesChanged === false ? c.dim(' (unchanged)') : ''}`)
  }
  log.info('tangen-types.d.ts is generated from local code by `tangen types` - not touched')
  console.log()
  console.log(`  ${sym.tick}  ${c.bold('Generated files match the registry')}  ${c.dim('- restart the API (or let --watch reload) to pick them up')}`)
  console.log()
  return result
}
