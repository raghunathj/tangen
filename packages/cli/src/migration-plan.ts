/**
 * File Name: migration-plan.ts
 * Purpose: Renders EVERY statement a push will run against the database, at
 *          plan time, from SELECTs only: the registry heals (configs stored
 *          as JSON strings), the system-column backfill, the column heals
 *          (many-relation and scalar-jsonb casts, a registered column the
 *          table lost), the content DDL per operation
 *          (a rename carrying its side table and its indexes with it),
 *          indexes, the i18n side tables, auth profile columns and custom
 *          tables. The apply executes this list inside its
 *          one transaction, so what `--plan` shows is what `push` runs -
 *          parity by construction.
 *          The planner also pre-validates the steps that used to fail only at
 *          apply time (a NOT NULL custom column on a populated table, auth
 *          profile fields without auth_users) and reports them as errors
 *          before anything is touched.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Read-only by contract - every query here is a SELECT.
 *          DDL text comes from @tangen/db content-ddl.ts (content + i18n
 *          tables and their upgrades) and custom-table-migration.ts (custom
 *          tables); the field column mapping from column-types.ts.
 */
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { freeGuardedName, guardedName, parseGuardedName, isGuardedName } from './guarded-drops'
import {
  contentTableDdl, i18nTableDdl, pkeyColumnsQuery,
} from '@tangen/db'
import { localizedContainerFields } from '@tangen/schema'
import type { CustomTableDefinition } from '@tangen/types'
import type { ChangeOperation, RuntimeSchema } from './types'
import {
  fieldTypeToSql, isSafeIdent, safeId, castExpression, fieldIsIndexable, fieldIndexDdl, fieldIndexName,
} from './column-types'
import { buildCustomTableSQL, buildAddColumnSQL } from './custom-table-migration'
import type { NormalizedCustomTable, RecordedOwner, CustomTableOwner } from './custom-table-owner'
import { renameStatements, renameFunctionSql, RENAME_FN } from './component-migration'

/** The groups a plan is printed in, in the order the apply executes them. */
export type StatementGroup = 'registry' | 'system' | 'heal' | 'component-data' | 'content' | 'index' | 'i18n' | 'auth' | 'custom-table'

/**
 * `component-data` sits BEFORE `content` on purpose. It is the only group that
 * writes to content ROWS rather than to the schema, and it addresses tables and
 * columns by the names they have right now - the same names the read-only probe
 * used at plan time. Running it after the DDL would mean a push that also
 * renamed the type or the column addressed something that no longer existed
 * under that name. A column rename carries its data, so migrating the JSONB
 * first and renaming the column afterwards is equivalent and unambiguous.
 */
export const STATEMENT_GROUP_ORDER: readonly StatementGroup[] = [
  'registry', 'system', 'heal', 'component-data', 'content', 'index', 'i18n', 'auth', 'custom-table',
]

export const STATEMENT_GROUP_LABELS: Record<StatementGroup, string> = {
  registry: 'Registry heals',
  system: 'System columns',
  heal: 'Column heals',
  'component-data': 'Component data',
  content: 'Content tables',
  index: 'Indexes',
  i18n: 'Localization side tables',
  auth: 'Auth profile fields',
  'custom-table': 'Custom tables',
}

/** One statement the apply will execute, with the line the plan prints for it. */
export interface PlannedStatement {
  group: StatementGroup
  label: string
  sql: string
  /**
   * Who asked for this statement, when it was not the site's own schema.
   * It rides on the statement rather than in a parallel structure so it reaches
   * the human plan, `--plan --json` and the `schema_pushes` ledger without any
   * of them needing a new shape: all three already carry the statements.
   */
  owner?: { kind: 'extension'; id: string; version: string }
}

/** A decision the plan shows but the apply does not execute. */
export interface PlanNote {
  group: StatementGroup
  label: string
}

export interface MigrationPlan {
  statements: PlannedStatement[]
  notes: PlanNote[]
  /** Pre-validation failures: the apply WOULD fail at this step, so the push refuses before starting. */
  errors: string[]
}

/** Anything with drizzle's `execute` - the full client or a transaction. */
export interface SqlReader { execute: (q: any) => Promise<unknown> }

/** drizzle's execute returns an array (postgres-js) or `{ rows }` (pglite) - normalise. */
export async function queryRows<T = Record<string, unknown>>(db: SqlReader, q: unknown): Promise<T[]> {
  const res = await db.execute(q)
  if (Array.isArray(res)) return res as T[]
  return ((res as { rows?: T[] } | null)?.rows ?? []) as T[]
}

/** The minimal schema shape the identity and i18n planners read. */
export interface PlanSchemaType {
  name: string
  localized?: boolean
  fields: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }>
}

export interface MigrationPlanInput {
  workspaceId: string
  /** The content operations the apply will run (already filtered by the approval policy). */
  ops: ChangeOperation[]
  runtime: RuntimeSchema
  /** The types reconciled for identity and i18n (the local schema, scoped on `--type`). */
  schema: { types: PlanSchemaType[] }
  registry?: Array<Record<string, unknown>>
  localization?: boolean
  customTables?: Array<CustomTableDefinition | NormalizedCustomTable>
}

// ─── Read-only detection helpers ───────────────────────────────────────────────

export async function tableExists(db: SqlReader, table: string): Promise<boolean> {
  const rows = await queryRows<{ tbl: string | null }>(db, sql.raw(`SELECT to_regclass('"${safeId(table)}"')::text AS tbl`))
  return Boolean(rows[0]?.tbl)
}

async function readPkey(db: SqlReader, table: string): Promise<{ pkeyName: string; cols: string } | null> {
  const rows = await queryRows<{ pkey_name: string; cols: string }>(db, sql.raw(pkeyColumnsQuery(table)))
  const row = rows[0]
  return row ? { pkeyName: row.pkey_name, cols: row.cols } : null
}

/** Columns of one table: name -> { data_type, udt_name }. Empty when the table is absent. */
async function readColumns(db: SqlReader, table: string): Promise<Map<string, { data_type: string; udt_name: string }>> {
  const rows = await queryRows<{ column_name: string; data_type: string; udt_name: string }>(db, sql`
    SELECT column_name, data_type, udt_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}
  `)
  return new Map(rows.map((r) => [r.column_name, { data_type: r.data_type, udt_name: r.udt_name }]))
}

/** Index names on one table (pg_indexes). Empty when the table is absent. */
async function readIndexes(db: SqlReader, table: string): Promise<Set<string>> {
  const rows = await queryRows<{ indexname: string }>(db, sql`
    SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ${table}
  `)
  return new Set(rows.map((r) => r.indexname))
}

