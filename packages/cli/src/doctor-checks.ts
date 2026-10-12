/**
 * File Name: doctor-checks.ts
 * Purpose: The pure half of `tangen doctor`: reads the generated
 *          content-tables.ts, the registry rows and the information_schema /
 *          pg_indexes / pg_constraint rows into the snapshots the shared drift
 *          comparison (@tangen/schema checkSchemaDrift) consumes, summarises a
 *          change plan, and renders the report in the push style.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No database and no file system in here - the command
 *          (commands/doctor.ts) does the IO and hands rows and file contents
 *          in, so every shape is testable with fixtures. The SQL the command
 *          runs is exported from here too, so the PGlite test runs the exact
 *          statements against a real Postgres.
 */
import { basename, dirname, join } from 'node:path'
import { preparedStatementsSummary, type ConnectionDiagnostics } from './doctor-connection'
import { existsSync } from 'node:fs'
import {
  udtToSqlKind,
  type DriftColumnKind as ColumnKind,
  type DbSnapshot,
  type DbTable,
  type DriftReport,
  type DriftFinding,
  type GeneratedSnapshot,
  type GeneratedTable,
  type LocalDelta,
  type RegistrySnapshot, type GeneratedArtifactMeta } from '@tangen/schema'
import type { ChangePlan } from './types'
import type { RuntimeSchema } from './types'
import { c, sym } from './ui'
import { findDbPackageRoot } from './commands/push'

// ── Generated file ────────────────────────────────────────────────────────────

/** Kinds of the columns `systemCols()` spreads into every content table (codegen.ts). */
const SYSTEM_COLUMN_KINDS: Record<string, ColumnKind> = {
  id: 'TEXT', workspace_id: 'TEXT', title: 'TEXT', slug: 'TEXT', status: 'TEXT',
  published_at: 'TIMESTAMPTZ', published_by: 'TEXT', published_values: 'JSONB', scheduled_at: 'TIMESTAMPTZ', scheduled_by: 'TEXT',
  created_at: 'TIMESTAMPTZ', updated_at: 'TIMESTAMPTZ', created_by: 'TEXT', updated_by: 'TEXT',
  created_by_kind: 'TEXT', updated_by_kind: 'TEXT', published_by_kind: 'TEXT',
}

/** `text('col').array()` -> ['col', 'TEXT[]'], `numeric('col')` -> ['col', 'NUMERIC'], ... */
function parseColumnCall(call: string): [string, ColumnKind] | null {
  const m = /^(text|numeric|boolean|timestamp|jsonb)\('([^']+)'/.exec(call.trim())
  if (!m) return null
  const name = m[2]
  const isArray = /\)\s*\.array\(\)/.test(call)
  switch (m[1]) {
    case 'text': return [name, isArray ? 'TEXT[]' : 'TEXT']
    case 'numeric': return [name, 'NUMERIC']
    case 'boolean': return [name, 'BOOLEAN']
    case 'timestamp': return [name, 'TIMESTAMPTZ']
    case 'jsonb': return [name, 'JSONB']
    default: return null
  }
}

/**
 * Reads a generated content-tables.ts (the exact shape codegen.ts emits) into
 * a snapshot: one entry per pgTable with the DATABASE column names and kinds.
 * Parsing the source rather than importing it means a file that no longer
 * compiles (the thing doctor is looking for) is still readable.
 */
/**
 * The provenance a stamped artifact carries (Phase 6B, Unit 3); null for one
 * generated before stamping existed, which the checks treat as "unknown".
 */
export function parseArtifactMeta(code: string): GeneratedArtifactMeta | null {
  const m = /export const contentTablesMeta = (\{[\s\S]*?\n\}) as const/.exec(code)
  if (!m) return null
  try { return JSON.parse(m[1]!) as GeneratedArtifactMeta } catch { return null }
}

export function parseGeneratedSource(code: string, source: string): GeneratedSnapshot {
  const tables: Record<string, GeneratedTable> = {}
  const i18nTables: Record<string, GeneratedTable> = {}
  const re = /export const (\w+) = pgTable\('([^']+)', \{\n([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const tableName = m[2]
    const columns: Record<string, ColumnKind> = {}
    for (const line of m[3].split('\n')) {
      if (/^\s*\.\.\.systemCols\(\)/.test(line)) {
        Object.assign(columns, SYSTEM_COLUMN_KINDS)
        continue
      }
      const prop = /^\s*(\w+):\s*(.+?),?\s*$/.exec(line)
      if (!prop) continue
      const parsed = parseColumnCall(prop[2])
      if (parsed) columns[parsed[0]] = parsed[1]
    }
    if (tableName.endsWith('_i18n')) i18nTables[tableName] = { columns }
    else tables[tableName] = { columns }
  }
  return { meta: parseArtifactMeta(code), source, tables, i18nTables }
}

