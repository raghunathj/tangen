/**
 * File Name: schema-drift.ts
 * Purpose: The comparison behind `tangen doctor` and the API's /types/health
 *          drift field. Four sources describe one content schema - local code,
 *          the registry (object_types / fields rows), the
 *          generated content-tables.ts the API loads, and the live database -
 *          and a push that stops halfway, a scoped push from another
 *          environment, or a `git pull` can leave any two of them disagreeing.
 *          Each disagreement has a known symptom (the API silently drops a
 *          write, every read 500s with 42703, translations cannot be saved)
 *          and a known fix, and this module names both.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure - snapshots in, findings out, no database. The
 *          callers collect the snapshots (the CLI from the file system and
 *          information_schema, the API from the in-process Drizzle registry)
 *          and render the findings. `expectedSqlKind` mirrors the CLI's
 *          fieldTypeToSql; a CLI test pins the two tables to each other.
 */
import { flattenFields, type ComponentDef } from '@tangen/types'
import { localizedContainerFields } from './component-relations'

/** The SQL column families push creates; `OTHER` is anything else found in the database. */
export type SqlKind = 'TEXT' | 'TEXT[]' | 'NUMERIC' | 'BOOLEAN' | 'TIMESTAMPTZ' | 'JSONB' | 'NUMRANGE'
export type DriftColumnKind = SqlKind | 'OTHER'

/** A field as the registry (or a SchemaDefinition) holds it; `config` is read as a loose record. */
export interface DriftField { name: string; fieldType: string; config?: object | null }

const cfg = (f: DriftField): Record<string, unknown> => (f.config ?? {}) as Record<string, unknown>
export interface DriftType { name: string; localized?: boolean; previousNames?: string[]; fields: DriftField[] }
/** The registry rows, as the object_types / fields tables hold them. */
export interface RegistrySnapshot {
  types: DriftType[]
  /**
   * Rows whose jsonb config holds a JSON STRING (`"{\"many\":true}"`) instead of
   * an object. Drizzle readers parse it on the way out, but push's raw-SQL
   * healing passes (`config->>'many'`) read nothing, so a many relation stays
   * TEXT while the generated table declares an array.
   */
  encodedConfigs?: { fields: string[]; types: string[] }
}

export interface GeneratedTable { columns: Record<string, DriftColumnKind> }
/** The generated content-tables.ts: one entry per pgTable, column name -> kind. */
export interface GeneratedSnapshot {
  source: string
  tables: Record<string, GeneratedTable>
  i18nTables: Record<string, GeneratedTable>
  /** The artifact's own provenance when it carries one (Phase 6B, Unit 3). */
  meta?: GeneratedArtifactMeta | null
}

export interface DbTable {
  columns: Record<string, DriftColumnKind>
  /** Index names on the table; undefined when the collector did not ask pg_indexes. */
  indexes?: string[]
  /** PRIMARY KEY column list ("id"); null when the table has none; undefined when not collected. */
  pkey?: string | null
}
/** Every table in the database's current schema that the checks may care about. */
export interface DbSnapshot { tables: Record<string, DbTable> }

export interface CustomTableSpec { name: string; columns: Record<string, { kind: string }> }

/** What `tangen diff` would print, reduced to counts - doctor summarises, diff shows. */
export interface LocalDelta { adds: number; removes: number; changes: number; total: number }

/** The provenance a stamped artifact carries (@tangen/schema `artifactMeta`). */
export interface GeneratedArtifactMeta {
  format: number
  workspaceId: string
  fingerprint: string
  types: string[]
}

export interface DriftInputs {
  registry: RegistrySnapshot
  generated?: GeneratedSnapshot | null
  db?: DbSnapshot | null
  /** The component registry, so container fields with localized sub-fields count as side-table columns. */
  components?: ComponentDef[]
  /** Side-table checks run only when localization is on (push creates them only then). */
  localizationEnabled?: boolean
  customTables?: CustomTableSpec[]
  /** Local code vs registry, already reduced by the caller (a plan summary or the load error). */
  local?: { delta: LocalDelta } | { error: string } | null
  /**
   * Registry types an extension used to provide and nobody declares any more.
   * Reported, never fixed automatically: a table full of authored content is
   * not dropped because an extension left. INFO severity, so a workspace that
   * deliberately turned an extension off does not read as broken forever.
   */
  extensionOrphans?: Array<{ type: string; providedBy: string }>
}

