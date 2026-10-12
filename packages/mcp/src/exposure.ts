/**
 * File Name: exposure.ts
 * Purpose: MCP exposure resolution — which types and fields the MCP tools
 *          may see. Pure functions layered UNDER the API-key grant checks:
 *          a type/field survives only if (workspace mcp enabled) AND
 *          (type.mcp !== false) AND (field.mcp !== false); key grants are
 *          enforced separately by the tool handlers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types. Kept side-effect free for unit testing.
 */
import type { ObjectTypeDefinition, FieldDefinition, CustomTableDefinition, TableMcpConfig } from '@tangen/types'

/** Types visible to MCP (type-level opt-out applied). */
export function exposedTypes(types: ObjectTypeDefinition[]): ObjectTypeDefinition[] {
  // TL-2: disabled types are invisible to MCP, same as mcp: false
  return types.filter((t) => t.mcp !== false && (t as { disabled?: boolean }).disabled !== true)
}

/** Field definitions visible to MCP for one type. */
export function exposedFields(type: ObjectTypeDefinition): FieldDefinition[] {
  return type.fields.filter((f) => (f as { config?: { mcp?: boolean } }).config?.mcp !== false)
}

/** Names of fields hidden from MCP on a type (for write rejection messages). */
export function hiddenFieldNames(type: ObjectTypeDefinition): string[] {
  return type.fields
    .filter((f) => (f as { config?: { mcp?: boolean } }).config?.mcp === false)
    .map((f) => f.name)
}

/**
 * Strips hidden fields from a record before it leaves an MCP tool.
 * System columns (id/title/slug/status/…) always pass — hiding those would
 * break tool semantics; use type-level `mcp: false` to hide a whole type.
 */
export function stripHiddenFields(
  type: ObjectTypeDefinition,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const hidden = new Set(hiddenFieldNames(type))
  if (hidden.size === 0) return record
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (!hidden.has(k)) out[k] = v
  }
  return out
}

/**
 * Validates an MCP write payload: returns the hidden fields it illegally
 * names (empty array = OK). Writes must fail loudly, never silently drop.
 */
export function rejectedWriteFields(
  type: ObjectTypeDefinition,
  payload: Record<string, unknown>,
): string[] {
  const hidden = new Set(hiddenFieldNames(type))
  return Object.keys(payload).filter((k) => hidden.has(k))
}

// ─── Custom tables (parity with the type-level fns above) ───────────────────

/** Normalizes a table's `mcp` config (bool shorthand → object). */
function tableMcp(table: Pick<CustomTableDefinition, 'mcp'>): TableMcpConfig {
  const m = table.mcp
  if (m === undefined) return {}
  if (typeof m === 'boolean') return { enabled: m }
  return m
}

/**
 * Is this custom table exposed to MCP? Opt-out, like content types: exposed
 * unless `mcp: false` / `mcp: { enabled: false }`. Key `tables:read` grants
 * are enforced separately by the tool handlers.
 */
export function isTableExposed(table: Pick<CustomTableDefinition, 'mcp'>): boolean {
  return tableMcp(table).enabled !== false
}

/** Custom tables visible to MCP (table-level opt-out applied). */
export function exposedTables(tables: CustomTableDefinition[]): CustomTableDefinition[] {
  return tables.filter(isTableExposed)
}

/** Columns of a table MCP must never see. */
export function tableHiddenColumns(table: Pick<CustomTableDefinition, 'mcp'>): string[] {
  return tableMcp(table).hiddenColumns ?? []
}

/**
 * Strips hidden columns from a table row before it leaves an MCP tool.
 * `id` always passes — it's the row handle; redact data columns via
 * `mcp.hiddenColumns`, or hide the whole table with `mcp: false`.
 */
export function stripTableColumns(
  table: Pick<CustomTableDefinition, 'mcp'>,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const hidden = new Set(tableHiddenColumns(table))
  if (hidden.size === 0) return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id' || !hidden.has(k)) out[k] = v
  }
  return out
}