type ColumnInfo = { data_type: string; udt_name: string }
/** The column kind a live column has, in the vocabulary fieldTypeToSql speaks; null when it is none of them. */
function kindOf(info: ColumnInfo): string | null {
  switch (info.udt_name) {
    case 'text': return 'TEXT'
    case '_text': return 'TEXT[]'
    case 'numeric': return 'NUMERIC'
    case 'bool': return 'BOOLEAN'
    case 'timestamptz': return 'TIMESTAMPTZ'
    case 'jsonb': return 'JSONB'
    case 'numrange': return 'NUMRANGE'
    default: return null
  }
}

/**
 * What the database holds for each runtime type right now, read lazily with
 * SELECTs under the type's CURRENT name and cached per type id, so the content
 * phases can decide side effects (a localized side column to cast or rename,
 * an index to rename) without guessing.
 */
class PhysicalState {
  private readonly current = new Map<string, string>()
  private readonly columns = new Map<string, Map<string, ColumnInfo>>()
  private readonly sideColumns = new Map<string, Map<string, ColumnInfo>>()
  private readonly sideExists = new Map<string, boolean>()
  private readonly indexes = new Map<string, Set<string>>()

  constructor(private readonly db: SqlReader, runtime: RuntimeSchema) {
    for (const t of runtime.types) this.current.set(t.id, t.name)
  }

  /** The table name the type has NOW (before any rename in this plan); undefined for a type the registry does not have. */
  currentName(typeId: string): string | undefined {
    return this.current.get(typeId)
  }

  async columnsOf(typeId: string): Promise<Map<string, ColumnInfo>> {
    const name = this.current.get(typeId)
    if (!name || !isSafeIdent(name)) return new Map()
    if (!this.columns.has(typeId)) this.columns.set(typeId, await readColumns(this.db, name))
    return this.columns.get(typeId)!
  }

  async sideTableExists(typeId: string): Promise<boolean> {
    const name = this.current.get(typeId)
    if (!name || !isSafeIdent(name)) return false
    if (!this.sideExists.has(typeId)) this.sideExists.set(typeId, await tableExists(this.db, `${name}_i18n`))
    return this.sideExists.get(typeId)!
  }

  async sideColumnsOf(typeId: string): Promise<Map<string, ColumnInfo>> {
    const name = this.current.get(typeId)
    if (!name || !isSafeIdent(name) || !(await this.sideTableExists(typeId))) return new Map()
    if (!this.sideColumns.has(typeId)) this.sideColumns.set(typeId, await readColumns(this.db, `${name}_i18n`))
    return this.sideColumns.get(typeId)!
  }

  async indexesOf(typeId: string): Promise<Set<string>> {
    const name = this.current.get(typeId)
    if (!name || !isSafeIdent(name)) return new Set()
    if (!this.indexes.has(typeId)) this.indexes.set(typeId, await readIndexes(this.db, name))
    return this.indexes.get(typeId)!
  }
}

async function hasRows(db: SqlReader, table: string, where = ''): Promise<boolean> {
  const rows = await queryRows(db, sql.raw(`SELECT 1 AS one FROM "${safeId(table)}"${where ? ` WHERE ${where}` : ''} LIMIT 1`))
  return rows.length > 0
}

/** What one destructive operation would remove, counted. */
export interface DestructionCount {
  /** The operation this describes, by its own identity in the plan. */
  key: string
  /** Rows that would lose a value; null when the table or column is not there to count. */
  rows: number | null
  /** How the count is phrased, so the CLI does not have to know what was counted. */
  label: string
}

/** The key a destructive op is counted under. Stable across plan and preview. */
export function destructionKey(op: ChangeOperation): string {
  if (op.op === 'DROP_TYPE') return `DROP_TYPE:${op.name}`
  if (op.op === 'DROP_FIELD') return `DROP_FIELD:${op.typeName}.${op.name}`
  return op.op
}

/**
 * Count what a destructive plan would actually destroy, so the preview says
 * "1,240 rows" rather than "some data". SELECTs only, like everything else in
 * this file, and tolerant: a table that is not there yet counts as nothing to
 * lose rather than an error, because a preview must never be the thing that
 * fails a push.
 */
export async function countDestruction(
  db: SqlReader,
  ops: ChangeOperation[],
  nameOf: (typeId: string) => string,
): Promise<DestructionCount[]> {
  const out: DestructionCount[] = []
  for (const op of ops) {
    if (op.op === 'DROP_TYPE') {
      out.push({ key: destructionKey(op), rows: await countRows(db, op.name), label: `rows in "${op.name}"` })
    } else if (op.op === 'DROP_FIELD' && fieldTypeToSql(op.fieldType) !== null) {
      const table = nameOf(op.typeId)
      out.push({
        key: destructionKey(op),
        rows: await countRows(db, table, `"${safeId(op.name)}" IS NOT NULL`),
        label: `rows of "${table}" hold a value`,
      })
    }
  }
  return out
}

/** Row count, or null when the table or column cannot be counted. */
async function countRows(db: SqlReader, table: string, where = ''): Promise<number | null> {
  if (!isSafeIdent(table)) return null
  try {
    const rows = await queryRows<{ n: number }>(
      db, sql.raw(`SELECT count(*)::int AS n FROM "${safeId(table)}"${where ? ` WHERE ${where}` : ''}`),
    )
    return rows[0]?.n ?? 0
  } catch {
    return null                                   // not created yet, or no such column
  }
}





/** A SQL string literal (single quotes doubled) for the values the rename statements carry. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** `previous_names` with `name` appended once. */
function appendPreviousName(name: string): string {
  const v = literal(name)
  return `(CASE WHEN ${v} = ANY(previous_names) THEN previous_names ELSE array_append(previous_names, ${v}) END)`
}


// ─── Registry heals ────────────────────────────────────────────────────────────

/**
 * Registry rows whose jsonb config holds a JSON STRING instead of an object
 * (`"{\"many\":true}"`), written by a driver that serialized jsonb twice
 * (drizzle-orm 0.30.x with postgres-js; every such row on the dev database
 * predates the 0.45 upgrade). Drizzle readers parse them, raw-SQL readers
 * see no keys. Rewritten as objects, once, inside the push transaction;
 * only object-looking strings are touched so a stray value can never fail
 * the cast and roll the push back.
 */
export async function planRegistryHeals(db: SqlReader): Promise<PlannedStatement[]> {
  const out: PlannedStatement[] = []
  const objectLike = `~ '^\\s*\\{'`
  const fieldRows = await queryRows<{ n: number | string }>(db, sql`
    SELECT count(*)::int AS n FROM fields WHERE jsonb_typeof(config) = 'string'
  `)
  const fieldsN = Number(fieldRows[0]?.n ?? 0)
  if (fieldsN > 0) {
    out.push({
      group: 'registry',
      label: `fields: ${fieldsN} config${fieldsN === 1 ? '' : 's'} stored as JSON strings become objects`,
      sql: `UPDATE fields SET config = (config #>> '{}')::jsonb WHERE jsonb_typeof(config) = 'string' AND (config #>> '{}') ${objectLike}`,
    })
  }
  const typeRows = await queryRows<{ n: number | string }>(db, sql`
    SELECT count(*)::int AS n FROM object_types WHERE jsonb_typeof(admin_config) = 'string'
  `)
  const typesN = Number(typeRows[0]?.n ?? 0)
  if (typesN > 0) {
    out.push({
      group: 'registry',
      label: `object_types: ${typesN} admin config${typesN === 1 ? '' : 's'} stored as JSON strings become objects`,
      sql: `UPDATE object_types SET admin_config = (admin_config #>> '{}')::jsonb WHERE jsonb_typeof(admin_config) = 'string' AND (admin_config #>> '{}') ${objectLike}`,
    })
  }
  return out
}

