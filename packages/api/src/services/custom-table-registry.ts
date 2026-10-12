/**
 * File Name: custom-table-registry.ts
 * Purpose: Resolves the Drizzle pgTable for a custom-table definition and hosts
 *          the shared write-value normalization + select executor used by BOTH
 *          custom-table query surfaces (the local client's table builder and
 *          the REST /tables/:name/query route) — one execution path, the same
 *          generated-Drizzle model content tables use.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Registry-first (the project-generated custom-tables.ts
 *          via @tangen/db/custom-tables), falling back to building the identical
 *          pgTable from the boot-loaded CustomTableDefinition with schema-kit's
 *          customTablePg (memoized per definition object) — so projects that
 *          have not re-pushed since this file model landed keep working.
 */
import { sql, and, asc, desc } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { CustomTableDefinition, ColumnDefinition, QueryResult } from '@tangen/types'
import { RouteError } from '@tangen/types'
import { buildSelectColumns } from './query-compiler'
import { isSafeIdent } from '@tangen/types'

const builtTables = new WeakMap<CustomTableDefinition, Record<string, any>>()

/**
 * Drizzle pgTable for a custom-table definition: the generated registry entry
 * when present, else built from the definition (same mapping, memoized).
 */
export async function resolveCustomTablePg(def: CustomTableDefinition): Promise<Record<string, any>> {
  const { customTables } = await import('@tangen/db/custom-tables')
  const fromGenerated = (customTables as Record<string, any>)[def.name]
  if (fromGenerated) return fromGenerated
  let table = builtTables.get(def)
  if (!table) {
    const { customTablePg } = await import('@tangen/db/schema-kit')
    table = customTablePg(def as never) as unknown as Record<string, any>
    builtTables.set(def, table)
  }
  return table
}

/** System columns every custom table carries. */
function allowedWriteKeys(def: CustomTableDefinition): Set<string> {
  return new Set([
    'id', 'workspace_id',
    ...Object.keys(def.columns),
  ])
}

/** Reject writes to columns the table does not have (Drizzle would silently
 *  drop them — silent data loss; the raw path surfaced a DB error instead). */
export function assertKnownColumns(def: CustomTableDefinition, data: Record<string, unknown>): void {
  const allowed = allowedWriteKeys(def)
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      throw new RouteError(422, `Unknown column: "${key}" is not defined on table "${def.name}"`)
    }
  }
}

/**
 * Pre-normalize write values for Drizzle's column mappers, preserving the
 * inputs the raw-SQL path accepted:
 * - timestamp columns: ISO strings / epoch numbers → Date (drizzle's
 *   timestamp mapper calls .toISOString() and would crash on strings)
 * - json columns: JSON strings → parsed value (drizzle JSON.stringify()s the
 *   value; a pre-stringified input would double-encode, where Postgres used
 *   to cast text → jsonb, i.e. parse)
 * Everything else passes through untouched.
 */
export function normalizeTableWriteValues(
  def: CustomTableDefinition,
  data: Record<string, unknown>,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null
  for (const [key, value] of Object.entries(data)) {
    const colDef: ColumnDefinition | undefined = def.columns[key]
    if (!colDef || value === null || value === undefined) continue
    if (colDef.kind === 'timestamp' && (typeof value === 'string' || typeof value === 'number')) {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) {
        throw new RouteError(422, `Invalid timestamp for column "${key}"`)
      }
      out ??= { ...data }
      out[key] = d
    } else if (colDef.kind === 'json' && typeof value === 'string') {
      try {
        out ??= { ...data }
        out[key] = JSON.parse(value)
      } catch {
        throw new RouteError(422, `Invalid JSON for column "${key}"`)
      }
    }
  }
  return out ?? data
}

/** Resolve the ORDER BY column from the table object. Bad identifiers stay a
 *  422 (as before); a valid identifier that is not a column is now a 422 too
 *  (previously a database error). */
export function resolveSortColumn(table: Record<string, any>, field: string): any {
  if (!isSafeIdent(field)) {
    throw new RouteError(422, `Invalid field name: "${field}"`)
  }
  const col = table[field]
  if (col === undefined) {
    throw new RouteError(422, `Unknown sort field: "${field}"`)
  }
  return col
}

export interface TableSelectOptions {
  conditions: SQL[]
  sortField: string
  sortDir: 'asc' | 'desc'
  limit: number
  offset: number
  /** Column names to project; id and workspace_id are always included. */
  props: string[] | null
}

/**
 * The one custom-table find executor: Drizzle select + COUNT over the same
 * conditions. Callers own scoping (the local client env-scopes isolated
 * tables; the REST route is workspace-scoped by contract).
 */
export async function runTableSelect(
  db: any,
  table: Record<string, any>,
  opts: TableSelectOptions,
): Promise<QueryResult> {
  const { conditions, sortField, sortDir, limit, offset, props } = opts
  const orderCol = resolveSortColumn(table, sortField)
  const orderExpr = sortDir === 'asc' ? asc(orderCol) : desc(orderCol)
  const colSelection = props && props.length > 0
    ? buildSelectColumns(table, ['workspace_id', ...props])
    : undefined
  const where = and(...conditions)

  const [rows, countRows] = await Promise.all([
    (colSelection ? db.select(colSelection) : db.select()).from(table).where(where).orderBy(orderExpr).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)` }).from(table).where(where),
  ])

  const total = Number((countRows as any[])[0]?.count ?? 0)
  return { data: rows as Record<string, unknown>[], meta: { total, limit, offset } }
}
