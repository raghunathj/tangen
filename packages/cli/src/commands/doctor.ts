/**
 * File Name: doctor.ts
 * Purpose: `tangen doctor` - a READ-ONLY comparison of the four
 *          sources that describe one environment's schema: local code, the
 *          registry rows, the generated content-tables.ts the API loads, and
 *          the live database (information_schema, pg_indexes, pg_constraint).
 *          Every disagreement is printed with its cause and the command that
 *          fixes it. Exit 0 when clean, 1 on drift, 2 when the database or
 *          the config cannot be reached. `--json` for tooling.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Never writes. It deliberately does not use
 *          loadRuntimeSchema (which runs ensureSystemColumns, a DDL backfill)
 *          - the registry is read with plain SELECTs that tolerate an older
 *          registry shape. The comparison itself is @tangen/schema
 *          checkSchemaDrift; the row-to-snapshot helpers are doctor-checks.ts.
 *          `collectDoctorInputs` takes an injected query function so the test
 *          runs it against PGlite.
 */
import { grantNames } from '@tangen/types'
import { loadConfigExtensions } from './extension-install'
import { resolveDeploymentDatabase, describeDatabaseError, type DeploymentDatabase } from '../deployment-database'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import type { SchemaDefinition, TangenConfig } from '@tangen/types'
import { checkSchemaDrift, type DbSnapshot, type DriftFinding, type DriftInputs, type DriftReport, type GeneratedSnapshot, type RegistrySnapshot } from '@tangen/schema'
import { diff } from '../diff'
import { loadLocalSchema } from '../schema-loader'
import { loadExtensionTypes, mergeDeclaredTypes } from '../extension-schema'
import {
  DOCTOR_SQL, dbSnapshotFromRows, doctorExitCode, parseGeneratedSource, registryFromRows,
  renderDoctorReport, resolveApiGeneratedFile, summarizePlan, type DoctorSources, type Row,
} from '../doctor-checks'
import { resolveEffectiveConfig, gatherCustomTables } from './push'
import { checkSystemSchema, checkPushHistory, withSystemFindings, checkExtensionRetention, checkExtensionSettingsGrants, checkRetiredRoutes, type ExtensionRetentionInputs } from '../doctor-system'
import { verifyPushHistoryRows, type PushHistoryRow } from '../push-history'
import type { RuntimeSchema } from '../types'
import { c, sym } from '../ui'

/** One read-only statement in, rows out. The command builds it over a drizzle client; tests over PGlite. */
export type DoctorQuery = (sql: string) => Promise<Row[]>

import type { ConnectionDiagnostics } from '../doctor-connection'

export interface CollectOptions {
  /** The project's extension manifests (E.15: settings gated behind grants). */
  manifests?: ReadonlyArray<{ id: string; settings?: unknown; grants?: { required?: unknown[]; optional?: unknown[] } }>
  query: DoctorQuery
  /** Loads local code; a thrown error becomes a LOCAL_UNLOADABLE finding, never a crash. */
  loadLocal: () => Promise<SchemaDefinition>
  /** The generated file the API will load, or null when none exists. */
  generated: { path: string; origin: 'project' | 'bundled'; code: string } | null
  /** Display name for the database (host/db, never credentials). */
  dbTarget: string
  components?: unknown[]
  localizationEnabled?: boolean
  customTables?: Array<{ name: string; columns: Record<string, { kind: string }> }>
  /** Knowledge is on for this workspace, so its @tangen/db tables are expected. */
  knowledgeEnabled?: boolean
}

/** The registry, read with plain SELECTs. */
export async function readRegistry(query: DoctorQuery): Promise<{ registry: RegistrySnapshot; runtime: RuntimeSchema }> {
  const [typeRows, fieldRows] = await Promise.all([
    query(DOCTOR_SQL.objectTypes),
    query(DOCTOR_SQL.fields),
  ])
  const { snapshot: registry, runtime } = registryFromRows(typeRows, fieldRows)
  return { registry, runtime }
}