/**
 * The generated content-tables.ts of the project (codegen and types; the
 * server builds its runtime tables from the registry, not from this file):
 * `<project>/app/generated/content-tables.ts` first, then the db package's
 * bundled file. The project root is TANGEN_WORKSPACE_DIR when set (what
 * `tangen dev` exports), else the directory above `app/`.
 */
export function resolveApiGeneratedFile(
  cwd: string,
  exists: (p: string) => boolean = existsSync,
  findDbRoot: (dir: string) => string | null = findDbPackageRoot,
  workspaceDir: string | undefined = process.env.TANGEN_WORKSPACE_DIR,
): { path: string; origin: 'project' | 'bundled' } | null {
  const root = workspaceDir ?? (basename(cwd) === 'app' ? dirname(cwd) : cwd)
  const project = join(root, 'app', 'generated', 'content-tables.ts')
  if (exists(project)) return { path: project, origin: 'project' }
  const dbRoot = findDbRoot(cwd)
  if (dbRoot) {
    const bundled = join(dbRoot, 'src', 'generated', 'content-tables.ts')
    if (exists(bundled)) return { path: bundled, origin: 'bundled' }
  }
  return null
}

// ── Registry rows ─────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/**
 * A jsonb value read through raw SQL. Drizzle's jsonb reader JSON-parses a
 * string value, so a config stored as `"{\"many\":true}"` looks like an object to
 * the API; doctor reads the same rows raw, parses the same way, and remembers
 * which rows were encoded (push's raw-SQL passes do NOT parse them).
 */
function asObject(v: unknown): { value: Record<string, unknown>; encoded: boolean } {
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { value: parsed as Record<string, unknown>, encoded: true }
    } catch { /* not JSON: an empty config */ }
    return { value: {}, encoded: true }
  }
  return { value: v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}, encoded: false }
}

/**
 * object_types + fields rows (raw, snake_case, any registry generation) into
 * the drift snapshot and the RuntimeSchema `diff` compares local code against.
 */
export function registryFromRows(typeRows: Row[], fieldRows: Row[]): { snapshot: RegistrySnapshot; runtime: RuntimeSchema } {
  const encodedFields: string[] = []
  const encodedTypes: string[] = []
  const runtime: RuntimeSchema = {
    types: typeRows.map((t) => {
      const admin = asObject(t.admin_config)
      if (admin.encoded) encodedTypes.push(String(t.name))
      return {
        id: String(t.id),
        name: String(t.name),
        label: String(t.label ?? t.name),
        plural: (t.plural as string | null | undefined) ?? null,
        singleton: t.singleton === true,
        disabled: t.disabled === true,
        localized: t.localized === true,
        previousNames: asArray(t.previous_names),
        // Absent on a registry that predates the column - which reads as "the
        // site owns it", the behaviour every environment had before.
        providedBy: (t.provided_by as string | null | undefined) ?? null,
        adminConfig: admin.value,
        fields: fieldRows
          .filter((f) => f.type_id === t.id)
          .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
          .map((f) => {
            const config = asObject(f.config)
            if (config.encoded) encodedFields.push(`${t.name}.${f.name}`)
            return {
              id: String(f.id),
              name: String(f.name),
              label: String(f.label ?? f.name),
              fieldType: String(f.field_type),
              config: config.value,
              previousNames: asArray(f.previous_names),
              required: f.required === true,
              disabled: f.disabled === true,
            }
          }),
      }
    }),
  }
  const snapshot: RegistrySnapshot = { types: runtime.types.map((t) => ({
      name: t.name,
      localized: t.localized === true,
      previousNames: t.previousNames,
      fields: t.fields.map((f) => ({ name: f.name, fieldType: f.fieldType, config: f.config })),
    })),
    ...(encodedFields.length || encodedTypes.length ? { encodedConfigs: { fields: encodedFields, types: encodedTypes } } : {}),
  }
  return { snapshot, runtime }
}

// ── Database rows ─────────────────────────────────────────────────────────────

/** The read-only statements doctor runs; exported so the PGlite test runs the real ones. */
export const DOCTOR_SQL = {
  objectTypes: `SELECT * FROM object_types ORDER BY created_at, name`,
  fields: `SELECT * FROM fields ORDER BY type_id, position`,
  columns: `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`,
  indexes: `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = current_schema()`,
  pkeys: `SELECT cl.relname AS table_name,
       string_agg(a.attname, ', ' ORDER BY array_position(c.conkey, a.attnum)) AS cols
     FROM pg_constraint c
     JOIN pg_class cl ON cl.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'p' AND n.nspname = current_schema()
     GROUP BY cl.relname`,
} as const