export type DriftSeverity = 'error' | 'warn' | 'info'
export type DriftPair = 'registry/generated' | 'registry/db' | 'generated/db' | 'local/registry' | 'config/db' | 'db' | 'registry'

export type DriftCode =
  | 'GENERATED_MISSING_TABLE'
  | 'GENERATED_MISSING_COLUMN'
  | 'GENERATED_EXTRA_COLUMN'
  | 'GENERATED_COLUMN_TYPE'
  | 'GENERATED_MISSING_I18N_TABLE'
  | 'GENERATED_MISSING_I18N_COLUMN'
  | 'DB_MISSING_TABLE'
  | 'DB_MISSING_COLUMN'
  | 'DB_COLUMN_TYPE'
  | 'DB_ORPHAN_COLUMN'
  | 'GUARDED_DROP'
  | 'EXTENSION_DATA_RETAINED'
  | 'ENV_ROLE_MISSING'
  | 'ENV_ROLE_UNKNOWN'
  | 'ENV_ROLE_AMBIGUOUS'
  | 'ENV_ROLE_TAKEN'
  | 'ENV_ROLE_SUSPICIOUS'
  | 'ENV_ROLE_COLUMN_MISSING'
  | 'EXTENSION_TABLE_ORPHANED'
  | 'EXTENSION_MIGRATION_FAILED'
  | 'EXTENSION_SETTING_UNAVAILABLE'
  | 'ROUTE_RETIRED'
  | 'INDEX_MISSING'
  | 'PK_LEGACY'
  | 'PK_MISSING'
  | 'PK_SHAPE'
  | 'I18N_MISSING_TABLE'
  | 'I18N_MISSING_COLUMN'
  | 'I18N_ORPHAN_TABLE'
  | 'CUSTOM_TABLE_MISSING'
  | 'CUSTOM_TABLE_MISSING_COLUMN'
  | 'CUSTOM_TABLE_COLUMN_TYPE'
  | 'REGISTRY_CONFIG_ENCODED'
  | 'LOCAL_DIFFERS'
  | 'LOCAL_UNLOADABLE'
  | 'EXTENSION_TYPE_ORPHANED'
  | 'SYSTEM_TABLE_MISSING'
  | 'SYSTEM_COLUMN_MISSING'
  | 'KNOWLEDGE_PGVECTOR_MISSING'
  | 'PUSH_HISTORY_MISMATCH'
  | 'PUSH_HISTORY_UNVERIFIED'

export interface DriftFinding {
  code: DriftCode
  severity: DriftSeverity
  /** The two sources that disagree. */
  pair: DriftPair
  /** `post`, `post.body`, `post_i18n.body`, `coupons.code`, or the file name. */
  subject: string
  /** One line: what is wrong and what the API does because of it. */
  cause: string
  /** One line: the command (or statement) that fixes it. */
  fix: string
}

export interface DriftReport {
  /** True when no finding is an error or a warning (info findings never count as drift). */
  clean: boolean
  findings: DriftFinding[]
  counts: Record<DriftSeverity, number>
}

/** Columns every content table carries (contentTableDdl in @tangen/db). */
export const CONTENT_SYSTEM_COLUMNS: ReadonlySet<string> = new Set([
  'id', 'workspace_id', 'title', 'slug', 'status', 'published_at', 'published_by',
  'published_values', 'scheduled_at', 'scheduled_by', 'created_at', 'updated_at', 'created_by', 'updated_by',
  'created_by_kind', 'updated_by_kind', 'published_by_kind',
])
/** Columns every i18n side table carries (i18nTableDdl in @tangen/db). */
export const I18N_SYSTEM_COLUMNS: ReadonlySet<string> = new Set(['object_id', 'locale', '__title', 'updated_at'])

/** Column kinds push indexes when `index: true` (B-tree on scalars, GIN on arrays; JSONB and ranges are never indexed by the flag). */
const INDEXABLE_KINDS: ReadonlySet<string> = new Set(['TEXT', 'TEXT[]', 'NUMERIC', 'BOOLEAN', 'TIMESTAMPTZ'])