/** The live database: every table of the current schema with columns, indexes and primary key. */
export async function readDatabase(query: DoctorQuery): Promise<DbSnapshot> {
  const [columnRows, indexRows, pkeyRows] = await Promise.all([
    query(DOCTOR_SQL.columns),
    query(DOCTOR_SQL.indexes),
    query(DOCTOR_SQL.pkeys),
  ])
  return dbSnapshotFromRows(columnRows, indexRows, pkeyRows)
}

/** Runs the reads and assembles the drift inputs plus the source summary for the report, and the system-table findings. */
/** The retention reads behind checkExtensionRetention; every read degrades to nothing when its table is absent. */
async function readExtensionRetention(query: CollectOptions['query']): Promise<DriftFinding[]> {
  const q = async (text: string) => query(text).catch(() => [] as Array<Record<string, unknown>>)
  const tombstoneRows = await q(`SELECT app_id, uninstalled_at FROM workspace_installed_apps WHERE state = 'uninstalled' ORDER BY app_id`)
  const tombstones: ExtensionRetentionInputs['tombstones'] = []
  for (const r of tombstoneRows) {
    const id = String(r.app_id).replace(/'/g, "''")
    const data = await q(`SELECT count(*)::int AS n FROM extension_data WHERE extension_id = '${id}'`)
    const ledger = await q(`SELECT count(*)::int AS n FROM extension_migrations WHERE extension_id = '${id}'`)
    const tables = await q(`SELECT table_name FROM custom_table_owners WHERE owner_kind = 'extension' AND owner_id = '${id}' ORDER BY table_name`)
    tombstones.push({
      extensionId: String(r.app_id), uninstalledAt: r.uninstalled_at ? new Date(String(r.uninstalled_at)).toISOString() : null,
      extensionDataRows: Number(data[0]?.n ?? 0), ledgerRows: Number(ledger[0]?.n ?? 0), tables: tables.map((t) => String(t.table_name)),
    })
  }
  const orphanRows = await q(`SELECT o.table_name, o.owner_id, o.owner_version FROM custom_table_owners o WHERE o.owner_kind = 'extension' AND NOT EXISTS (SELECT 1 FROM workspace_installed_apps w WHERE w.app_id = o.owner_id AND w.state = 'installed') ORDER BY o.table_name`)
  const failedRows = await q(`SELECT extension_id, migration_id, error FROM extension_migrations WHERE status = 'failed' ORDER BY extension_id, migration_id`)
  return checkExtensionRetention({
    tombstones,
    orphanTables: orphanRows.map((o) => ({ table: String(o.table_name), extensionId: String(o.owner_id), version: (o.owner_version as string | null) ?? null })),
    failedMigrations: failedRows.map((f) => ({ extensionId: String(f.extension_id), migrationId: String(f.migration_id), error: (f.error as string | null) ?? null })),
  })
}


/** E.15: for every installed extension whose manifest declares settings, the fields whose required grant its recorded approval does not cover. */
async function readExtensionSettingsGrants(query: CollectOptions['query'], manifests: ReadonlyArray<{ id: string; settings?: unknown; grants?: { required?: unknown[]; optional?: unknown[] } }>): Promise<DriftFinding[]> {
  const withSettings = manifests.filter((m) => m.settings && typeof m.settings === 'object')
  if (withSettings.length === 0) return []
  const rows = await query(`SELECT app_id, granted_grants FROM workspace_installed_apps WHERE state = 'installed'`).catch(() => [] as Array<Record<string, unknown>>)
  const seen = new Set<string>()
  const inputs: Parameters<typeof checkExtensionSettingsGrants>[0] = []
  for (const r of rows) {
    const m = withSettings.find((x) => x.id === String(r.app_id))
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    const recorded = Array.isArray(r.granted_grants) ? (r.granted_grants as string[]) : typeof r.granted_grants === 'string' ? (JSON.parse(r.granted_grants) as string[]) : null
    const required = grantNames((m.grants?.required ?? []) as never)
    const declared = new Set([...required, ...grantNames((m.grants?.optional ?? []) as never)])
    inputs.push({ extensionId: m.id, settings: m.settings as never, effective: Array.isArray(recorded) ? recorded.filter((g) => declared.has(g)) : required })
  }
  return checkExtensionSettingsGrants(inputs)
}

export async function collectDoctorInputs(opts: CollectOptions): Promise<{ inputs: DriftInputs; sources: DoctorSources; system: DriftFinding[] }> {
  const { readKnowledgeSchemaStatus } = await import('@tangen/db')
  const [{ registry, runtime }, db, knowledgeStatus] = await Promise.all([
    readRegistry(opts.query),
    readDatabase(opts.query),
    readKnowledgeSchemaStatus(async (text) => opts.query(text)),
  ])
  const system = checkSystemSchema({ db, knowledge: { enabled: opts.knowledgeEnabled === true, status: knowledgeStatus } })
  // The push ledger, re-fingerprinted. A database without the table has no history to verify.
  const ledgerRows = await opts.query(
    'SELECT id, started_at, status, checksum, plan_json, statements_json FROM schema_pushes ORDER BY started_at',
  ).catch(() => null)
  if (ledgerRows) {
    system.push(...checkPushHistory(verifyPushHistoryRows(ledgerRows.map((r) => ({
      id: String(r.id), startedAt: r.started_at as Date | string, status: String(r.status),
      checksum: (r.checksum as string | null) ?? null, planJson: r.plan_json, statementsJson: r.statements_json,
    } satisfies PushHistoryRow)))))
  }

  // Extension retention (Phase 4, Unit 9): what uninstalls left behind,
  // tables nobody installed owns, migrations that failed. A database
  // without these tables (an older install) has nothing to report.
  system.push(...await readExtensionRetention(opts.query))
  // E.15: settings gated behind a grant the installation was not approved; E.16: retired external URL forms.
  system.push(...await readExtensionSettingsGrants(opts.query, opts.manifests ?? []))
  system.push(...checkRetiredRoutes())

  // No generated file at all: the API loads an empty registry. Compare
  // against an empty snapshot so every registered type is reported missing.
  const generated: GeneratedSnapshot = opts.generated
    ? parseGeneratedSource(opts.generated.code, opts.generated.path)
    : { source: '(none)', tables: {}, i18nTables: {} }

  let local: DriftInputs['local']
  let localSource: DoctorSources['local']
  let extensionOrphans: DriftInputs['extensionOrphans'] = []
  try {
    const schema = await opts.loadLocal()
    const plan = diff(schema, runtime)
    local = { delta: summarizePlan(plan) }
    extensionOrphans = plan.orphans ?? []
    localSource = { types: schema.types.length }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    local = { error: message }
    localSource = { error: message }
  }

  const inputs: DriftInputs = {
    registry,
    generated,
    db,
    components: (opts.components ?? []) as never,
    localizationEnabled: opts.localizationEnabled === true,
    customTables: opts.customTables,
    local,
    extensionOrphans,
  }
  const sources: DoctorSources = {
    local: localSource,
    registry: { types: registry.types.length, fields: registry.types.reduce((n, t) => n + t.fields.length, 0) },
    generated: opts.generated
      ? { source: opts.generated.path, origin: opts.generated.origin, tables: Object.keys(generated.tables).length, i18nTables: Object.keys(generated.i18nTables).length }
      : null,
    db: { target: opts.dbTarget, tables: Object.keys(db.tables).length },
  }
  return { inputs, sources, system }
}

/** host:port/database from a connection URL, credentials dropped. */
export function describeDbTarget(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`
  } catch {
    return 'database'
  }
}

/** Wraps a drizzle client as the one-statement query doctor needs (postgres-js returns rows, pglite {rows}). */
export function queryOver(db: { execute: (q: never) => PromiseLike<unknown> }, raw: (text: string) => unknown): DoctorQuery {
  return async (text) => {
    const res = await db.execute(raw(text) as never) as Row[] | { rows?: Row[] }
    return Array.isArray(res) ? res : (res.rows ?? [])
  }
}

/** Median of a few SELECT 1 round trips; null if any of them fails. */
async function medianRtt(query: DoctorQuery): Promise<number | null> {
  const samples: number[] = []
  try {
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      await query('SELECT 1')
      samples.push(performance.now() - t)
    }
  } catch { return null }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? null
}

export interface DoctorCommandOptions {
  json?: boolean
}

/**
 * Loads the config, connects, collects, compares, prints. Sets process.exitCode
 * (0 clean, 1 drift, 2 unreachable) and returns; the dispatcher exits.
 */
export async function runDoctorCommand(cwd: string, opts: DoctorCommandOptions = {}): Promise<DriftReport | null> {
  const configPath = resolve(cwd, 'tangen.config.ts')
  const fail = (message: string): null => {
    if (opts.json) console.log(JSON.stringify({ version: 1, ok: false, exitCode: 2, error: message }, null, 2))
    else console.error(`  ${sym.cross}  ${c.red(message)}`)
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

  const { createDb, resolvePrepare } = await import('@tangen/db')
  const { sql } = await import('drizzle-orm')
  const db = createDb(database.url)
  const query = queryOver(db, (text) => sql.raw(text))
  try {
    await query('SELECT 1')
  } catch (e) {
    return fail(`Could not connect to ${describeDbTarget(database.url)}: ${e instanceof Error ? e.message : String(e)}`)
  }

  // The connection is open and warm, so the round trip is free to measure -
  // and it is the number that makes the preparation setting legible.
  const connection: ConnectionDiagnostics = { ...resolvePrepare(), rttMs: await medianRtt(query) }

  const generatedFile = resolveApiGeneratedFile(cwd)
  const generated = generatedFile ? { ...generatedFile, code: readFileSync(generatedFile.path, 'utf8') } : null
  const customTables = await gatherCustomTables(cwd, config.customTables) as CollectOptions['customTables']

  let collected: Awaited<ReturnType<typeof collectDoctorInputs>>
  try {
    collected = await collectDoctorInputs({
      query,
      // Local code means every type the workspace DECLARES, the site's own and
      // the ones its extensions provision. Reading only the site's files would
      // make doctor report every extension type as "in the registry, missing
      // from code" - exactly the wrong advice.
      manifests: await loadConfigExtensions(config as never, cwd).catch(() => []) as never,
      loadLocal: async () => mergeDeclaredTypes(
        await loadLocalSchema(configPath),
        await loadExtensionTypes(cwd, config as never),
      ).schema,
      generated,
      dbTarget: describeDbTarget(database.url),
      components: (config as { components?: unknown[] }).components,
      localizationEnabled: (config as { localization?: { enabled?: boolean } }).localization?.enabled === true,
      customTables,
      knowledgeEnabled: (config as { knowledge?: { enabled?: boolean } }).knowledge?.enabled === true,
    })
  } catch (e) {
    return fail(`Could not read the registry from ${describeDbTarget(database.url)}: ${e instanceof Error ? e.message : String(e)}`)
  }

  const report = withSystemFindings(checkSchemaDrift(collected.inputs), collected.system)
  const exitCode = doctorExitCode(report)
  if (opts.json) {
    const { sources } = collected
    console.log(JSON.stringify({
      version: 1,
      ok: report.clean,
      exitCode,
      sources: { ...sources, generated: sources.generated && { path: sources.generated.source, origin: sources.generated.origin, tables: sources.generated.tables, i18nTables: sources.generated.i18nTables } },
      connection,
      counts: report.counts,
      findings: report.findings,
    }, null, 2))
  } else {
    for (const line of renderDoctorReport(report, { ...collected.sources, connection })) console.log(line)
  }
  process.exitCode = exitCode
  return report
}