// ─── System columns + heals ────────────────────────────────────────────────────

const SYSTEM_CONTENT_COLUMNS: Array<[string, string]> = [
  ['slug', 'TEXT'],
  ['scheduled_at', 'TIMESTAMPTZ'],
  ['scheduled_by', 'TEXT'],
  ['published_values', 'JSONB'],
  ['published_by', 'TEXT'],
  ['created_by_kind', 'TEXT'],
  ['updated_by_kind', 'TEXT'],
  ['published_by_kind', 'TEXT'],
]

/**
 * System columns every type table must carry; only the ones actually missing
 * are planned, so the plan shows real work and nothing else.
 */
export async function planSystemColumns(db: SqlReader, runtime: RuntimeSchema): Promise<PlannedStatement[]> {
  const out: PlannedStatement[] = []
  for (const type of runtime.types) {
    if (!isSafeIdent(type.name)) continue
    if (!(await tableExists(db, type.name))) continue
    const cols = await readColumns(db, type.name)
    for (const [col, sqlType] of SYSTEM_CONTENT_COLUMNS) {
      if (cols.has(col)) continue
      out.push({
        group: 'system',
        label: `${type.name}: add system column ${col}`,
        sql: `ALTER TABLE "${safeId(type.name)}" ADD COLUMN IF NOT EXISTS "${col}" ${sqlType}`,
      })
    }
  }
  return out
}

/** The many:true relation fields as the registry will be AFTER the ops apply. */
function manyRelationFields(runtime: RuntimeSchema, ops: ChangeOperation[]): Array<{ typeName: string; fieldName: string }> {
  const out: Array<{ typeName: string; fieldName: string }> = []
  const pendingMany = new Map<string, boolean>()
  for (const op of ops) {
    if (op.op === 'UPDATE_FIELD_CONFIG' && op.field.fieldType === 'relation') {
      pendingMany.set(op.fieldId, (op.field.config as { many?: boolean } | undefined)?.many === true)
    }
  }
  for (const type of runtime.types) {
    for (const f of type.fields) {
      if (f.fieldType !== 'relation') continue
      const many = pendingMany.has(f.id) ? pendingMany.get(f.id)! : (f.config as { many?: boolean } | undefined)?.many === true
      if (many) out.push({ typeName: type.name, fieldName: f.name })
    }
  }
  return out
}

/**
 * One-time heals for columns created under an older mapping: many:true
 * relations that are plain TEXT (array literals stored as text) become
 * TEXT[]; scalar-intended columns that are physically jsonb become text; a
 * column the registry records but the table lost is re-added with its mapped
 * type (fields being dropped or whose type is being dropped in this push are
 * left alone). Planned only where the physical column is missing or still
 * has the old type.
 */
export async function planColumnHeals(db: SqlReader, runtime: RuntimeSchema, ops: ChangeOperation[] = []): Promise<PlannedStatement[]> {
  const out: PlannedStatement[] = []
  const columnsByTable = new Map<string, Map<string, { data_type: string; udt_name: string }>>()
  const colsOf = async (table: string) => {
    if (!columnsByTable.has(table)) columnsByTable.set(table, await readColumns(db, table))
    return columnsByTable.get(table)!
  }
  const droppedTypes = new Set(ops.filter((o) => o.op === 'DROP_TYPE').map((o) => (o as { typeId: string }).typeId))
  const droppedFields = new Set(ops.filter((o) => o.op === 'DROP_FIELD').map((o) => (o as { fieldId: string }).fieldId))

  for (const type of runtime.types) {
    if (!isSafeIdent(type.name) || droppedTypes.has(type.id)) continue
    if (!(await tableExists(db, type.name))) continue
    const cols = await colsOf(type.name)
    for (const f of type.fields) {
      if (!isSafeIdent(f.name) || droppedFields.has(f.id) || cols.has(f.name)) continue
      const sqlType = fieldTypeToSql(f.fieldType, f.config)
      if (!sqlType) continue
      out.push({
        group: 'heal',
        label: `${type.name}.${f.name}: missing column re-added ${sqlType}`,
        sql: `ALTER TABLE "${safeId(type.name)}" ADD COLUMN IF NOT EXISTS "${safeId(f.name)}" ${sqlType}`,
      })
    }
  }

  for (const { typeName, fieldName } of manyRelationFields(runtime, ops)) {
    if (!isSafeIdent(typeName) || !isSafeIdent(fieldName)) continue
    const col = (await colsOf(typeName)).get(fieldName)
    if (col?.udt_name !== 'text') continue   // already TEXT[] (_text) or absent
    const q = `"${safeId(fieldName)}"`
    out.push({
      group: 'heal',
      label: `${typeName}.${fieldName}: many relation column TEXT to TEXT[]`,
      sql: `ALTER TABLE "${safeId(typeName)}" ALTER COLUMN ${q} TYPE TEXT[] USING (CASE WHEN ${q} IS NULL OR ${q} = '' THEN NULL WHEN ${q} LIKE '{%' THEN ${q}::text[] ELSE ARRAY[${q}] END)`,
    })
  }

  for (const type of runtime.types) {
    if (!isSafeIdent(type.name)) continue
    for (const f of type.fields) {
      if (!isSafeIdent(f.name)) continue
      if (fieldTypeToSql(f.fieldType, f.config) !== 'TEXT') continue   // only heal TEXT-intended columns
      const col = (await colsOf(type.name)).get(f.name)
      if (col?.data_type !== 'jsonb') continue
      const q = `"${safeId(f.name)}"`
      out.push({
        group: 'heal',
        label: `${type.name}.${f.name}: scalar column jsonb to text`,
        sql: `ALTER TABLE "${safeId(type.name)}" ALTER COLUMN ${q} TYPE text USING (${q} #>> '{}')`,
      })
    }
  }
  return out
}

// ─── Content operations ────────────────────────────────────────────────────────

/** typeId -> table name as it will be AFTER the RENAME_TYPE ops in the plan. */
export function resolveTypeNames(ops: ChangeOperation[], runtime: RuntimeSchema): Map<string, string> {
  const map = new Map(runtime.types.map((t) => [t.id, t.name]))
  for (const op of ops) if (op.op === 'RENAME_TYPE') map.set(op.typeId, op.to)
  return map
}

