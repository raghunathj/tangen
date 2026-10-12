/**
 * File Name: query-compiler.ts
 * Purpose: Compiles high-level QueryObject and QueryFilter inputs into validated,
 *   SQL-ready CompiledQuery structures used by content list and detail routes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (QueryObject, QueryFilter, SchemaDefinition), ../lib/errors (RequestError).
 */
import { sql, or, and } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { QueryObject, QueryFilter, ObjectStatus, ReferencedByFilter } from '@tangen/types'
import type { SchemaDefinition } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { isSafeIdent, SORTABLE_SYSTEM_FIELDS } from '@tangen/types'

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

/**
 * The furthest a query may expand, ever (closure plan Phase 6A, Unit 6).
 *
 * This is the CONTRACT's ceiling, not a policy: the Gateway's
 * `maxRelationDepth` (default 5, an operator may lower it per workspace)
 * clamps a request below this, and this refuses anything above it whatever
 * the policy says - including on the paths no Gateway clamp reaches, such
 * as the local client inside a custom route. Every expansion consumes it:
 * relations, object fields, the relations nested inside them, and media.
 * The value is the Gateway's own default, so a deployment that never
 * touches its limits sees exactly one number.
 */
export const MAX_RELATION_DEPTH = 5

/**
 * The system fields a query may sort by, in the PUBLIC spelling - the names
 * the content model and every response use (closure plan Phase 6A, Unit 5).
 * A custom field is sorted by its own name, as authored.
 */
export { SORTABLE_SYSTEM_FIELDS }

/**
 * The storage spelling behind each public name. The database's columns are
 * snake_case and the content model is camelCase; the mapping is Tangen's
 * business, so it happens here and nowhere in a client. The snake_case
 * spellings stay ACCEPTED as a pre-v1 compatibility alias (`created_at`
 * works, `createdAt` is what the contract documents) - see docs/tangenql.md.
 */
const SYSTEM_ALIASES: Record<string, string> = {
  createdAt: 'created_at', updatedAt: 'updated_at', publishedAt: 'published_at',
  createdBy: 'created_by', updatedBy: 'updated_by',
}

const SYSTEM_SORT_COLUMNS = new Set([
  'id', 'title', 'slug', 'status', 'created_at', 'updated_at', 'published_at',
])

/**
 * `slug` belongs here with the rest. It was the one system column left out,
 * which made "the page whose slug is this" - the single most common query a
 * website makes - inexpressible in TangenQL. `findBySlug` fetches one object
 * and cannot filter a list, take `in`, or combine with another condition.
 */
const SYSTEM_FILTER_COLUMNS = new Set([
  'id', 'title', 'slug', 'status', 'published_at', 'created_at', 'updated_at', 'created_by', 'updated_by',
])

/**
 * A validated, normalised filter ready for conversion to a SQL WHERE clause fragment.
 * Each variant carries the resolved column name alongside the operator and value(s).
 */