/** True when `index: true` on the field creates an index - the CLI's fieldIsIndexable, by column kind. */
export function fieldIsIndexed(fieldType: string, config?: object | null): boolean {
  const kind = expectedSqlKind(fieldType, config)
  return kind !== null && INDEXABLE_KINDS.has(kind)
}

/**
 * The SQL column family a field is stored in - the same table as the CLI's
 * fieldTypeToSql (apply.ts), kept here so the API can run the checks without
 * importing the CLI. Null for `group`, which is a visual grouping with no column.
 */
export function expectedSqlKind(fieldType: string, config?: object | null): SqlKind | null {
  if (fieldType === 'relation' && (config as { many?: boolean } | null | undefined)?.many === true) return 'TEXT[]'
  switch (fieldType) {
    case 'range': return 'NUMRANGE'
    case 'text': case 'slug': case 'textarea': case 'email': case 'url': case 'phone':
    case 'select': case 'relation': case 'media': case 'color': case 'time': case 'code':
      return 'TEXT'
    case 'number': case 'currency': case 'rating': return 'NUMERIC'
    case 'date': return 'TIMESTAMPTZ'
    case 'boolean': return 'BOOLEAN'
    case 'multiselect': case 'tags': return 'TEXT[]'
    case 'richtext': case 'repeater': case 'component': case 'json': case 'object': case 'geopoint':
    case 'link': return 'JSONB'
    case 'group': return null
    default: return 'TEXT'
  }
}

/** information_schema.columns.udt_name -> the kind push would have created. */
export function udtToSqlKind(udtName: string): DriftColumnKind {
  switch (udtName) {
    case 'text': case 'varchar': case 'bpchar': return 'TEXT'
    case '_text': case '_varchar': return 'TEXT[]'
    case 'numeric': case 'int4': case 'int8': case 'float8': return 'NUMERIC'
    case 'bool': return 'BOOLEAN'
    case 'timestamptz': case 'timestamp': return 'TIMESTAMPTZ'
    case 'jsonb': case 'json': return 'JSONB'
    case 'numrange': return 'NUMRANGE'
    default: return 'OTHER'
  }
}

/** Custom-table column kinds -> SQL family (custom-table-migration.ts SQL_TYPE). */
function customKindToSql(kind: string): SqlKind {
  switch (kind) {
    case 'number': return 'NUMERIC'
    case 'boolean': return 'BOOLEAN'
    case 'json': return 'JSONB'
    case 'timestamp': return 'TIMESTAMPTZ'
    default: return 'TEXT'
  }
}

/** Drizzle declares `range` as text(); Postgres holds NUMRANGE. Those two agree by design. */
function kindsAgree(expected: DriftColumnKind, actual: DriftColumnKind): boolean {
  if (expected === actual) return true
  if (expected === 'NUMRANGE' && actual === 'TEXT') return true
  return false
}

interface ExpectedColumns { main: Map<string, { kind: SqlKind; field: DriftField }>; i18n: Map<string, DriftColumnKind>; wantsI18n: boolean }

/** The columns a registry type owns: main-table field columns and side-table columns. */
function expectedColumnsFor(type: DriftType, components: ComponentDef[]): ExpectedColumns {
  const main = new Map<string, { kind: SqlKind; field: DriftField }>()
  for (const f of flattenFields(type.fields as never) as unknown as DriftField[]) {
    const kind = expectedSqlKind(f.fieldType, cfg(f))
    if (kind) main.set(f.name, { kind, field: f })
  }
  const i18n = new Map<string, DriftColumnKind>()
  for (const f of flattenFields(type.fields as never) as unknown as DriftField[]) {
    if (cfg(f).localized !== true || f.fieldType === 'media') continue
    const kind = expectedSqlKind(f.fieldType, cfg(f))
    if (kind && !i18n.has(f.name)) i18n.set(f.name, kind)
  }
  let containers: string[] = []
  try { containers = localizedContainerFields(type.fields as never, components) } catch { /* malformed config: no overlay columns */ }
  for (const name of containers) if (!i18n.has(name)) i18n.set(name, 'JSONB')
  const wantsI18n = type.localized === true || i18n.size > 0
  return { main, i18n, wantsI18n }
}