/**
 * What the content phase renames, for the planners that run after it: tables
 * by their NEW name -> the name the database has now, and side-table columns
 * that exist under a new name after the phase (`<table>_i18n.<column>`).
 */
export interface PlanRenames {
  tables: Map<string, string>
  sideColumns: Set<string>
}

export const noRenames = (): PlanRenames => ({ tables: new Map(), sideColumns: new Set() })

/** The content table DDL for a CREATE_TYPE op, the one place it is rendered. */
export function createTypeDdl(type: Extract<ChangeOperation, { op: 'CREATE_TYPE' }>['type']): string {
  const tbl = safeId(type.name)
  const fieldColsSql = type.fields
    .flatMap((f) => {
      const sqlType = fieldTypeToSql(f.fieldType, f.config as Record<string, unknown>)
      return sqlType ? [`"${safeId(f.name)}" ${sqlType}`] : []
    })
    .join(',\n    ')
  return contentTableDdl(tbl, fieldColsSql)
}

/**
 * The DDL for the content operations, in the order the apply runs its phases
 * (create, rename type, add, rename field, change type, drop field, drop type).
 * The sibling-environment decision for DROP_FIELD / DROP_TYPE is made here: a
 * column or table another environment still registers is kept, and the plan
 * says so instead of leaving the reader to guess at apply time. A rename is
 * one physical change serving every environment: it carries the <type>_i18n
 * side table or column, the type's indexes, and the registry rows of every
 * sibling environment that still registers the old name (name + previous_names),
 * so no environment is left reading a column or table that no longer exists.
 * A rename onto a table or column that already exists is an error here,
 * before anything runs.
 */
