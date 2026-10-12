/**
 * File Name: custom-table-migration.ts
 * Purpose: Generates CREATE TABLE / ALTER TABLE SQL for developer-defined custom tables
 *          and runs those migrations idempotently against the connected database.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types for ColumnDefinition and
 *                     CustomTableDefinition; uses IF NOT EXISTS guards to make
 *                     all migrations safe to re-run.
 *
 *                     Every identifier goes through `safeId`, the same guard the
 *                     rest of the CLI's DDL uses. Quoting a name is not
 *                     escaping it: a name containing a double quote closes the
 *                     identifier, and the rest of the string is SQL that then
 *                     runs inside the push transaction. The guard lives HERE
 *                     rather than only in the planner because the planner
 *                     checked a new table's column names on one branch only -
 *                     creating a table emitted every column unchecked - and
 *                     because the runtime migrator does not go through the
 *                     planner at all.
 */
import type { ColumnDefinition, CustomTableDefinition } from '@tangen/types'
import { safeId } from './column-types'

const SQL_TYPE: Record<string, string> = {
  text:      'TEXT',
  number:    'NUMERIC',
  boolean:   'BOOLEAN',
  json:      'JSONB',
  timestamp: 'TIMESTAMPTZ',
}

/**
 * A literal default. Same class of hole as the identifiers: the value used to
 * be interpolated between single quotes with nothing stopping it closing them.
 * Only the shapes a column definition can legitimately carry are accepted.
 */
function defaultLiteral(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') {
    // Doubling is the SQL escape, and a quote is then impossible to escape out
    // of; a backslash is refused because standard_conforming_strings is not
    // guaranteed on every deployment Tangen supports.
    if (v.includes('\\')) throw new Error(`Invalid default value (backslash): "${v}"`)
    return `'${v.replace(/'/g, "''")}'`
  }
  throw new Error(`Invalid default value: ${JSON.stringify(v)}`)
}

function columnFragment(name: string, def: ColumnDefinition): string {
  const type = SQL_TYPE[def.kind] ?? 'TEXT'
  const nullPart = def.nullable ? '' : ' NOT NULL'
  let defaultPart = ''
  if (def.defaultNow) {
    defaultPart = ' DEFAULT NOW()'
  } else if (def.defaultValue !== undefined) {
    defaultPart = ` DEFAULT ${defaultLiteral(def.defaultValue)}`
  }
  return `"${safeId(name)}" ${type}${nullPart}${defaultPart}`
}

/**
 * Generates a `CREATE TABLE IF NOT EXISTS` SQL statement for a custom table definition,
 * including the standard `id` and `workspace_id` columns and any user-defined columns.
 */
export function buildCustomTableSQL(table: CustomTableDefinition): string {
  const userCols = Object.entries(table.columns)
    .map(([name, def]) => `  ${columnFragment(name, def)}`)
    .join(',\n')
  const userSection = userCols ? `,\n${userCols}` : ''
  const tbl = safeId(table.name)
  return (
    `CREATE TABLE IF NOT EXISTS "${tbl}" (\n` +
    `  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n` +
    `  "workspace_id" TEXT NOT NULL` +
    userSection +
    `\n)`
  )
}

/**
 * Generates an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` SQL statement for a single column.
 * @param tableName - The name of the table to alter.
 * @param colName - The name of the column to add.
 * @param def - The column definition describing type, nullability, and default value.
 * @returns A SQL DDL string ready to execute against the database.
 */
export function buildAddColumnSQL(
  tableName: string,
  colName: string,
  def: ColumnDefinition,
): string {
  return `ALTER TABLE "${safeId(tableName)}" ADD COLUMN IF NOT EXISTS ${columnFragment(colName, def)}`
}

/**
 * Runs CREATE TABLE and ADD COLUMN migrations for all provided custom table definitions.
 */
export async function migrateCustomTables(
  execute: (rawSql: string) => Promise<unknown>,
  tables: CustomTableDefinition[],
): Promise<void> {
  // Build every statement for a table BEFORE running any of it, so a bad
  // identifier anywhere refuses the table instead of leaving it half-created.
  for (const table of tables) {
    const planned = [
      buildCustomTableSQL(table),
      ...Object.entries(table.columns).map(([colName, def]) => buildAddColumnSQL(table.name, colName, def)),
    ]
    for (const stmt of planned) await execute(stmt)
  }
}