function indexStatement(type: string, field: string, kind: SqlKind): string {
  return kind === 'TEXT[]'
    ? `CREATE INDEX IF NOT EXISTS "${type}_${field}_idx" ON "${type}" USING GIN ("${field}")`
    : `CREATE INDEX IF NOT EXISTS "${type}_${field}_idx" ON "${type}" ("${field}")`
}

/** Canonical "table:column" set of a registry. */
function registryColumnKey(registry: RegistrySnapshot, components: ComponentDef[]): string {
  const keys: string[] = []
  for (const t of registry.types) {
    const cols = expectedColumnsFor(t, components)
    for (const c of cols.main.keys()) keys.push(`${t.name}:${c}`)
  }
  return keys.sort().join('\n')
}

function generatedColumnKey(generated: GeneratedSnapshot): string {
  const keys: string[] = []
  for (const [table, def] of Object.entries(generated.tables)) {
    for (const c of Object.keys(def.columns)) if (!CONTENT_SYSTEM_COLUMNS.has(c)) keys.push(`${table}:${c}`)
  }
  return keys.sort().join('\n')
}

/** Compares the four sources of the schema and reports every disagreement. */
/** `_dropped__<original>__<8 hex>`: the name a guarded drop leaves behind (cli/guarded-drops.ts owns the algorithm). */
function parseGuarded(name: string): { original: string; id: string } | null {
  const m = /^_dropped__(.+)__([0-9a-f]{8})$/.exec(name)
  return m ? { original: m[1]!, id: m[2]! } : null
}

