/**
 * File Name: schema-drift.ts
 * Purpose: The in-process subset of `tangen doctor` for /api/v1/types/health:
 *          the registry (the request's schema) against the Drizzle tables the
 *          API actually loaded and a cheap information_schema read, through
 *          the same checkSchemaDrift the CLI uses. So the admin's schema page
 *          can say "content-tables.ts is behind the registry - run tangen
 *          schema regenerate" instead of letting editors find the field that
 *          never saves.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Memoised per schema fingerprint with a short
 *          TTL - the health route is polled by the admin, the checks are
 *          pure, and one information_schema query per fingerprint is the
 *          whole cost. Indexes, primary keys, local code and custom tables
 *          are the CLI's job (they need pg_* catalogs and the file system).
 */
import { getTableColumns } from 'drizzle-orm'
import type { SchemaDefinition } from '@tangen/types'
import {
  checkSchemaDrift, udtToSqlKind,
  type DriftColumnKind as ColumnKind, type DbSnapshot, type DriftReport, type GeneratedSnapshot, type GeneratedTable, type RegistrySnapshot,
} from '@tangen/schema'

type TableMap = Record<string, unknown>

/** drizzle columnType -> the SQL family push creates. */
function drizzleKind(col: { columnType?: string; baseColumn?: { columnType?: string } }): ColumnKind {
  switch (col.columnType) {
    case 'PgText': case 'PgVarchar': return 'TEXT'
    case 'PgArray': return col.baseColumn?.columnType === 'PgText' || col.baseColumn?.columnType === 'PgVarchar' ? 'TEXT[]' : 'OTHER'
    case 'PgNumeric': case 'PgInteger': case 'PgBigInt53': return 'NUMERIC'
    case 'PgBoolean': return 'BOOLEAN'
    case 'PgTimestamp': return 'TIMESTAMPTZ'
    case 'PgJsonb': case 'PgJson': return 'JSONB'
    default: return 'OTHER'
  }
}

function snapshotTable(table: unknown): GeneratedTable | null {
  try {
    const cols = getTableColumns(table as never) as Record<string, { name: string; columnType?: string; baseColumn?: { columnType?: string } }>
    const columns: Record<string, ColumnKind> = {}
    for (const col of Object.values(cols)) columns[col.name] = drizzleKind(col)
    return { columns }
  } catch {
    return null
  }
}

/** The loaded Drizzle registries as the snapshot the drift check reads (database column names and kinds). */
export function generatedSnapshotFromTables(contentTables: TableMap, contentI18nTables: TableMap, source = 'content-tables.ts'): GeneratedSnapshot {
  const tables: Record<string, GeneratedTable> = {}
  const i18nTables: Record<string, GeneratedTable> = {}
  for (const [name, table] of Object.entries(contentTables)) {
    const snap = snapshotTable(table)
    if (snap) tables[name] = snap
  }
  for (const [name, table] of Object.entries(contentI18nTables)) {
    const snap = snapshotTable(table)
    if (snap) i18nTables[`${name}_i18n`] = snap
  }
  return { source, tables, i18nTables }
}

/** The request schema (built from the registry rows) as the registry snapshot. */
export function registrySnapshotFromSchema(schema: SchemaDefinition): RegistrySnapshot {
  return {
    types: schema.types.map((t) => ({
      name: t.name,
      localized: (t as { localized?: boolean }).localized === true,
      previousNames: t.previousName ?? [],
      fields: t.fields.map((f) => ({ name: f.name, fieldType: f.fieldType, config: f.config })),
    })),
  }
}

/** A cheap, stable hash of what the checks read from the schema - the memo key. */
export function schemaFingerprint(schema: SchemaDefinition): string {
  const text = JSON.stringify(schema.types.map((t) => [
    t.name,
    (t as { localized?: boolean }).localized === true,
    t.fields.map((f) => [f.name, f.fieldType, f.config ?? {}]),
  ]))
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return `${h.toString(16)}:${text.length}`
}

/** `SELECT ... FROM information_schema.columns` for the named tables: one round trip, parameterised. */
export const HEALTH_COLUMNS_SQL = `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1)`

export interface HealthDriftParams {
  schema: SchemaDefinition
  contentTables: TableMap
  contentI18nTables: TableMap
  /** Runs HEALTH_COLUMNS_SQL with the table names; null when the database cannot be asked (checks skip the database). */
  queryColumns: ((tables: string[]) => Promise<Array<Record<string, unknown>>>) | null
  localizationEnabled?: boolean
  components?: unknown[]
}

const MEMO_TTL_MS = 60_000
const MEMO_MAX = 32
const memo = new Map<string, { at: number; report: DriftReport }>()

/** Test hook: forget every memoised report. */
export function __resetHealthDriftMemo(): void { memo.clear() }

/** Registry vs loaded tables vs information_schema, memoised per schema fingerprint. */
export async function computeHealthDrift(params: HealthDriftParams): Promise<DriftReport> {
  const key = schemaFingerprint(params.schema)
  const hit = memo.get(key)
  const now = Date.now()
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.report

  const registry = registrySnapshotFromSchema(params.schema)
  const generated = generatedSnapshotFromTables(params.contentTables, params.contentI18nTables)

  let db: DbSnapshot | null = null
  if (params.queryColumns) {
    // A safe SQL identifier - the value is parameterised, so this only keeps a
    // stray name out of the read. Content type names are camelCase (blogPost),
    // so uppercase must pass, or their tables look missing (false DB_MISSING_TABLE).
    const names = params.schema.types.flatMap((t) => (/^[A-Za-z0-9_]+$/.test(t.name) ? [t.name, `${t.name}_i18n`] : []))
    try {
      const rows = names.length > 0 ? await params.queryColumns(names) : []
      const tables: DbSnapshot['tables'] = {}
      for (const r of rows) {
        const table = String(r.table_name)
        ;(tables[table] ??= { columns: {} }).columns[String(r.column_name)] = udtToSqlKind(String(r.udt_name))
      }
      db = { tables }
    } catch {
      db = null // uncertain - compare registry and file only, never cry wolf
    }
  }

  const report = checkSchemaDrift({
    registry,
    generated,
    db,
    components: (params.components ?? []) as never,
    localizationEnabled: params.localizationEnabled === true,
  })

  if (memo.size >= MEMO_MAX) {
    const oldest = [...memo.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) memo.delete(oldest[0])
  }
  memo.set(key, { at: now, report })
  return report
}

/** The type a finding belongs to: `post.body` / `post_i18n.body` / `post` -> `post`; file-level findings -> null. */
export function findingOwner(subject: string, typeNames: Set<string>): string | null {
  const head = subject.split('.')[0]
  if (typeNames.has(head)) return head
  const base = head.replace(/_i18n$/, '')
  return typeNames.has(base) ? base : null
}