export async function planContentStatements(
  db: SqlReader,
  input: Pick<MigrationPlanInput, 'workspaceId' | 'ops' | 'runtime'>,
): Promise<{ statements: PlannedStatement[]; notes: PlanNote[]; errors: string[]; singletonIds: Map<string, string>; renames: PlanRenames }> {
  const { ops, runtime, workspaceId } = input
  const statements: PlannedStatement[] = []
  const notes: PlanNote[] = []
  const errors: string[] = []
  const singletonIds = new Map<string, string>()
  const renames = noRenames()
  const typeNames = resolveTypeNames(ops, runtime)
  const physical = new PhysicalState(db, runtime)
  const nameOf = (typeId: string): string => {
    const n = typeNames.get(typeId)
    if (!n) throw new Error(`Type ${typeId} not found in name map`)
    return n
  }
  const push = (label: string, text: string) => statements.push({ group: 'content', label, sql: text })
  // Guarded drops: one seed per plan, derived from the operations themselves,
  // so the preflight's statements and the apply's are the same list, the same
  // plan fingerprints the same way every time it is built, and a collision
  // moves to the next derivation.
  const planSeed = createHash('sha256').update(JSON.stringify(ops)).digest('hex').slice(0, 16)
  const guardedTwin = (names: Iterable<string>, original: string): string | null => {
    const twins = [...names].filter((n) => parseGuardedName(n)?.original === original)
    return twins.length === 1 ? twins[0]! : null
  }

  // Phase A: CREATE_TYPE
  for (const op of ops) {
    if (op.op !== 'CREATE_TYPE') continue
    const tbl = safeId(op.type.name)
    // Recovery: a guarded table of this name comes back with its rows, its key
    // and its indexes under their live names; CREATE ... IF NOT EXISTS then adds nothing.
    const guardedTables = await queryRows<{ table_name: string }>(db, sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE '_dropped__%'`)
    const twinTable = guardedTwin(guardedTables.map((r) => r.table_name), op.type.name)
    if (twinTable && !(await tableExists(db, tbl))) {
      const id = parseGuardedName(twinTable)!.id
      push(`${op.type.name}: recover guarded table ${twinTable}`, `ALTER TABLE "${safeId(twinTable)}" RENAME TO "${tbl}"`)
      const pk = await readPkey(db, twinTable)
      if (pk && pk.pkeyName !== `${op.type.name}_pkey`) push(`${op.type.name}: recover primary key name`, `ALTER TABLE "${tbl}" RENAME CONSTRAINT "${safeId(pk.pkeyName)}" TO "${tbl}_pkey"`)
      for (const idx of [...await readIndexes(db, twinTable)].sort()) {
        const parsed = parseGuardedName(idx)
        if (parsed && parsed.id === id && isSafeIdent(parsed.original) && idx !== pk?.pkeyName) push(`${op.type.name}: recover index ${parsed.original}`, `ALTER INDEX "${safeId(idx)}" RENAME TO "${safeId(parsed.original)}"`)
      }
      const side = guardedName(`${op.type.name}_i18n`, id)
      if (await tableExists(db, side)) push(`${op.type.name}_i18n: recover guarded side table`, `ALTER TABLE "${safeId(side)}" RENAME TO "${tbl}_i18n"`)
    }
    push(`${op.type.name}: create table`, createTypeDdl(op.type))
    if (op.type.singleton) {
      const singletonId = createId()
      singletonIds.set(op.type.name, singletonId)
      push(
        `${op.type.name}: seed the singleton row`,
        `INSERT INTO "${tbl}" (id, workspace_id, status) VALUES ('${singletonId}', '__singleton__', 'draft') ON CONFLICT DO NOTHING`,
      )
    }
  }

  // Phase B: RENAME_TYPE - the table, its side table, its indexes, the sibling registries
  for (const op of ops) {
    if (op.op !== 'RENAME_TYPE') continue
    const from = safeId(op.from)
    const to = safeId(op.to)
    if (await tableExists(db, to)) {
      errors.push(`${op.from}: cannot rename to "${op.to}" - a table "${op.to}" already exists. Drop or rename that table first, or pick another name.`)
      continue
    }
    push(`${op.from}: rename table to ${op.to}`, `ALTER TABLE "${from}" RENAME TO "${to}"`)
    renames.tables.set(op.to, op.from)
    if (await physical.sideTableExists(op.typeId)) {
      push(`${op.from}_i18n: rename side table to ${op.to}_i18n`, `ALTER TABLE "${from}_i18n" RENAME TO "${to}_i18n"`)
      renames.tables.set(`${op.to}_i18n`, `${op.from}_i18n`)
    }
    for (const idx of [...await physical.indexesOf(op.typeId)].sort()) {
      if (!idx.startsWith(`${op.from}_`) || !idx.endsWith('_idx') || !isSafeIdent(idx)) continue
      const renamed = `${op.to}_${idx.slice(op.from.length + 1)}`
      push(`${op.from}: rename index ${idx} to ${renamed}`, `ALTER INDEX "${idx}" RENAME TO "${safeId(renamed)}"`)
    }
  }

  // Phase C: ADD_FIELD
  for (const op of ops) {
    if (op.op !== 'ADD_FIELD') continue
    const sqlType = fieldTypeToSql(op.field.fieldType, op.field.config as Record<string, unknown>)
    if (!sqlType) continue
    const typeName = nameOf(op.typeId)
    // Recovery: exactly one guarded twin of this column, of the same kind,
    // comes back under its live name with its values; otherwise a fresh column.
    const cols = await physical.columnsOf(op.typeId)
    // One table serves every environment on this binding: a column another
    // environment already registers with a different kind cannot become this
    // kind here. ADD COLUMN IF NOT EXISTS would silently keep the old kind and
    // the runtime union would refuse to serve both (content-tables-runtime).
    const existing = cols.get(op.field.name)
    if (existing && kindOf(existing) !== sqlType) {
      {
        errors.push(`${typeName}.${op.field.name}: declared as ${sqlType}, but the column is ${kindOf(existing) ?? existing.udt_name}; change the field type (docs/fields.md, Changing a field's type) rather than re-adding it`)
        continue
      }
    }
    const twin = cols.has(op.field.name) ? null : guardedTwin(cols.keys(), op.field.name)
    const twinKind = twin ? cols.get(twin) : undefined
    if (twin && twinKind && kindOf(twinKind) === sqlType) {
      push(`${typeName}.${op.field.name}: recover guarded column ${twin}`, `ALTER TABLE "${safeId(typeName)}" RENAME COLUMN "${safeId(twin)}" TO "${safeId(op.field.name)}"`)
      const sideCols = await physical.sideColumnsOf(op.typeId)
      if (sideCols.has(twin)) push(`${typeName}_i18n.${op.field.name}: recover guarded localized column`, `ALTER TABLE "${safeId(typeName)}_i18n" RENAME COLUMN "${safeId(twin)}" TO "${safeId(op.field.name)}"`)
      continue
    }
    push(`${typeName}.${op.field.name}: add column ${sqlType}`, `ALTER TABLE "${safeId(typeName)}" ADD COLUMN IF NOT EXISTS "${safeId(op.field.name)}" ${sqlType}`)
  }

  // Phase D: RENAME_FIELD - the column, its side column, its index, the sibling registries
  for (const op of ops) {
    if (op.op !== 'RENAME_FIELD') continue
    const typeName = nameOf(op.typeId)
    const currentType = physical.currentName(op.typeId) ?? typeName
    const from = safeId(op.from)
    const to = safeId(op.to)
    const cols = await physical.columnsOf(op.typeId)
    if (cols.has(op.to)) {
      errors.push(`${typeName}.${op.from}: cannot rename to "${op.to}" - the "${currentType}" table already has a column "${op.to}". Drop that column first (if no environment needs it), or pick another name.`)
      continue
    }
    push(`${typeName}.${op.from}: rename column to ${op.to}`, `ALTER TABLE "${safeId(typeName)}" RENAME COLUMN "${from}" TO "${to}"`)
    if ((await physical.sideColumnsOf(op.typeId)).has(op.from)) {
      push(`${typeName}_i18n.${op.from}: rename localized column to ${op.to}`, `ALTER TABLE "${safeId(typeName)}_i18n" RENAME COLUMN "${from}" TO "${to}"`)
      renames.sideColumns.add(`${typeName}_i18n.${op.to}`)
    }
    if ((await physical.indexesOf(op.typeId)).has(fieldIndexName(currentType, op.from))) {
      // after phase B the index already carries the new type name
      const now = fieldIndexName(typeName, op.from)
      const next = fieldIndexName(typeName, op.to)
      push(`${typeName}.${op.from}: rename index ${now} to ${next}`, `ALTER INDEX "${safeId(now)}" RENAME TO "${safeId(next)}"`)
    }
  }

  // Phase E2: CHANGE_FIELD_TYPE - tier 2 casts the column, and the localized
  // side column when the side table has one (the same USING expression, so
  // COALESCE(side, main) keeps working in every locale); tier 1 is registry
  // only; tier 3 never reaches apply.
  for (const op of ops) {
    if (op.op !== 'CHANGE_FIELD_TYPE' || op.tier !== 2) continue
    const fromSql = op.fromSql !== undefined ? op.fromSql : fieldTypeToSql(op.from)
    const toSql = op.toSql !== undefined ? op.toSql : fieldTypeToSql(op.to)
    if (!toSql || fromSql === toSql) continue
    const typeName = nameOf(op.typeId)
    const col = safeId(op.fieldName)
    const using = castExpression(op.fieldName, fromSql, toSql)
    push(`${typeName}.${op.fieldName}: cast column ${fromSql ?? 'none'} to ${toSql}`, `ALTER TABLE "${safeId(typeName)}" ALTER COLUMN "${col}" TYPE ${toSql} USING ${using}`)
    if ((await physical.sideColumnsOf(op.typeId)).has(op.fieldName)) {
      const side = `${typeName}_i18n`
      push(`${side}.${op.fieldName}: cast localized column ${fromSql ?? 'none'} to ${toSql}`, `ALTER TABLE "${safeId(side)}" ALTER COLUMN "${col}" TYPE ${toSql} USING ${using}`)
    }
  }

  // Phase F: DROP_FIELD
  for (const op of ops) {
    if (op.op !== 'DROP_FIELD') continue
    if (fieldTypeToSql(op.fieldType) === null) continue   // group: no column
    const typeName = nameOf(op.typeId)
    // Guarded: rename aside, drop the field's own index (a fresh field of this
    // name must be able to declare it again), and rename the localized side
    // column with it. Nothing is erased; `tangen purge guarded` is the eraser.
    const cols = await physical.columnsOf(op.typeId)
    const guarded = freeGuardedName(cols.keys(), op.name, `${planSeed}:${typeName}.${op.name}`)
    push(`${typeName}.${op.name}: guard column as ${guarded} (values kept; purge to delete)`, `ALTER TABLE "${safeId(typeName)}" RENAME COLUMN "${safeId(op.name)}" TO "${guarded}"`)
    if ((await physical.indexesOf(op.typeId)).has(`${typeName}_${op.name}_idx`)) {
      push(`${typeName}.${op.name}: drop the guarded column's index`, `DROP INDEX IF EXISTS "${safeId(`${typeName}_${op.name}_idx`)}"`)
    }
    if ((await physical.sideColumnsOf(op.typeId)).has(op.name)) {
      push(`${typeName}_i18n.${op.name}: guard localized column as ${guarded}`, `ALTER TABLE "${safeId(typeName)}_i18n" RENAME COLUMN "${safeId(op.name)}" TO "${guarded}"`)
    }
  }

  // Phase G: DROP_TYPE
  for (const op of ops) {
    if (op.op !== 'DROP_TYPE') continue
    // Guarded: the table, its primary-key constraint, its indexes and its side
    // table move under `_dropped__` names so a fresh type of this name can be
    // created and a re-declaration can bring this one back with its rows.
    if (!(await tableExists(db, safeId(op.name)))) continue
    const guardedTables = await queryRows<{ table_name: string }>(db, sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE '_dropped__%'`)
    const guarded = freeGuardedName(guardedTables.map((r) => r.table_name), op.name, `${planSeed}:${op.name}`)
    const id = parseGuardedName(guarded)!.id
    push(`${op.name}: guard table as ${guarded} (rows kept; purge to delete)`, `ALTER TABLE "${safeId(op.name)}" RENAME TO "${guarded}"`)
    const pk = await readPkey(db, safeId(op.name))
    if (pk) push(`${op.name}: guard primary key name`, `ALTER TABLE "${guarded}" RENAME CONSTRAINT "${safeId(pk.pkeyName)}" TO "${guardedName(pk.pkeyName, id)}"`)
    for (const idx of [...await readIndexes(db, safeId(op.name))].sort()) {
      // The primary key's index follows its constraint's rename above.
      if (!isSafeIdent(idx) || isGuardedName(idx) || idx === pk?.pkeyName) continue
      push(`${op.name}: guard index ${idx}`, `ALTER INDEX "${idx}" RENAME TO "${guardedName(idx, id)}"`)
    }
    if (await tableExists(db, `${safeId(op.name)}_i18n`)) {
      push(`${op.name}_i18n: guard side table`, `ALTER TABLE "${safeId(op.name)}_i18n" RENAME TO "${guardedName(`${op.name}_i18n`, id)}"`)
    }
  }

  return { statements, notes, errors, singletonIds, renames }
}

// ─── Indexes ───────────────────────────────────────────────────────────────────

/**
 * The scope index + field indexes for new types, and CREATE_INDEX / DROP_INDEX
 * on existing ones. Eligibility and the method (GIN on array columns) come
 * from the column kind (column-types.ts), the same rule codegen declares by.
 */
/**
 * The slug's uniqueness, enforced by the database.
 *
 * A slug is resolved per content type within an environment - GET by-slug
 * and the local client both look up (workspace, env, slug) with no status
 * filter and take one row - so that is the namespace in which two slugs
 * collide, so
 * the same slug in two environments is fine. Partial on NOT NULL because a
 * slug is optional. Archived rows keep their slug, as the API's preflight
 * always treated them. Before this the preflight SELECT was the only guard,
 * and eight concurrent creates with one slug produced eight rows.
 */
export function slugUniqueDdl(typeName: string): string {
  const tbl = safeId(typeName)
  return `CREATE UNIQUE INDEX IF NOT EXISTS "${tbl}_slug_uniq" ON "${tbl}" (slug) WHERE slug IS NOT NULL`
}

/**
 * Heal the slug uniqueness index on existing tables, refusing where it cannot
 * be created. A table that already holds duplicate slugs in one environment
 * would fail the CREATE UNIQUE INDEX, so the plan reports the duplicate groups
 * as a pre-validation error and the push stops before starting - nothing is
 * renamed or deleted on the site's behalf.
 */
export async function planSlugUniqueness(db: SqlReader, runtime: RuntimeSchema, ops: ChangeOperation[] = []): Promise<{ statements: PlannedStatement[]; errors: string[] }> {
  const statements: PlannedStatement[] = []
  const errors: string[] = []
  const skipTypes = new Set<string>()
  for (const op of ops) {
    if (op.op === 'RENAME_TYPE' || op.op === 'DROP_TYPE') skipTypes.add(op.typeId)
    else if (op.op === 'CREATE_TYPE') skipTypes.add(op.type.id ?? op.type.name)   // planIndexes creates it with the table
  }
  for (const type of runtime.types) {
    if (!isSafeIdent(type.name) || skipTypes.has(type.id)) continue
    if (!(await tableExists(db, type.name))) continue
    const have = await readIndexes(db, type.name)
    if (have.has(`${type.name}_slug_uniq`)) continue
    const cols = await readColumns(db, type.name)
    if (!cols.has('slug')) continue
    const dupes = await queryRows<{ slug: string; n: number }>(db,
      `SELECT slug, count(*)::int AS n FROM "${safeId(type.name)}" WHERE slug IS NOT NULL GROUP BY slug HAVING count(*) > 1 ORDER BY n DESC, slug LIMIT 20`)
    if (dupes.length > 0) {
      const total = dupes.reduce((a, d) => a + Number(d.n), 0)
      errors.push(
        `"${type.name}" has ${dupes.length}${dupes.length === 20 ? '+' : ''} duplicate slug group(s) (${total}+ rows), e.g. ` +
        dupes.slice(0, 3).map((d) => `"${d.slug}" x${d.n}`).join(', ') +
        `. The slug uniqueness index cannot be created until they are resolved: give each duplicate its own slug (the API appends -1, -2 ... on create), then push again. Nothing was changed.`)
      continue
    }
    statements.push({ group: 'index', label: `${type.name}: slug uniqueness added`, sql: slugUniqueDdl(type.name) })
  }
  return { statements, errors }
}

export function planIndexes(ops: ChangeOperation[]): PlannedStatement[] {
  const out: PlannedStatement[] = []
  for (const op of ops) {
    if (op.op !== 'CREATE_TYPE') continue
    const tbl = safeId(op.type.name)
    out.push({ group: 'index', label: `${op.type.name}: scope index`, sql: `CREATE INDEX IF NOT EXISTS "${tbl}_scope_idx" ON "${tbl}" (workspace_id, status, created_at)` })
    out.push({ group: 'index', label: `${op.type.name}: slug uniqueness`, sql: slugUniqueDdl(op.type.name) })
    for (const f of op.type.fields) {
      const cfg = f.config as Record<string, unknown>
      if (cfg?.index === true && fieldIsIndexable(f.fieldType, cfg)) {
        out.push({ group: 'index', label: `${op.type.name}.${f.name}: index`, sql: fieldIndexDdl(op.type.name, f.name, f.fieldType, cfg) })
      }
    }
  }
  for (const op of ops) {
    // ADD_FIELD carries `index: true` from birth, so its index belongs to the
    // same push as its column. Without this a new indexed field got the column
    // and nothing else, and diff could never repair it: diff emits CREATE_INDEX
    // only where local and runtime DISAGREE, and the push that added the field
    // also recorded index: true in the registry. `doctor` reported the missing
    // index and a second push healed it, which is how Stage G11's clean room
    // found it (G11-1).
    if (op.op === 'ADD_FIELD' || op.op === 'CREATE_INDEX') {
      const cfg = op.field.config as Record<string, unknown>
      if (op.op === 'ADD_FIELD' && cfg?.index !== true) continue
      if (!fieldIsIndexable(op.field.fieldType, cfg)) continue
      out.push({ group: 'index', label: `${op.typeName}.${op.field.name}: index`, sql: fieldIndexDdl(op.typeName, op.field.name, op.field.fieldType, cfg) })
    } else if (op.op === 'DROP_INDEX') {
      out.push({ group: 'index', label: `${op.typeName}.${op.fieldName}: drop index`, sql: `DROP INDEX IF EXISTS "${fieldIndexName(op.typeName, op.fieldName)}"` })
    }
  }
  return out
}

/**
 * Indexes the registry promises but the database lacks: a field marked
 * `index: true` whose `<type>_<field>_idx` is missing (a type such as tags
 * that push never indexed, or an index dropped by hand), and a type table
 * without its scope index. diff never re-emits CREATE_INDEX for a field the
 * registry already marks indexed, so these are planned as heals from
 * pg_indexes. Types and fields renamed in this push are left to the next one
 * (their index names change in the content phase).
 */
export async function planIndexHeals(db: SqlReader, runtime: RuntimeSchema, ops: ChangeOperation[] = []): Promise<PlannedStatement[]> {
  const out: PlannedStatement[] = []
  const skipTypes = new Set<string>()
  const skipFields = new Set<string>()
  for (const op of ops) {
    if (op.op === 'RENAME_TYPE' || op.op === 'DROP_TYPE') skipTypes.add(op.typeId)
    if (op.op === 'RENAME_FIELD') skipFields.add(op.fieldId)
    if (op.op === 'DROP_FIELD') skipFields.add(op.fieldId)
    if (op.op === 'DROP_INDEX') skipFields.add(`${op.typeId}:${op.fieldName}`)
  }
  for (const type of runtime.types) {
    if (!isSafeIdent(type.name) || skipTypes.has(type.id)) continue
    if (!(await tableExists(db, type.name))) continue
    const have = await readIndexes(db, type.name)
    const tbl = safeId(type.name)
    if (!have.has(`${type.name}_scope_idx`)) {
      out.push({ group: 'index', label: `${type.name}: missing scope index re-created`, sql: `CREATE INDEX IF NOT EXISTS "${tbl}_scope_idx" ON "${tbl}" (workspace_id, status, created_at)` })
    }
    const cols = await readColumns(db, type.name)
    for (const f of type.fields) {
      if (!isSafeIdent(f.name) || skipFields.has(f.id) || skipFields.has(`${type.id}:${f.name}`)) continue
      const cfg = f.config as Record<string, unknown> | undefined
      if (cfg?.index !== true || !fieldIsIndexable(f.fieldType, cfg)) continue
      if (have.has(fieldIndexName(type.name, f.name))) continue
      if (!cols.has(f.name)) continue   // the column heal re-adds it first; the index follows next push
      out.push({ group: 'index', label: `${type.name}.${f.name}: missing index re-created`, sql: fieldIndexDdl(type.name, f.name, f.fieldType, cfg) })
    }
  }
  return out
}

// ─── Localization side tables ──────────────────────────────────────────────────

/**
 * One <type>_i18n per type with localized fields: created when missing,
 * upgraded to env-scoped identity when still keyed (object_id, locale), and
 * one typed column per localized field (add-only). Container fields with
 * localized sub-fields get a JSONB overlay column.
 */
export async function planI18nTables(
  db: SqlReader,
  schema: { types: PlanSchemaType[] },
  registry: Array<Record<string, unknown>> = [],
  renames: PlanRenames = noRenames(),
): Promise<{ statements: PlannedStatement[]; touched: string[] }> {
  const statements: PlannedStatement[] = []
  const touched: string[] = []
  for (const type of schema.types) {
    const localized = type.fields.filter((f) => (f.config as { localized?: boolean } | undefined)?.localized === true)
    const containers = localizedContainerFields(type.fields as never, registry as never)
    const typeOptedIn = type.localized === true
    if (localized.length === 0 && containers.length === 0 && !typeOptedIn) continue
    if (!isSafeIdent(type.name)) continue

    const tbl = safeId(`${type.name}_i18n`)
    // A side table the content phase renames is read under the name it has now.
    const physicalName = safeId(renames.tables.get(tbl) ?? tbl)
    const exists = await tableExists(db, physicalName)
    const cols = exists ? await readColumns(db, physicalName) : new Map<string, { data_type: string; udt_name: string }>()
    // A side column the content phase renames is present under its new name by the time this runs.
    const present = (name: string) => cols.has(name) || renames.sideColumns.has(`${tbl}.${name}`)
    if (!exists) {
      statements.push({ group: 'i18n', label: `${tbl}: create side table`, sql: i18nTableDdl(tbl) })
    }
    for (const f of localized) {
      const sqlType = fieldTypeToSql(f.fieldType, f.config as Record<string, unknown>)
      if (!sqlType || !isSafeIdent(f.name) || present(f.name)) continue
      statements.push({ group: 'i18n', label: `${tbl}.${f.name}: add localized column ${sqlType}`, sql: `ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS "${safeId(f.name)}" ${sqlType}` })
    }
    for (const name of containers) {
      if (!isSafeIdent(name) || present(name)) continue
      statements.push({ group: 'i18n', label: `${tbl}.${name}: add localized overlay column JSONB`, sql: `ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS "${safeId(name)}" JSONB` })
    }
    touched.push(`${type.name}_i18n`)
  }
  return { statements, touched }
}

// ─── Custom tables ─────────────────────────────────────────────────────────────

function columnHasDefault(def: { defaultNow?: boolean; defaultValue?: unknown }): boolean {
  return def.defaultNow === true || def.defaultValue !== undefined
}

/**
 * Custom tables are add-only: create when missing, add missing columns
 * otherwise. A NOT NULL column without a default cannot be added to a table
 * that has rows (Postgres refuses it), so that is an error here instead of a
 * failed push after the content DDL was committed.
 */
export async function planCustomTables(
  db: SqlReader,
  input: Array<CustomTableDefinition | NormalizedCustomTable> | undefined,
  ctx?: { workspaceId?: string },
): Promise<{ statements: PlannedStatement[]; errors: string[] }> {
  const statements: PlannedStatement[] = []
  const errors: string[] = []
  // Callers that predate ownership pass bare definitions; they are the site's.
  const normalized: NormalizedCustomTable[] = (input ?? []).map((t) =>
    ('table' in t ? t : { table: t, owner: { kind: 'site' } }) as NormalizedCustomTable)
  const claimed: NormalizedCustomTable[] = []
  /** Stamps a statement with its extension owner; site-owned ones carry nothing. */
  const own = (o: CustomTableOwner) => (o.kind === 'extension' ? { owner: { kind: 'extension' as const, id: o.id, version: o.version } } : {})
  for (const entry of normalized) {
    const { table, owner } = entry
    if (!isSafeIdent(table.name)) { errors.push(`custom table "${table.name}": not a valid table name`); continue }
    // Every column, not only the ones added to an existing table: the create
    // branch used to emit them all without ever checking a name.
    const badCols = Object.keys(table.columns).filter((n) => !isSafeIdent(n))
    if (badCols.length > 0) {
      errors.push(`custom table "${table.name}": ${badCols.map((n) => `"${n}"`).join(', ')} is not a valid column name`)
      continue
    }
    // Only a table the plan accepted gets an ownership row: a refused
    // declaration must not leave a claim behind.
    claimed.push(entry)
    if (!(await tableExists(db, table.name))) {
      statements.push({ group: 'custom-table', label: `${table.name}: create table`, sql: buildCustomTableSQL(table), ...own(owner) })
      continue
    }
    const cols = await readColumns(db, table.name)
    let populated: boolean | null = null
    for (const [colName, def] of Object.entries(table.columns)) {
      if (cols.has(colName)) continue
      if (!isSafeIdent(colName)) { errors.push(`custom table "${table.name}": "${colName}" is not a valid column name`); continue }
      if (!def.nullable && !columnHasDefault(def)) {
        if (populated === null) populated = await hasRows(db, table.name)
        if (populated) {
          errors.push(`custom table "${table.name}": column "${colName}" is NOT NULL without a default and the table already has rows - add defaultValue (or defaultNow) or set nullable: true.`)
          continue
        }
      }
      statements.push({ group: 'custom-table', label: `${table.name}.${colName}: add column`, sql: buildAddColumnSQL(table.name, colName, def), ...own(owner) })
    }
  }
  // The ownership record, written with the structures it describes so the two
  // can never disagree: if the DDL rolls back, so does the claim.
  //
  // The registry heals itself first. Drizzle migration 0035 creates this table,
  // but a database that has not run it yet must not have every push fail on a
  // bookkeeping row, and the same statement makes the plan self-contained for
  // any harness. IF NOT EXISTS, so a migrated database sees a no-op.
  if (claimed.length > 0) {
    statements.push({
      group: 'custom-table',
      label: 'custom_table_owners: ensure the ownership registry',
      sql: `CREATE TABLE IF NOT EXISTS custom_table_owners (
  table_name text PRIMARY KEY,
  owner_kind text NOT NULL,
  owner_id text,
  owner_version text,
  workspace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
    })
  }
  for (const { table, owner } of claimed) {
    statements.push({
      group: 'custom-table',
      label: `${table.name}: record owner (${owner.kind === 'extension' ? `${owner.id}@${owner.version}` : 'site'})`,
      ...own(owner),
      sql: `INSERT INTO custom_table_owners (table_name, owner_kind, owner_id, owner_version, workspace_id)
VALUES (${literal(table.name)}, ${literal(owner.kind)}, ${owner.kind === 'extension' ? literal(owner.id) : 'NULL'}, ${owner.kind === 'extension' ? literal(owner.version) : 'NULL'}, ${literal(ctx?.workspaceId ?? '')})
ON CONFLICT (table_name) DO UPDATE SET owner_kind = EXCLUDED.owner_kind, owner_id = EXCLUDED.owner_id, owner_version = EXCLUDED.owner_version, updated_at = now()`,
    })
  }
  return { statements, errors }
}