/** information_schema.columns + pg_indexes + pg_constraint rows into the database snapshot. */
export function dbSnapshotFromRows(columnRows: Row[], indexRows: Row[], pkeyRows: Row[]): DbSnapshot {
  const tables: Record<string, DbTable> = {}
  for (const r of columnRows) {
    const table = String(r.table_name)
    const entry = (tables[table] ??= { columns: {}, indexes: [], pkey: null })
    entry.columns[String(r.column_name)] = udtToSqlKind(String(r.udt_name))
  }
  for (const r of indexRows) {
    const entry = tables[String(r.tablename)]
    if (entry) entry.indexes!.push(String(r.indexname))
  }
  for (const r of pkeyRows) {
    const entry = tables[String(r.table_name)]
    if (entry) entry.pkey = String(r.cols)
  }
  return { tables }
}

// ── Local plan ────────────────────────────────────────────────────────────────

const ADD_OPS = new Set(['CREATE_TYPE', 'CREATE_SINGLETON_OBJECT', 'ADD_FIELD', 'CREATE_INDEX'])
const REMOVE_OPS = new Set(['DROP_TYPE', 'DROP_FIELD', 'DROP_INDEX'])

/** Reduces a diff plan to the counts doctor reports (diff itself shows the operations). */
export function summarizePlan(plan: ChangePlan): LocalDelta {
  let adds = 0, removes = 0, changes = 0
  for (const op of plan.operations) {
    if (op.op === 'CREATE_SINGLETON_OBJECT') continue
    if (ADD_OPS.has(op.op)) adds++
    else if (REMOVE_OPS.has(op.op)) removes++
    else changes++
  }
  return { adds, removes, changes, total: adds + removes + changes }
}

// ── Report ────────────────────────────────────────────────────────────────────

export interface DoctorSources {
  local: { types: number } | { error: string }
  registry: { types: number; fields: number }
  generated: { source: string; origin: 'project' | 'bundled'; tables: number; i18nTables: number } | null
  db: { target: string; tables: number }
  /** How the connection executes statements, and what a round trip costs. */
  connection?: ConnectionDiagnostics
}

const SEVERITY_ORDER: Record<DriftFinding['severity'], number> = { error: 0, warn: 1, info: 2 }

function glyph(severity: DriftFinding['severity']): string {
  return severity === 'error' ? sym.cross : severity === 'warn' ? sym.warn : sym.bullet
}

function plural(n: number, word: string, words = `${word}s`): string {
  return `${n} ${n === 1 ? word : words}`
}

/** The terminal report, push-style: sources, then findings (errors first), then a verdict line. */
export function renderDoctorReport(report: DriftReport, sources: DoctorSources): string[] {
  const lines: string[] = []
  const src = (label: string, value: string) => lines.push(`  ${sym.bullet}  ${c.dim(label.padEnd(16))} ${value}`)
  if ('error' in sources.local) src('local code', `${c.red('failed to load')} ${c.dim(sources.local.error.split('\n')[0])}`)
  else src('local code', `${plural(sources.local.types, 'type')}`)
  src('registry', `${plural(sources.registry.types, 'type')}, ${plural(sources.registry.fields, 'field')}`)
  if (sources.generated) {
    src('generated file', `${sources.generated.source} ${c.dim(`(${sources.generated.origin})`)}  ${plural(sources.generated.tables, 'table')}, ${plural(sources.generated.i18nTables, 'side table')}`)
  } else {
    src('generated file', c.red('none found - the generated types are missing; tangen push writes them'))
  }
  src('database', `${sources.db.target}  ${plural(sources.db.tables, 'table')}`)
  if (sources.connection) {
    const { value, advice } = preparedStatementsSummary(sources.connection)
    src('prepared stmts', sources.connection.prepare ? value : c.yellow(value))
    if (advice) lines.push(`     ${sym.arrow} ${c.cyan(advice)}`)
  }
  lines.push('')

  const sorted = [...report.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  for (const f of sorted) {
    const subject = f.severity === 'info' ? c.dim(f.subject) : c.bold(f.subject)
    lines.push(`  ${glyph(f.severity)}  ${subject}  ${f.severity === 'info' ? c.dim(f.cause) : f.cause}`)
    lines.push(`     ${sym.arrow} ${c.cyan(f.fix)}`)
  }
  if (sorted.length > 0) lines.push('')

  if (report.clean) {
    const note = report.counts.info > 0 ? c.dim(` (${plural(report.counts.info, 'note')})`) : ''
    lines.push(`  ${sym.tick}  ${c.bold('No drift')} - local code, the registry, content-tables.ts and the database agree${note}`)
  } else {
    const parts = [plural(report.counts.error, 'error'), plural(report.counts.warn, 'warning'), plural(report.counts.info, 'note')]
    lines.push(`  ${sym.cross}  ${c.bold(parts.join(', '))} - the schema has drifted; the fixes are listed above`)
  }
  lines.push('')
  return lines
}

/** 0 clean, 1 drift (errors or warnings). Connection failures are 2 and decided by the command. */
export function doctorExitCode(report: DriftReport): 0 | 1 {
  return report.clean ? 0 : 1
}
