/**
 * File Name: query-builder.ts
 * Purpose: The pure model behind Studio's Query Builder - the TangenQL
 *          operator set, which operators apply to which field type, and the
 *          round trip between the panel's flat filter ROWS and the TangenQL
 *          `query` OBJECT that kit.loop stores.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The stored value IS TangenQL (docs/tangenql.md) -
 *          this module translates presentation to that shape and back, it
 *          does not define a dialect. v1 authors flat AND conditions only;
 *          `_or`/`_and` grouping and dotted relation filters remain valid
 *          in a stored query and are preserved by kit.loop untouched - they
 *          simply do not surface as editable rows (queryToRows skips them
 *          rather than mangling them).
 */

/** One editable condition in the panel. */
export interface FilterRow {
  field: string
  op: string
  value: string
}

/** The TangenQL operator set, in the reference's own order. */
export const OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'gt', label: 'is after / greater than' },
  { value: 'gte', label: 'is at or after / at least' },
  { value: 'lt', label: 'is before / less than' },
  { value: 'lte', label: 'is at or before / at most' },
  { value: 'contains', label: 'contains' },
  { value: 'ncontains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'in', label: 'is one of' },
  { value: 'nin', label: 'is not one of' },
  { value: 'exists', label: 'is set' },
]

const EQUALITY = ['eq', 'ne']
const COMPARISON = ['gt', 'gte', 'lt', 'lte']
const SUBSTRING = ['contains', 'ncontains', 'startsWith']
const SET = ['in', 'nin']

/** Field types whose values compare as numbers or dates. */
const ORDERED = new Set(['number', 'currency', 'rating', 'range', 'date', 'time'])
/** Field types that hold a list, where in/nin compiles to array overlap. */
const LISTY = new Set(['tags', 'multiselect'])

/**
 * The operators worth offering for a field type. Every type can test
 * existence; beyond that the list narrows so the panel cannot author a
 * condition the engine will reject (a `contains` on a number, say).
 */
export function operatorsForFieldType(fieldType: string): string[] {
  if (fieldType === 'boolean') return [...EQUALITY, 'exists']
  if (ORDERED.has(fieldType)) return [...EQUALITY, ...COMPARISON, ...SET, 'exists']
  if (LISTY.has(fieldType)) return [...EQUALITY, ...SET, 'exists']
  return [...EQUALITY, ...SUBSTRING, ...SET, 'exists']
}

/** Number-ish text to a number, or the raw string when it will not parse. */
function toNumber(raw: string): string | number {
  const trimmed = raw.trim()
  if (trimmed === '') return raw
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : raw
}

/**
 * The typed value for one condition. `in`/`nin` take comma-separated lists
 * (TangenQL rejects bare arrays elsewhere, so this is the only list form);
 * `exists` is always a boolean; numeric field types parse.
 */
export function coerceValue(raw: string, fieldType: string, op: string): unknown {
  if (op === 'exists') return raw.trim() === 'true'
  if (op === 'in' || op === 'nin') {
    const parts = raw.split(',').map((p) => p.trim()).filter((p) => p !== '')
    return ORDERED.has(fieldType) ? parts.map(toNumber) : parts
  }
  if (fieldType === 'boolean') return raw.trim() === 'true'
  if (ORDERED.has(fieldType)) return toNumber(raw)
  return raw
}

/**
 * The TangenQL `query` object for a set of rows. Several rows on the SAME
 * field merge into one operator object (`{ views: { gte: 1, lte: 9 } }`),
 * which is exactly how TangenQL expresses a range.
 */
export function rowsToQuery(rows: FilterRow[], fieldTypes: Record<string, string>): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const row of rows ?? []) {
    if (!row?.field || !row.op) continue
    // An empty value is meaningless for every operator except `exists`,
    // where "false" is the real, intended condition.
    if (row.op !== 'exists' && row.value.trim() === '') continue
    const fieldType = fieldTypes[row.field] ?? 'text'
    out[row.field] = { ...(out[row.field] ?? {}), [row.op]: coerceValue(row.value, fieldType, row.op) }
  }
  return out
}

/** A stored value rendered back into the panel's text input. */
function toText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value)
}

/**
 * Flattens a stored query into editable rows. Operator objects expand to one
 * row each; TangenQL's bare-value shorthand reads as `eq`. Boolean grouping
 * (`_or`/`_and`) has no flat-row representation in v1, so it is SKIPPED
 * rather than mangled - the stored query keeps it, the panel just cannot
 * edit it.
 */
export function queryToRows(query: unknown): FilterRow[] {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return []
  const rows: FilterRow[] = []
  for (const [field, condition] of Object.entries(query as Record<string, unknown>)) {
    if (field.startsWith('_')) continue
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      for (const [op, value] of Object.entries(condition as Record<string, unknown>)) {
        rows.push({ field, op, value: toText(value) })
      }
      continue
    }
    rows.push({ field, op: 'eq', value: toText(condition) })
  }
  return rows
}