export type CompiledFilter =
  | { op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'; column: string; value: unknown }
  | { op: 'contains' | 'ncontains' | 'startsWith'; column: string; value: string }
  | { op: 'in' | 'nin'; column: string; values: unknown[] }
  | { op: 'array_overlap' | 'array_not_overlap'; column: string; values: unknown[] }
  | { op: 'exists'; column: string; value: boolean }

/** A boolean group of conditions — produced by `_or` / `_and` filter keys. */
export interface CompiledGroup {
  group: 'or' | 'and'
  children: CompiledCondition[]
}

/** A one-level nested relation filter — compiles to an EXISTS subquery. */
export interface CompiledNested {
  nested: true
  /** Resolved column on the source table holding the relation id(s) */
  sourceColumn: string
  /** true when the relation is many:true (text column holding a pg array literal of ids) */
  many: boolean
  /** Target type name — also the target table name */
  targetType: string
  /** The compiled operator condition against the target field */
  condition: CompiledFilter
}

/** A leaf filter, a nested boolean group, or a nested relation filter. */
export type CompiledCondition = CompiledFilter | CompiledGroup | CompiledNested

export interface ReferencedByCompiled {
  /** The source type name (e.g. 'post'). Used to resolve the DB table. */
  sourceType: string
  /** The current column name on the source type (after rename resolution). */
  sourceColumn: string
  /** Restrict source objects by status. null = exclude archived only (default). */
  statusFilter: ObjectStatus | null
}

export interface CompiledQuery {
  typeName: string
  typeId: string
  statusFilter: ObjectStatus | null  // null = no specific status filter
  excludeArchived: boolean           // true by default; false only when status:'any' is explicit
  fieldFilters: CompiledCondition[]
  sortField: string
  sortDirection: 'asc' | 'desc'
  limit: number
  offset: number
  /** Set when the query contains a _referencedBy filter. */
  referencedBy?: ReferencedByCompiled
  /** Set when the query paginates by cursor (`after`). */
  cursor?: CompiledCursor
  /** False when the caller asked for `total: false`: no COUNT is issued, hasMore comes from an extra row. */
  wantTotal: boolean
}

/** Decoded keyset cursor: the last row's sort value and id (tiebreak). */
export interface CompiledCursor {
  sortValue: unknown
  id: string
}

/** Column key carrying the sort value at the database's own precision. */
export const CURSOR_SORT = '__cursor_sort'

/**
 * A timestamp read through the driver is a JS Date: millisecond precision,
 * while the column holds microseconds. A cursor built from that Date compares
 * (desc) below every row that shares its millisecond, and a keyset walk
 * silently loses a row at the page boundary - one in ~1,900 on a corpus
 * written at eight rows in flight. When the sort column is a timestamp the
 * page selects the value as text as well, and the cursor carries THAT: the
 * exact value the predicate compares against.
 * @returns The extra selection to spread into the page select, or null when
 *          the sort column is not a timestamp.
 */
export function cursorSortSelection(table: Record<string, unknown>, sortJsKey: string): Record<string, SQL> | null {
  const col = table[sortJsKey] as { name?: string; columnType?: string } | undefined
  if (!col?.name || !String(col.columnType ?? '').startsWith('PgTimestamp')) return null
  // Aliased, or the output column is also named after the sort column and ORDER BY becomes ambiguous.
  return { [CURSOR_SORT]: sql<string>`${sql.raw(`"${col.name}"`)}::text`.as(CURSOR_SORT) }
}

/** The value a next-page cursor is built from: the exact text when it was selected, the column otherwise. */
export function cursorSortValue(row: Record<string, unknown>, sortJsKey: string): unknown {
  return row[CURSOR_SORT] ?? row[sortJsKey] ?? null
}

/**
 * Encodes a keyset cursor as base64url JSON `[sortValue, id]`.
 * @param sortValue - The sort column's value on the last row of the page.
 * @param id - The last row's id (tiebreak).
 */
export function encodeCursor(sortValue: unknown, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id])).toString('base64url')
}

/**
 * Decodes an `after` cursor produced by encodeCursor.
 * @throws RequestError VALIDATION_ERROR when the cursor is malformed.
 */