/** Reads the durable ownership registry. Empty when the table is not there yet. */
export async function readCustomTableOwners(db: SqlReader): Promise<RecordedOwner[]> {
  try {
    return await queryRows<RecordedOwner>(db, sql.raw(
      `SELECT table_name AS "tableName", owner_kind AS "ownerKind", owner_id AS "ownerId", owner_version AS "ownerVersion" FROM custom_table_owners`,
    ))
  } catch {
    return []
  }
}

// ─── The whole plan ────────────────────────────────────────────────────────────

/**
 * Every statement the push will run, grouped in execution order, plus the
 * decisions it will not execute and the pre-validation errors. SELECTs only.
 */
/**
 * The statements a COMPONENT_FIELD_RENAME runs: the shared recursive walker,
 * then per operation a transaction-time revalidation and the moves it guards.
 * The function is installed once and dropped at the end of the group, so a push
 * that migrates nothing leaves nothing behind.
 *
 * Ambiguous operations never reach here: `filterApprovedOps` removes them
 * whatever flags were passed. The guard is for the state changing AFTER the
 * plan was computed, which no filter can see.
 */
export function planComponentData(ops: ChangeOperation[]): PlannedStatement[] {
  const renames = ops.filter((o): o is Extract<ChangeOperation, { op: 'COMPONENT_FIELD_RENAME' }> => o.op === 'COMPONENT_FIELD_RENAME')
  const work = renames.flatMap((op) => renameStatements(
    { component: op.component, sources: op.sources, to: op.to },
    (op.sites ?? []).map((s) => ({ typeName: s.typeName, column: s.column, localized: !!s.sideTable, sideTable: s.sideTable })),
  ))
  if (work.length === 0) return []
  return [
    { group: 'component-data', label: 'install the component key walker', sql: renameFunctionSql },
    ...work.map((w) => ({ group: 'component-data' as const, label: w.label, sql: w.sql })),
    { group: 'component-data', label: 'drop the component key walker', sql: `DROP FUNCTION IF EXISTS ${RENAME_FN}(jsonb, text, text, text)` },
  ]
}

