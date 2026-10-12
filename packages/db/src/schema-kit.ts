/**
 * File Name: schema-kit.ts
 * Purpose: Re-exports the drizzle-orm/pg-core primitives used by generated
 *          content-tables.ts / custom-tables.ts. The generated files import from
 *          HERE (@tangen/db, a top-level project dep) instead of drizzle-orm
 *          directly — because drizzle-orm is a NESTED transitive dep and isn't
 *          resolvable from a consumer project's app/generated/ location.
 *          Also home of customTablePg() — the SINGLE col.kind → drizzle-column
 *          mapping for custom tables, used by both the generated registry file
 *          and the API's build-from-definition fallback.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, numeric, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core'

export { pgTable, text, numeric, boolean, timestamp, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'
export { sql } from 'drizzle-orm'

// Structural mirror of @tangen/types' ColumnDefinition / CustomTableDefinition —
// declared locally so @tangen/db takes no dependency on @tangen/types.
export interface CustomTableColumnDef {
  kind: 'text' | 'number' | 'boolean' | 'json' | 'timestamp'
  nullable?: boolean
  defaultValue?: unknown
  defaultNow?: boolean
}

export interface CustomTablePgDef {
  name: string
  columns: Record<string, CustomTableColumnDef>
}

function columnFor(name: string, def: CustomTableColumnDef) {
  switch (def.kind) {
    case 'number':    return numeric(name)
    case 'boolean':   return boolean(name)
    case 'json':      return jsonb(name)
    case 'timestamp': return timestamp(name, { withTimezone: true })
    case 'text':
    default:          return text(name)
  }
}

/**
 * Build the Drizzle pgTable for a custom-table definition. JS keys are the
 * EXACT column names (workspace_id, not workspaceId) so drizzle select() rows
 * are byte-identical to the raw `SELECT *` rows the old SQL path returned.
 * DDL stays owned by the CLI's custom-table-migration (this object is the
 * query/execution layer only, so column defaults are not re-declared here).
 */
export function customTablePg(def: CustomTablePgDef) {
  // Builders are heterogeneous (text/numeric/boolean/…): keep the record loose;
  // callers consume the table as an untyped registry entry anyway.
  const cols: Record<string, any> = {
    id: text('id').primaryKey().notNull(),
    workspace_id: text('workspace_id').notNull(),
  }
  for (const [colName, colDef] of Object.entries(def.columns ?? {})) {
    const col = columnFor(colName, colDef)
    cols[colName] = colDef.nullable === false ? col.notNull() : col
  }
  return pgTable(def.name, cols)
}