export function decodeCursor(after: string): CompiledCursor {
  try {
    const parsed = JSON.parse(Buffer.from(after, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[1] !== 'string') {
      throw new Error('bad shape')
    }
    return { sortValue: parsed[0], id: parsed[1] }
  } catch {
    throw new RequestError('VALIDATION_ERROR', 'Invalid "after" cursor')
  }
}

/**
 * Renders the EXISTS predicate for a _referencedBy filter: match target rows
 * whose id appears in the source type's many-relation column.
 * @param rb - Compiled _referencedBy descriptor.
 * @param targetType - The queried (target) type name = its table name.
 * @param workspaceId - Workspace scope for the source-table subquery.
 */
export function referencedByToSQL(rb: ReferencedByCompiled, targetType: string, workspaceId: string): SQL {
  const srcTable  = sql.raw(`"${rb.sourceType}"`)
  const srcCol    = sql.raw(`"${rb.sourceColumn}"`)
  const targetId  = sql.raw(`"${targetType}".id`)
  const statusClause = rb.statusFilter
    ? sql`AND s.status = ${rb.statusFilter}`
    : sql`AND s.status != ${'archived'}`
  return sql`EXISTS (
    SELECT 1 FROM ${srcTable} s
    WHERE s.workspace_id = ${workspaceId}
    AND ${asTextArray(sql`s.${srcCol}`)} @> ARRAY[${targetId}]::text[]
    ${statusClause}
  )`
}

/**
 * Renders the keyset predicate for a cursor: a row comparison on
 * (sortField, id) so ties on the sort value break deterministically by id.
 * Pair with an ORDER BY that includes id as the secondary sort in the same
 * direction. Note: rows with a NULL sort value do not participate in row
 * comparison — cursor-paginate on non-null columns (created_at, id, title).
 */
export function cursorToSQL(
  cursor: CompiledCursor,
  sortField: string,
  sortDirection: 'asc' | 'desc',
): SQL {
  const col = sql.raw(`"${sortField}"`)
  return sortDirection === 'desc'
    ? sql`(${col}, "id") < (${cursor.sortValue}, ${cursor.id})`
    : sql`(${col}, "id") > (${cursor.sortValue}, ${cursor.id})`
}

type TypeDef = SchemaDefinition['types'][number]

/**
 * Converts a single CompiledFilter to a Drizzle SQL fragment.
 * @param f - The compiled filter to convert.
 * @returns A Drizzle SQL template literal fragment.
 */
export function filterToSQL(f: CompiledFilter, tableAlias?: string, colOverride?: SQL): SQL {
  const col = colOverride ?? sql.raw(tableAlias ? `"${tableAlias}"."${f.column}"` : `"${f.column}"`)
  switch (f.op) {
    case 'eq':            return sql`${col} = ${f.value}`
    case 'ne':            return sql`${col} != ${f.value}`
    case 'gt':            return sql`${col} > ${f.value}`
    case 'lt':            return sql`${col} < ${f.value}`
    case 'gte':           return sql`${col} >= ${f.value}`
    case 'lte':           return sql`${col} <= ${f.value}`
    case 'contains':      return sql`${col} ILIKE ${'%' + f.value + '%'}`
    case 'ncontains':     return sql`${col} NOT ILIKE ${'%' + f.value + '%'}`
    case 'startsWith':    return sql`${col} ILIKE ${f.value + '%'}`
    case 'in':
      return f.values.length > 0
        ? sql`${col} IN (${sql.join(f.values.map(v => sql`${v}`), sql.raw(', '))})`
        : sql`FALSE`
    case 'nin':
      return f.values.length > 0
        ? sql`${col} NOT IN (${sql.join(f.values.map(v => sql`${v}`), sql.raw(', '))})`
        : sql`TRUE`
    case 'array_overlap':
      return f.values.length > 0
        ? sql`${asTextArray(col)} && ARRAY[${sql.join(f.values.map(v => sql`${v}`), sql.raw(', '))}]::text[]`
        : sql`FALSE`
    case 'array_not_overlap':
      return f.values.length > 0
        ? sql`NOT (${asTextArray(col)} && ARRAY[${sql.join(f.values.map(v => sql`${v}`), sql.raw(', '))}]::text[])`
        : sql`TRUE`
    case 'exists':
      return f.value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`
  }
}

/**
 * Build a Drizzle select-shape for column projection.
 * Returns undefined when props is empty/absent — caller uses plain db.select() for full select.
 * id is always included so expansion and client-side joins always have it.
 * @param table - The Drizzle table object with column references.
 * @param props - The field names to select, or undefined for all.
 * @returns A column selection record, or undefined for full select.
 */
export const MAX_GROUP_DEPTH = 4

/** Runtime context needed to render nested relation filters. */
export interface ConditionSQLContext {
  workspaceId: string
  /** The source type name (= source table name) the query targets */
  sourceTypeName: string
  /** Non-default locale: filters/sorts on these columns read the side table first. */
  i18n?: { locale: string; localizedColumns: Set<string> }
}

/**
 * Column expression for a localized field in a non-default locale:
 * COALESCE((SELECT the side-table value for this object+locale), main column).
 * `title` reads the side table's `__title`. Correlated on the PK — the planner
 * turns it into an index lookup per row.
 */
export function localizedColumnExpr(typeName: string, column: string, locale: string): SQL {
  const sideCol = column === 'title' ? '__title' : column
  const sideTable = sql.raw(`"${typeName}_i18n"`)
  const side = sql.raw(`"${sideCol}"`)
  const mainCol = sql.raw(`"${typeName}"."${column}"`)
  return sql`COALESCE((SELECT ${side} FROM ${sideTable} WHERE "object_id" = ${sql.raw(`"${typeName}"."id"`)} AND "locale" = ${locale}), ${mainCol})`
}

/**
 * Converts a CompiledCondition (leaf filter, boolean group, or nested relation
 * filter) to Drizzle SQL. Groups compile to parenthesised OR/AND; nested
 * relation filters compile to workspace/env-scoped EXISTS subqueries against
 * the target table (aliased "_rel" so self-relations bind correctly).
 */
/**
 * Tolerant text[] cast for array-stored fields. The SAME logical field exists
 * in three physical shapes across real databases: a true text[] column, a
 * text column holding a pg array literal ('{a,b}'), and - from the
 * single-relation era - a text column holding ONE bare id (no braces). A
 * naive ::text[] cast 500s on the bare form ("malformed array literal").
 * Route everything through text first, brace-wrap when needed, then cast.
 */
function asTextArray(col: SQL): SQL {
  return sql`(CASE WHEN (${col})::text LIKE '{%' THEN (${col})::text ELSE '{' || (${col})::text || '}' END)::text[]`
}

export function conditionToSQL(c: CompiledCondition, ctx?: ConditionSQLContext): SQL {
  if ('group' in c) {
    const parts = c.children.map((child) => conditionToSQL(child, ctx))
    // children are guaranteed non-empty (empty groups dropped at compile time)
    return (c.group === 'or' ? or(...parts) : and(...parts)) as SQL
  }
  if ('nested' in c) {
    if (!ctx) {
      throw new RequestError('VALIDATION_ERROR', 'Nested relation filters require query context')
    }
    const target = sql.raw(`"${c.targetType}" AS "_rel"`)
    const srcCol = sql.raw(`"${ctx.sourceTypeName}"."${c.sourceColumn}"`)
    // many relations are stored as text columns holding a pg array literal
    // ("{id1,id2}"), so cast before ANY()
    const join = c.many
      ? sql`"_rel"."id" = ANY(${asTextArray(srcCol)})`
      : sql`"_rel"."id" = ${srcCol}`
    return sql`EXISTS (
      SELECT 1 FROM ${target}
      WHERE "_rel"."workspace_id" = ${ctx.workspaceId}
      AND ${join}
      AND ${filterToSQL(c.condition, '_rel')}
    )`
  }
  // Localized field + non-default locale → translated value with fallback
  if (ctx?.i18n && ctx.i18n.localizedColumns.has(c.column)) {
    return filterToSQL(c, undefined, localizedColumnExpr(ctx.sourceTypeName, c.column, ctx.i18n.locale))
  }
  return filterToSQL(c)
}

/**
 */
export function buildSelectColumns(
  table: Record<string, unknown>,
  props: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!props || props.length === 0) return undefined
  const cols: Record<string, unknown> = {}
  if (table.id !== undefined) cols.id = table.id
  for (const prop of props) {
    if (prop !== 'id' && table[prop] !== undefined) {
      cols[prop] = table[prop]
    }
  }
  return cols
}

/**
 * Compiles a QueryFilter against a fixed set of allowed column names (for custom tables).
 * @param queryFilter - The raw filter from the client request.
 * @param allowedColumns - Column names that are valid for this table.
 * @returns An array of CompiledFilter ready for filterToSQL.
 */
/**
 * Normalizes the bare-value eq shorthand the QueryFilter type promises:
 * `{ title: 'Hello' }` → `{ title: { eq: 'Hello' } }`. A bare null becomes
 * `{ exists: false }` (SQL `= NULL` never matches, which is never what the
 * caller meant). Objects pass through untouched; arrays stay invalid —
 * they are ambiguous (use `in` / `nin` explicitly).
 */
function normalizeCondition(condition: unknown): unknown {
  if (condition === null) return { exists: false }
  const t = typeof condition
  if (t === 'string' || t === 'number' || t === 'boolean') return { eq: condition }
  return condition
}

/**
 * The underscore keys the query object owns; anything else beginning with an
 * underscore is a field name, and an unknown one is refused like any other.
 */
const HANDLED_SPECIAL_KEYS = new Set(['_or', '_and', '_referencedBy', '_labels'])

export function compileTableFilters(queryFilter: QueryFilter, allowedColumns: Set<string>): CompiledFilter[] {
  const compiled: CompiledFilter[] = []

  for (let [fieldName, rawCondition] of Object.entries(queryFilter)) {
    if (fieldName.startsWith('_')) continue
    const condition = normalizeCondition(rawCondition)

    if (!allowedColumns.has(fieldName)) {
      throw new RequestError('FIELD_NOT_FOUND', `Unknown filter field: "${fieldName}"`)
    }
    if (!isSafeIdent(fieldName)) {
      throw new RequestError('VALIDATION_ERROR', `Invalid filter field identifier: "${fieldName}"`)
    }
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      throw new RequestError('VALIDATION_ERROR', `Filter for "${fieldName}" must be an object with operator keys`)
    }

    for (const [op, value] of Object.entries(condition as Record<string, unknown>)) {
      switch (op) {
        case 'eq': case 'ne': case 'gt': case 'lt': case 'gte': case 'lte':
          compiled.push({ op, column: fieldName, value })
          break
        case 'contains': case 'ncontains': case 'startsWith':
          if (typeof value !== 'string') {
            throw new RequestError('VALIDATION_ERROR', `"${op}" requires a string value for field "${fieldName}"`)
          }
          compiled.push({ op, column: fieldName, value })
          break
        case 'in': case 'nin':
          if (!Array.isArray(value)) {
            throw new RequestError('VALIDATION_ERROR', `"${op}" requires an array value for field "${fieldName}"`)
          }
          compiled.push({ op, column: fieldName, values: value })
          break
        case 'exists':
          compiled.push({ op: 'exists', column: fieldName, value: Boolean(value) })
          break
        default:
          throw new RequestError('VALIDATION_ERROR', `Unknown filter operator: "${op}"`)
      }
    }
  }

  return compiled
}

/**
 * Builds a lookup map from every name a field has ever had to its current column name.
 * Handles renames tracked via previousName[] so old client queries still resolve correctly.
 * @param typeDef - The content type whose fields to index.
 * @returns A Map of historical/current field name → current column name.
 */
// Maps every name a field has ever had (current + previousName[]) → its current column name.
export function buildFieldLookup(typeDef: TypeDef): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const f of typeDef.fields) {
    lookup.set(f.name, f.name)
    for (const prev of f.previousName ?? []) {
      lookup.set(prev, f.name)
    }
  }
  return lookup
}

// Fields stored as PostgreSQL arrays (text[]) require overlap operator instead of scalar IN
const ARRAY_FIELD_TYPES = new Set(['multiselect', 'tags'])

/** Array-stored fields: multiselect/tags always; relations when many:true. */
function isArrayStoredField(f: { fieldType: string; config?: unknown }): boolean {
  if (ARRAY_FIELD_TYPES.has(f.fieldType)) return true
  return f.fieldType === 'relation' && (f.config as { many?: boolean } | undefined)?.many === true
}

/**
 * Validates and compiles a QueryFilter into a list of CompiledFilters for a given type.
 * Resolves renamed field references, promotes IN/NIN to array-overlap for text[] columns,
 * and throws RequestError on unknown fields or invalid operators.
 * @param queryFilter - The raw filter object from the API request.
 * @param typeDef - The content type definition providing field metadata.
 * @returns Array of CompiledFilter descriptors ready for SQL generation.
 */
function compileOps(
  fieldName: string,
  column: string,
  condition: Record<string, unknown>,
  arrayFields: Set<string>,
): CompiledFilter[] {
  const compiled: CompiledFilter[] = []
  for (const [op, value] of Object.entries(condition)) {
    switch (op) {
      case 'eq':
      case 'ne':
      case 'gt':
      case 'lt':
      case 'gte':
      case 'lte':
        compiled.push({ op, column, value })
        break
      case 'contains':
      case 'ncontains':
      case 'startsWith':
        if (typeof value !== 'string') {
          throw new RequestError('VALIDATION_ERROR', `"${op}" requires a string value for field "${fieldName}"`)
        }
        compiled.push({ op, column, value })
        break
      case 'in':
      case 'nin':
        if (!Array.isArray(value)) {
          throw new RequestError('VALIDATION_ERROR', `"${op}" requires an array value for field "${fieldName}"`)
        }
        // multiselect columns are stored as text[] — use overlap operators, not scalar IN/NOT IN
        if (op === 'in' && arrayFields.has(column)) {
          compiled.push({ op: 'array_overlap', column, values: value })
        } else if (op === 'nin' && arrayFields.has(column)) {
          compiled.push({ op: 'array_not_overlap', column, values: value })
        } else {
          compiled.push({ op, column, values: value })
        }
        break
      case 'exists':
        compiled.push({ op: 'exists', column, value: Boolean(value) })
        break
      default:
        throw new RequestError('VALIDATION_ERROR', `Unknown filter operator: "${op}"`)
    }
  }
  return compiled
}

export function compileFieldFilters(
  queryFilter: QueryFilter,
  typeDef: TypeDef,
  schema?: SchemaDefinition,
): CompiledCondition[] {
  const fieldLookup = buildFieldLookup(typeDef)
  const arrayFields = new Set(typeDef.fields.filter(isArrayStoredField).map(f => f.name))

  const allowedColumns = new Set([
    ...SYSTEM_FILTER_COLUMNS,
    ...fieldLookup.keys(),
  ])

  function assertConditionObject(fieldName: string, condition: unknown): asserts condition is Record<string, unknown> {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      throw new RequestError('VALIDATION_ERROR', `Filter for "${fieldName}" must be an object with operator keys`)
    }
  }

  function compileLevel(filter: QueryFilter, depth: number): CompiledCondition[] {
    if (depth > MAX_GROUP_DEPTH) {
      throw new RequestError('VALIDATION_ERROR', `Filter group nesting exceeds max depth of ${MAX_GROUP_DEPTH}`)
    }

    const compiled: CompiledCondition[] = []

    for (let [fieldName, rawCondition] of Object.entries(filter)) {
      // Groups keep their raw array; field conditions get the eq shorthand normalized
      const condition = (fieldName === '_or' || fieldName === '_and')
        ? rawCondition
        : normalizeCondition(rawCondition)

      // Boolean groups — arrays of sub-filters combined with OR / AND
      if (fieldName === '_or' || fieldName === '_and') {
        if (!Array.isArray(condition)) {
          throw new RequestError('VALIDATION_ERROR', `"${fieldName}" must be an array of filter objects`)
        }
        const children: CompiledCondition[] = []
        for (const sub of condition as QueryFilter[]) {
          const subCompiled = compileLevel(sub, depth + 1)
          if (subCompiled.length === 1) children.push(subCompiled[0])
          else if (subCompiled.length > 1) children.push({ group: 'and', children: subCompiled })
        }
        if (children.length > 0) {
          compiled.push({ group: fieldName === '_or' ? 'or' : 'and', children })
        }
        continue
      }

      // The special top-level keys are handled before this function is called
      // (`_referencedBy`, `labels`/`_labels`); an underscore key that is NOT
      // one of them is an unknown field, and saying so beats ignoring it -
      // a filter on a guarded column (`_dropped__…`) used to compile to
      // nothing at all and answer as though it had matched (Phase 6B, Unit 8).
      if (fieldName.startsWith('_')) {
        if (HANDLED_SPECIAL_KEYS.has(fieldName)) continue
        throw new RequestError('FIELD_NOT_FOUND', `Unknown filter field: "${fieldName}"`)
      }

      // camelCase system aliases (createdAt → created_at) — schema fields win on clash
      if (SYSTEM_ALIASES[fieldName] && !fieldLookup.has(fieldName)) fieldName = SYSTEM_ALIASES[fieldName]

      // Nested relation filter: "relationField.targetField"
      if (fieldName.includes('.')) {
        const parts = fieldName.split('.')
        if (parts.length !== 2) {
          throw new RequestError('VALIDATION_ERROR', `Nested filters support one level only ("relation.field") - got "${fieldName}"`)
        }
        if (!schema) {
          throw new RequestError('VALIDATION_ERROR', 'Nested relation filters are not available in this context')
        }
        const [relName, targetFieldName] = parts
        const relColumn = fieldLookup.get(relName) ?? relName
        const relField = typeDef.fields.find(f => f.name === relColumn)
        if (!relField || relField.fieldType !== 'relation' || !relField.config?.targetType) {
          throw new RequestError('VALIDATION_ERROR', `"${relName}" is not a relation field - nested filters require a relation prefix`)
        }
        const targetDef = schema.types.find(t => t.name === relField.config.targetType)
        if (!targetDef) {
          throw new RequestError('TYPE_NOT_FOUND', `Relation target type "${relField.config.targetType}" not found in schema`)
        }
        const targetLookup = buildFieldLookup(targetDef)
        const targetAllowed = new Set([...SYSTEM_FILTER_COLUMNS, ...targetLookup.keys()])
        if (!targetAllowed.has(targetFieldName)) {
          throw new RequestError('FIELD_NOT_FOUND', `Unknown filter field: "${targetFieldName}" on type "${targetDef.name}"`)
        }
        const targetColumn = targetLookup.get(targetFieldName) ?? targetFieldName
        assertConditionObject(fieldName, condition)
        const targetArrayFields = new Set(targetDef.fields.filter(isArrayStoredField).map(f => f.name))
        for (const leaf of compileOps(targetFieldName, targetColumn, condition, targetArrayFields)) {
          compiled.push({
            nested: true,
            sourceColumn: relColumn,
            many: relField.config.many === true,
            targetType: relField.config.targetType,
            condition: leaf,
          })
        }
        continue
      }

      if (!allowedColumns.has(fieldName)) {
        throw new RequestError('FIELD_NOT_FOUND', `Unknown filter field: "${fieldName}"`)
      }
      if (!isSafeIdent(fieldName)) {
        throw new RequestError('VALIDATION_ERROR', `Invalid filter field identifier: "${fieldName}"`)
      }
      assertConditionObject(fieldName, condition)

      // Resolve renamed fields: use current column name, not the (possibly old) query key
      const column = fieldLookup.get(fieldName) ?? fieldName
      compiled.push(...compileOps(fieldName, column, condition, arrayFields))
    }

    return compiled
  }

  return compileLevel(queryFilter, 1)
}

/**
 * Validates and compiles a full QueryObject into a CompiledQuery ready for execution.
 * Resolves status semantics, validates sort fields, clamps limit/offset, and handles
 * the optional _referencedBy reverse-relation filter.
 * @param input - The raw QueryObject from the API request.
 * @param schema - Full schema definition for type and field lookup.
 * @returns A CompiledQuery with all fields validated and normalised.
 * @throws RequestError when the type, sort field, or _referencedBy references are invalid.
 */
/**
 * Options the caller resolves per request.
 */
export interface CompileQueryOptions {
  /**
   * The most rows one read may return. Defaults to MAX_LIMIT; the REST
   * routes pass the Gateway's resolved `requestLimits.maxQueryLimit`, which
   * an operator may set above the constant and a workspace only below it.
   */
  maxLimit?: number
}

export function compileBaseQuery(input: QueryObject, schema: SchemaDefinition, opts: CompileQueryOptions = {}): CompiledQuery {
  const typeDef = schema.types.find(t => t.name === input.type)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${input.type}" not found in schema`)
  }

  const isAny = !input.status || input.status === 'any'
  const statusFilter = isAny ? null : input.status as ObjectStatus
  const excludeArchived = !input.status  // true only when no status param given at all

  // Extract and validate _referencedBy before passing the rest to compileFieldFilters
  let referencedBy: ReferencedByCompiled | undefined
  if (input.query && '_referencedBy' in input.query) {
    const rb = (input.query as Record<string, unknown>)._referencedBy as ReferencedByFilter
    const sourceDef = schema.types.find(t => t.name === rb.type)
    if (!sourceDef) {
      throw new RequestError('TYPE_NOT_FOUND', `_referencedBy: source type "${rb.type}" not found in schema`)
    }
    const sourceField = sourceDef.fields.find(f => f.name === rb.field)
    if (!sourceField) {
      throw new RequestError('FIELD_NOT_FOUND', `_referencedBy: field "${rb.field}" not found on type "${rb.type}"`)
    }
    if (sourceField.fieldType !== 'relation') {
      // Backlink discovery reads relation COLUMNS. A link field stores its
      // destination in JSONB, which that mechanism cannot see, so link
      // backlinks are deliberately not supported in v1 rather than silently
      // matching nothing (closure plan Phase 6B, Unit 14).
      const because = sourceField.fieldType === 'link'
        ? ' (link fields do not participate in backlink discovery in v1)'
        : ''
      throw new RequestError('VALIDATION_ERROR', `_referencedBy: field "${rb.field}" on "${rb.type}" must be a relation field${because}`)
    }
    if (!(sourceField.config as Record<string, unknown>)?.many) {
      throw new RequestError('VALIDATION_ERROR', `_referencedBy: field "${rb.field}" on "${rb.type}" must be many:true`)
    }
    // Resolve current column name (handles renames via previousName)
    const sourceLookup = buildFieldLookup(sourceDef)
    const sourceColumn = sourceLookup.get(rb.field) ?? rb.field
    const rbStatus = rb.status
    referencedBy = {
      sourceType: rb.type,
      sourceColumn,
      statusFilter: (!rbStatus || rbStatus === 'any') ? null : rbStatus as ObjectStatus,
    }
  }

  const fieldFilters = input.query ? compileFieldFilters(input.query, typeDef, schema) : []

  // The public name is the content model's (`createdAt`); the snake_case
  // storage spelling is still accepted, and the mapping stops here.
  const requestedSort = input.sort?.field ?? ''
  const sortField = SYSTEM_ALIASES[requestedSort] ?? (requestedSort || 'created_at')
  const schemaFieldNames = new Set(typeDef.fields.map(f => f.name))
  if (!SYSTEM_SORT_COLUMNS.has(sortField) && !schemaFieldNames.has(sortField)) {
    throw new RequestError(
      'VALIDATION_ERROR',
      `Unknown sort field: "${requestedSort}". Sort by a system field (${SORTABLE_SYSTEM_FIELDS.join(', ')}) `
      + `or a field of "${input.type}"${schemaFieldNames.size ? ` (${[...schemaFieldNames].slice(0, 12).join(', ')}${schemaFieldNames.size > 12 ? ', …' : ''})` : ''}.`,
      422,
      { sort: `Unknown sort field: "${requestedSort}"` },
    )
  }
  if (!isSafeIdent(sortField)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid sort field: "${sortField}"`)
  }

  // Expansion is bounded before anything is executed: a depth that is not a
  // whole number of levels, is negative, or reaches past the ceiling is a
  // request Tangen refuses rather than one it silently reinterprets.
  if (input.depth !== undefined && input.depth !== null) {
    const depth = input.depth as number
    if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > MAX_RELATION_DEPTH) {
      throw new RequestError(
        'VALIDATION_ERROR',
        `Invalid depth: ${JSON.stringify(input.depth)}. Expansion depth is a whole number from 0 to ${MAX_RELATION_DEPTH}.`,
        422,
        { depth: `must be a whole number from 0 to ${MAX_RELATION_DEPTH}` },
      )
    }
  }

  const sortDirection = input.sort?.direction === 'asc' ? 'asc' : 'desc'
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), opts.maxLimit ?? MAX_LIMIT)
  const offset = Math.max(0, input.offset ?? 0)

  let cursor: CompiledCursor | undefined
  if (input.after !== undefined && input.after !== null && input.after !== '') {
    if (offset > 0) {
      throw new RequestError('VALIDATION_ERROR', '"after" (cursor) and "offset" are mutually exclusive')
    }
    cursor = decodeCursor(input.after)
  }

  return {
    typeName: input.type,
    typeId: typeDef.id ?? input.type,
    statusFilter,
    excludeArchived,
    fieldFilters,
    sortField,
    sortDirection,
    wantTotal: input.total !== false,
    limit,
    offset,
    referencedBy,
    cursor,
  }
}