export async function buildMigrationPlan(
  db: SqlReader,
  input: MigrationPlanInput,
): Promise<MigrationPlan & { singletonIds: Map<string, string>; i18nTables: string[] }> {
  const statements: PlannedStatement[] = []
  const notes: PlanNote[] = []
  const errors: string[] = []

  statements.push(...await planRegistryHeals(db))
  statements.push(...await planSystemColumns(db, input.runtime))
  statements.push(...await planColumnHeals(db, input.runtime, input.ops))
  statements.push(...planComponentData(input.ops))

  const content = await planContentStatements(db, input)
  statements.push(...content.statements)
  notes.push(...content.notes)
  errors.push(...content.errors)

  statements.push(...planIndexes(input.ops))
  statements.push(...await planIndexHeals(db, input.runtime, input.ops))
  const slugs = await planSlugUniqueness(db, input.runtime, input.ops)
  statements.push(...slugs.statements)
  errors.push(...slugs.errors)

  let i18nTables: string[] = []
  if (input.localization === true) {
    const i18n = await planI18nTables(db, input.schema, input.registry ?? [], content.renames)
    statements.push(...i18n.statements)
    i18nTables = i18n.touched
  }

  const custom = await planCustomTables(db, input.customTables, { workspaceId: input.workspaceId })
  statements.push(...custom.statements)
  errors.push(...custom.errors)

  return { statements, notes, errors, singletonIds: content.singletonIds, i18nTables }
}

/** Statements bucketed by group, in execution order - for the printer and the JSON plan. */
export function groupStatements(plan: Pick<MigrationPlan, 'statements' | 'notes'>): Array<{ group: StatementGroup; label: string; statements: PlannedStatement[]; notes: PlanNote[] }> {
  return STATEMENT_GROUP_ORDER
    .map((group) => ({
      group,
      label: STATEMENT_GROUP_LABELS[group],
      statements: plan.statements.filter((s) => s.group === group),
      notes: plan.notes.filter((n) => n.group === group),
    }))
    .filter((g) => g.statements.length > 0 || g.notes.length > 0)
}