export function checkSchemaDrift(inputs: DriftInputs): DriftReport {
  const { registry } = inputs
  const generated = inputs.generated ?? null
  const db = inputs.db ?? null
  const components = inputs.components ?? []
  const i18nOn = inputs.localizationEnabled === true
  const findings: DriftFinding[] = []
  const push = 'tangen push'
  const regenerate = 'tangen schema regenerate'
  const add = (f: DriftFinding) => findings.push(f)

  const expected = new Map<string, ExpectedColumns>()
  for (const t of registry.types) expected.set(t.name, expectedColumnsFor(t, components))

  // ── registry vs generated file ────────────────────────────────────────────
  if (generated) {
    for (const t of registry.types) {
      const exp = expected.get(t.name)!
      const gen = generated.tables[t.name]
      if (!gen) {
        add({
          code: 'GENERATED_MISSING_TABLE', severity: 'error', pair: 'registry/generated', subject: t.name,
          cause: `the registry has "${t.name}" but content-tables.ts declares no table for it: the API answers TYPE_NOT_FOUND for every ${t.name} request`,
          fix: regenerate,
        })
      } else {
        for (const [col, { kind }] of exp.main) {
          const genKind = gen.columns[col]
          if (genKind === undefined) {
            add({
              code: 'GENERATED_MISSING_COLUMN', severity: 'error', pair: 'registry/generated', subject: `${t.name}.${col}`,
              cause: `the registry has the field but content-tables.ts has no column: the API silently drops writes to ${t.name}.${col} and never reads it`,
              fix: regenerate,
            })
          } else if (!kindsAgree(kind, genKind)) {
            add({
              code: 'GENERATED_COLUMN_TYPE', severity: 'error', pair: 'registry/generated', subject: `${t.name}.${col}`,
              cause: `${t.name}.${col} is ${kind} per the registry but content-tables.ts declares ${genKind}: writes fail or values come back in the wrong shape`,
              fix: regenerate,
            })
          }
        }
        for (const col of Object.keys(gen.columns)) {
          if (CONTENT_SYSTEM_COLUMNS.has(col) || exp.main.has(col)) continue
          add({
            code: 'GENERATED_EXTRA_COLUMN', severity: 'warn', pair: 'registry/generated', subject: `${t.name}.${col}`,
            cause: `content-tables.ts declares ${t.name}.${col} but the registry has no such field: the file is ahead of the registry (local code pushed elsewhere, or a git pull)`,
            fix: `${push} if local code declares it, otherwise ${regenerate}`,
          })
        }
      }
      if (i18nOn && exp.wantsI18n) {
        const side = generated.i18nTables[`${t.name}_i18n`]
        if (!side) {
          add({
            code: 'GENERATED_MISSING_I18N_TABLE', severity: 'error', pair: 'registry/generated', subject: `${t.name}_i18n`,
            cause: `"${t.name}" has localized fields but content-tables.ts declares no ${t.name}_i18n side table: translations cannot be read or saved`,
            fix: regenerate,
          })
        } else {
          for (const col of exp.i18n.keys()) {
            if (side.columns[col] === undefined) {
              add({
                code: 'GENERATED_MISSING_I18N_COLUMN', severity: 'error', pair: 'registry/generated', subject: `${t.name}_i18n.${col}`,
                cause: `${t.name}.${col} is localized but content-tables.ts has no ${t.name}_i18n.${col} column: its translations are dropped on save`,
                fix: regenerate,
              })
            }
          }
        }
      }
    }
  }

  // ── registry vs database, generated vs database ───────────────────────────
  if (db) {
    for (const t of registry.types) {
      const exp = expected.get(t.name)!
      const table = db.tables[t.name]
      if (!table) {
        add({
          code: 'DB_MISSING_TABLE', severity: 'error', pair: 'registry/db', subject: t.name,
          cause: `the registry has "${t.name}" but the database has no "${t.name}" table: every ${t.name} request fails`,
          fix: `by hand - push will not re-create a table for a type the registry already records: delete the registry rows for "${t.name}" (fields, then object_types) and run ${push}, or restore the table from a backup`,
        })
        continue
      }
      for (const [col, { kind, field }] of exp.main) {
        const actual = table.columns[col]
        if (actual === undefined) {
          const inFile = generated?.tables[t.name]?.columns[col] !== undefined
          add({
            code: 'DB_MISSING_COLUMN', severity: 'error', pair: 'registry/db', subject: `${t.name}.${col}`,
            cause: inFile
              ? `the registry and content-tables.ts have ${t.name}.${col} but the "${t.name}" table has no such column: every read of ${t.name} fails with 42703`
              : `the registry has ${t.name}.${col} but the "${t.name}" table has no such column: the field cannot be stored`,
            fix: `${push} (its column heals re-add a registered column the table lost: ALTER TABLE "${t.name}" ADD COLUMN IF NOT EXISTS "${col}" ${kind})`,
          })
        } else if (!kindsAgree(kind, actual)) {
          const healedByPush = kind === 'TEXT[]' && actual === 'TEXT' && field.fieldType === 'relation'
          add({
            code: 'DB_COLUMN_TYPE', severity: 'warn', pair: 'registry/db', subject: `${t.name}.${col}`,
            cause: `${t.name}.${col} is ${kind} per the registry but the column is ${actual}: writes through the generated table fail or values come back in the wrong shape`,
            fix: healedByPush
              ? `${push} (its many-relation healing pass converts the column)`
              : `by hand: ALTER TABLE "${t.name}" ALTER COLUMN "${col}" TYPE ${kind} USING ("${col}"::${kind})`,
          })
        }
      }
      for (const col of Object.keys(table.columns)) {
        if (CONTENT_SYSTEM_COLUMNS.has(col) || exp.main.has(col)) continue
        if (generated?.tables[t.name]?.columns[col] !== undefined) continue
        const guarded = parseGuarded(col)
        if (guarded) {
          add({
            code: 'GUARDED_DROP', severity: 'info', pair: 'db', subject: `${t.name}.${col}`,
            cause: `"${t.name}"."${col}" is the dropped field "${guarded.original}" kept aside with its values (guarded drop)`,
            fix: `to recover: declare "${guarded.original}" on "${t.name}" again and push (the column and its values come back); to delete for good: tangen purge guarded ${t.name}.${col} --approve purge-guarded:${col}`,
          })
          continue
        }
        add({
          code: 'DB_ORPHAN_COLUMN', severity: 'info', pair: 'db', subject: `${t.name}.${col}`,
          cause: `"${t.name}"."${col}" is in the database but in neither the registry nor content-tables.ts (data retained)`,
          fix: `nothing to do; drop by hand only if nothing needs it: ALTER TABLE "${t.name}" DROP COLUMN "${col}"`,
        })
      }
      if (table.indexes) {
        const have = new Set(table.indexes)
        if (!have.has(`${t.name}_slug_uniq`)) {
          add({
            code: 'INDEX_MISSING', severity: 'warn', pair: 'registry/db', subject: t.name,
            cause: `"${t.name}" has no slug uniqueness index: two concurrent creates can commit the same slug, and every slug lookup scans the whole table`,
            fix: `${push} (its heals create it: CREATE UNIQUE INDEX IF NOT EXISTS "${t.name}_slug_uniq" ON "${t.name}" (slug) WHERE slug IS NOT NULL - push refuses with the duplicate groups if any exist)`,
          })
        }
        if (!have.has(`${t.name}_scope_idx`)) {
          add({
            code: 'INDEX_MISSING', severity: 'warn', pair: 'registry/db', subject: t.name,
            cause: `"${t.name}" has no scope index: every list query scans the whole table`,
            fix: `${push} (its index heals re-create it: CREATE INDEX IF NOT EXISTS "${t.name}_scope_idx" ON "${t.name}" (workspace_id, status, created_at))`,
          })
        }
        for (const [col, { kind, field }] of exp.main) {
          if (cfg(field).index !== true || !fieldIsIndexed(field.fieldType, cfg(field))) continue
          if (have.has(`${t.name}_${col}_idx`)) continue
          add({
            code: 'INDEX_MISSING', severity: 'warn', pair: 'registry/db', subject: `${t.name}.${col}`,
            cause: `${t.name}.${col} is declared index: true but the database has no "${t.name}_${col}_idx": queries filtering on it scan the whole table`,
            fix: `${push} (its index heals re-create it: ${indexStatement(t.name, col, kind)})`,
          })
        }
      }
      if (table.pkey !== undefined) checkPkey(t.name, table.pkey, 'id', 'id, env_id', add)

      if (i18nOn && exp.wantsI18n) {
        const sideName = `${t.name}_i18n`
        const side = db.tables[sideName]
        if (!side) {
          add({
            code: 'I18N_MISSING_TABLE', severity: 'error', pair: 'registry/db', subject: sideName,
            cause: `"${t.name}" has localized fields but the database has no "${sideName}" side table: translations cannot be saved`,
            fix: `${push} (creates side tables on every push)`,
          })
        } else {
          for (const [col, kind] of exp.i18n) {
            if (side.columns[col] === undefined) {
              add({
                code: 'I18N_MISSING_COLUMN', severity: 'error', pair: 'registry/db', subject: `${sideName}.${col}`,
                cause: `${t.name}.${col} is localized but "${sideName}" has no "${col}" column: its translations cannot be saved`,
                fix: `${push} (adds side-table columns on every push; ${kind})`,
              })
            }
          }
          if (side.pkey !== undefined) checkPkey(sideName, side.pkey, 'object_id, locale', 'object_id, env_id, locale', add)
        }
      }
    }

    // Generated tables and columns the database lacks (the file is ahead of the database).
    if (generated) {
      for (const [tableName, gen] of Object.entries(generated.tables)) {
        const table = db.tables[tableName]
        const inRegistry = expected.get(tableName)
        if (!table) {
          if (inRegistry) continue // already reported as DB_MISSING_TABLE
          add({
            code: 'DB_MISSING_TABLE', severity: 'error', pair: 'generated/db', subject: tableName,
            cause: `content-tables.ts declares "${tableName}" but the database has no such table and the registry no such type: the API answers 500 for it`,
            fix: `${push} if local code declares it, otherwise ${regenerate}`,
          })
          continue
        }
        for (const col of Object.keys(gen.columns)) {
          if (CONTENT_SYSTEM_COLUMNS.has(col) || table.columns[col] !== undefined) continue
          if (inRegistry?.main.has(col)) continue // already reported from the registry side
          add({
            code: 'DB_MISSING_COLUMN', severity: 'error', pair: 'generated/db', subject: `${tableName}.${col}`,
            cause: `content-tables.ts names ${tableName}.${col} but the "${tableName}" table has no such column: every read of ${tableName} fails with 42703`,
            fix: `${push} if local code declares ${tableName}.${col} (it adds the column), otherwise ${regenerate} (drops it from the file)`,
          })
        }
      }
    }

    // Side tables nobody owns: a type rename leaves <old>_i18n behind with its translations.
    if (i18nOn) {
      const known = new Set<string>()
      for (const t of registry.types) known.add(t.name)
      for (const name of Object.keys(generated?.i18nTables ?? {})) known.add(name.replace(/_i18n$/, ''))
      const renamedTo = (old: string): string | null => {
        const t = registry.types.find((x) => (x.previousNames ?? []).includes(old))
        return t ? t.name : null
      }
      for (const tableName of Object.keys(db.tables)) {
        const guardedTable = parseGuarded(tableName)
        if (guardedTable) {
          add({
            code: 'GUARDED_DROP', severity: 'info', pair: 'db', subject: tableName,
            cause: `"${tableName}" is the dropped type "${guardedTable.original}" kept aside with its rows (guarded drop)`,
            fix: `to recover: declare the type "${guardedTable.original}" again and push (the table, its rows, key and indexes come back); to delete for good: tangen purge guarded ${tableName} --approve purge-guarded:${tableName}`,
          })
          continue
        }
        if (!tableName.endsWith('_i18n')) continue
        const base = tableName.slice(0, -'_i18n'.length)
        if (known.has(base)) continue
        const renamed = renamedTo(base)
        if (renamed) {
          add({
            code: 'I18N_ORPHAN_TABLE', severity: 'warn', pair: 'db', subject: tableName,
            cause: `"${tableName}" was left behind when "${base}" was renamed to "${renamed}": its translations are stranded (the API reads "${renamed}_i18n")`,
            fix: `by hand: copy the rows into "${renamed}_i18n" (INSERT INTO "${renamed}_i18n" SELECT * FROM "${tableName}" ON CONFLICT DO NOTHING), then DROP TABLE "${tableName}"`,
          })
        } else {
          add({
            code: 'I18N_ORPHAN_TABLE', severity: 'info', pair: 'db', subject: tableName,
            cause: `"${tableName}" is a side table for a type the registry does not have (data retained)`,
            fix: `nothing to do; drop by hand once you are sure: DROP TABLE "${tableName}"`,
          })
        }
      }
    }

    // Custom tables (config vs database): push creates and adds columns idempotently, never alters.
    for (const ct of inputs.customTables ?? []) {
      const table = db.tables[ct.name]
      if (!table) {
        add({
          code: 'CUSTOM_TABLE_MISSING', severity: 'error', pair: 'config/db', subject: ct.name,
          cause: `custom table "${ct.name}" is declared in the workspace config but does not exist in the database: every query on it fails`,
          fix: `${push} (creates custom tables on every push)`,
        })
        continue
      }
      for (const [col, def] of Object.entries(ct.columns)) {
        const want = customKindToSql(def.kind)
        const actual = table.columns[col]
        if (actual === undefined) {
          add({
            code: 'CUSTOM_TABLE_MISSING_COLUMN', severity: 'error', pair: 'config/db', subject: `${ct.name}.${col}`,
            cause: `custom table "${ct.name}" declares "${col}" but the table has no such column: queries naming it fail with 42703`,
            fix: `${push} (adds custom-table columns on every push)`,
          })
        } else if (!kindsAgree(want, actual)) {
          add({
            code: 'CUSTOM_TABLE_COLUMN_TYPE', severity: 'warn', pair: 'config/db', subject: `${ct.name}.${col}`,
            cause: `"${ct.name}"."${col}" is declared ${def.kind} (${want}) but the column is ${actual}: push never alters custom-table columns`,
            fix: `by hand: ALTER TABLE "${ct.name}" ALTER COLUMN "${col}" TYPE ${want} USING ("${col}"::${want})`,
          })
        }
      }
    }
  }

  // ── registry storage ──────────────────────────────────────────────────────
  {
    const enc = registry.encodedConfigs
    const fieldsN = enc?.fields.length ?? 0
    const typesN = enc?.types.length ?? 0
    if (fieldsN + typesN > 0) {
      const sample = [...(enc?.fields ?? []), ...(enc?.types ?? [])].slice(0, 4).join(', ')
      const more = fieldsN + typesN > 4 ? ` and ${fieldsN + typesN - 4} more` : ''
      const what = [fieldsN ? `${fieldsN} field config${fieldsN === 1 ? '' : 's'}` : '', typesN ? `${typesN} type admin config${typesN === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')
      add({
        code: 'REGISTRY_CONFIG_ENCODED', severity: 'warn', pair: 'registry', subject: 'registry',
        cause: `${what} in the registry are stored as JSON strings inside jsonb (${sample}${more}): Drizzle readers parse them, but push's raw-SQL healing passes read many/localized as unset, so a many relation stays TEXT while the generated table declares an array`,
        fix: `${push} (its registry heals rewrite them as objects, once: UPDATE fields SET config = (config #>> '{}')::jsonb WHERE jsonb_typeof(config) = 'string', and the same for admin_config)`,
      })
    }
  }

  // ── local code vs registry ────────────────────────────────────────────────
  if (inputs.local && 'error' in inputs.local) {
    add({
      code: 'LOCAL_UNLOADABLE', severity: 'warn', pair: 'local/registry', subject: 'app/',
      cause: `the local schema failed to load: ${inputs.local.error.split('\n')[0]}`,
      fix: 'tangen check (type errors), then fix the file it names',
    })
  } else if (inputs.local && inputs.local.delta.total > 0) {
    const d = inputs.local.delta
    const parts: string[] = []
    if (d.adds) parts.push(`${d.adds} addition${d.adds === 1 ? '' : 's'}`)
    if (d.changes) parts.push(`${d.changes} change${d.changes === 1 ? '' : 's'}`)
    if (d.removes) parts.push(`${d.removes} removal${d.removes === 1 ? '' : 's'}`)
    const direction = d.removes && !d.adds && !d.changes ? 'behind' : d.removes ? 'ahead of and behind' : 'ahead of'
    add({
      code: 'LOCAL_DIFFERS', severity: 'warn', pair: 'local/registry', subject: 'app/',
      cause: `local code is ${direction} the registry: ${parts.join(', ')} (${d.total} operation${d.total === 1 ? '' : 's'}) not pushed`,
      fix: `tangen diff shows them; ${push} applies them`,
    })
  }

  // ── types nobody declares any more ────────────────────────────────────────
  for (const o of inputs.extensionOrphans ?? []) {
    add({
      code: 'EXTENSION_TYPE_ORPHANED', severity: 'info', pair: 'local/registry', subject: o.type,
      cause: `extension "${o.providedBy}" provisioned "${o.type}" and no longer declares it: the table, its rows and its registry row are KEPT, and no push will drop them`,
      fix: `re-install extension "${o.providedBy}" to own it again, or declare "${o.type}" in your own schema to take it over (it then drops like any other type, with --confirm)`,
    })
  }

  const counts: Record<DriftSeverity, number> = { error: 0, warn: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  return { clean: counts.error === 0 && counts.warn === 0, findings, counts }
}

function checkPkey(
  table: string,
  pkey: string | null,
  want: string,
  legacy: string,
  add: (f: DriftFinding) => void,
): void {
  if (pkey === want) return
  if (pkey === null) {
    add({
      code: 'PK_MISSING', severity: 'error', pair: 'db', subject: table,
      cause: `"${table}" has no primary key: the identity upgrade stopped after DROP CONSTRAINT (usually a row with a NULL key column), and push skips tables whose key it does not recognise`,
      fix: `by hand: fix rows with a NULL then ALTER TABLE "${table}" ADD PRIMARY KEY (${want})`,
    })
    return
  }
  if (pkey === legacy) {
    add({
      code: 'PK_LEGACY', severity: 'warn', pair: 'db', subject: table,
      cause: `"${table}" is still on the environment-era (${legacy}) primary key: migration 0051 did not run here`,
      fix: `run the platform migrations (a normal API boot), then ${'tangen push'}`,
    })
    return
  }
  add({
    code: 'PK_SHAPE', severity: 'warn', pair: 'db', subject: table,
    cause: `"${table}" has an unexpected primary key (${pkey}); push leaves it alone`,
    fix: `by hand: ALTER TABLE "${table}" DROP CONSTRAINT <name>, ADD PRIMARY KEY (${want})`,
  })
}
