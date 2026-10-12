/**
 * File Name: relation-loader.ts
 * Purpose: Expands relation field IDs in content query results into full related records
 *   via batch DB lookups per target type, with optional multi-level depth, per-field
 *   column projection (populate), and a props-projection helper.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db (contentTables), @tangen/types (flattenFields, SchemaDefinition).
 */
import { eq, and, inArray } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import { applyPublishedSnapshot, coerceNumericFields, stripDisabledFields, stripInternalColumns } from './local-client'
import type { SchemaDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'

/**
 * Minimal descriptor for a relation field extracted from a type definition.
 */
export interface RelationField {
  fieldName: string
  targetTypeName: string
  many: boolean
}

/**
 * Options controlling how expandRelations resolves related records.
 */
export interface ExpandRelationsOptions {
  /** Full schema — required for depth > 1 so nested relation fields can be resolved. */
  schema?: SchemaDefinition
  /** How many levels of relations to expand (default 1). */
  depth?: number
  /** Public published view: only published targets load, served as their publish-time snapshot. */
  publicView?: boolean
  /** Per-relation-field column projection: only these columns (+id) are selected. */
  populate?: Record<string, string[]>
  /** Object ids already on the expansion path — cycle guard (internal). */
  seen?: Set<string>
}

/**
 * Extracts all relation-type field descriptors from a content type definition.
 * Only fields that have a targetType configured are included.
 * @param typeDef - The content type definition to inspect.
 * @returns Array of RelationField descriptors for every valid relation field.
 */
export function getRelationFields(typeDef: SchemaDefinition['types'][number]): RelationField[] {
  return flattenFields(typeDef.fields)
    .filter(f => f.fieldType === 'relation' && (f.config as Record<string, unknown>)?.targetType)
    .map(f => ({
      fieldName: f.name,
      targetTypeName: (f.config as Record<string, unknown>).targetType as string,
      many: (f.config as Record<string, unknown>).many === true,
    }))
}

/**
 * Filters each row to only the specified property keys, dropping all others.
 * If props is empty or absent the rows are returned unchanged.
 * @param rows - Content rows to project.
 * @param props - Allowlist of property names to keep.
 * @returns New row objects containing only the requested properties.
 */
export function applyProps(
  rows: Record<string, unknown>[],
  props: string[] | undefined,
): Record<string, unknown>[] {
  if (!props || props.length === 0) return rows
  const propSet = new Set(props)
  return rows.map(row => {
    const filtered: Record<string, unknown> = {}
    for (const key of propSet) {
      if (key in row) filtered[key] = row[key]
    }
    return filtered
  })
}

/**
 * Extracts the id list from a many-relation value. Handles both real string
 * arrays and the pg array literal ("{id1,id2}") that text-typed relation
 * columns come back as from the database.
 */
function parseIdArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return (val as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1)
    if (!inner) return []
    return inner
      .split(',')
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
  }
  return []
}

/** Builds a drizzle column selection for a populate projection (id always included). */
function projectionColumns(
  table: Record<string, unknown>,
  props: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!props || props.length === 0) return undefined
  const cols: Record<string, unknown> = {}
  if (table.id !== undefined) cols.id = table.id
  for (const prop of props) {
    if (prop !== 'id' && table[prop] !== undefined) cols[prop] = table[prop]
  }
  return cols
}

/**
 * Replaces relation field IDs in a result set with the full related records from the DB.
 * All IDs for each relation field are deduplicated and fetched in parallel; if a target
 * type table does not yet exist the field is set to null (graceful degradation).
 * many:true relations expand to arrays of records; unresolved ids are dropped.
 * With opts.depth > 1 (and opts.schema provided) relations on the related records are
 * expanded recursively; ids already on the expansion path are left raw (cycle guard).
 * With opts.populate, listed relation fields select only the requested columns (+id).
 * @param rows - Content rows whose relation fields contain related-object ID strings.
 * @param relationFields - Descriptors of which fields to expand and their target types.
 * @param db - Drizzle database client.
 * @param workspaceId - Workspace scope for all relation lookups.
 * @param opts - Depth / populate / schema options (omit for classic one-level expansion).
 * @returns A new array of rows with relation IDs replaced by full related record objects.
 */
export async function expandRelations(
  rows: Record<string, unknown>[],
  relationFields: RelationField[],
  db: any,
  workspaceId: string,
  opts?: ExpandRelationsOptions,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0 || relationFields.length === 0) return rows

  const depth = Math.max(1, opts?.depth ?? 1)
  const seen = opts?.seen ?? new Set<string>()
  for (const row of rows) {
    if (typeof row.id === 'string') seen.add(row.id)
  }

  const resolvedMaps = new Map<string, Map<string, Record<string, unknown>>>()

  const disabledTargets = new Set(
    (opts?.schema?.types ?? []).filter((t: any) => t.disabled === true).map((t: any) => t.name as string),
  )

  // Fields pointing at the SAME target type share one lookup (e.g. categories
  // + primaryCategory both target post_category and previously issued two
  // identical-shaped selects per request). Fields with a populate projection
  // keep their own query - their column selection is per-field.
  const grouped = new Map<string, RelationField[]>()
  const solo: RelationField[] = []
  for (const rf of relationFields) {
    if (opts?.populate?.[rf.fieldName]?.length) { solo.push(rf); continue }
    const list = grouped.get(rf.targetTypeName) ?? []
    list.push(rf)
    grouped.set(rf.targetTypeName, list)
  }

  const collectIds = (fields: RelationField[]): string[] => [
    ...new Set(
      fields.flatMap(({ fieldName, many }) =>
        rows
          .flatMap(r => (many ? parseIdArray(r[fieldName]) : [r[fieldName]]))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
          .filter(id => !seen.has(id)),
      ),
    ),
  ]

  const loadTarget = async (
    targetTypeName: string,
    ids: string[],
    populateProps: string[] | undefined,
  ): Promise<Map<string, Record<string, unknown>>> => {
    if (ids.length === 0) return new Map()

    const targetTable = (contentTables as Record<string, any>)[targetTypeName]
    let relatedRows: Record<string, unknown>[]

    if (targetTable) {
      const projection = projectionColumns(targetTable, populateProps)
      relatedRows = await (projection ? db.select(projection) : db.select())
        .from(targetTable)
        .where(and(
          inArray(targetTable.id, ids), eq(targetTable.workspaceId, workspaceId), ...(opts?.publicView ? [eq(targetTable.status, 'published')] : []),
        )) as Record<string, unknown>[]
      if (opts?.publicView) relatedRows = applyPublishedSnapshot(relatedRows, 'published')
      // Numeric columns from the target type read back as strings too.
      const targetTypeDef = opts?.schema?.types.find(t => t.name === targetTypeName)
      relatedRows = coerceNumericFields(relatedRows, targetTypeDef)
      relatedRows = stripDisabledFields(relatedRows, targetTypeDef)
      // Nested relation rows never need their internal columns in a response.
      relatedRows = stripInternalColumns(relatedRows)
    } else {
      // Target type not yet generated — return empty (graceful degradation)
      relatedRows = []
    }

    let tagged = relatedRows.map(r => ({ ...r, type: targetTypeName }))

    // Recurse into the related records' own relations when depth allows.
    // Projected (populated) records skip recursion — their relation columns
    // may not have been selected.
    if (depth > 1 && opts?.schema && !populateProps) {
      const targetTypeDef = opts.schema.types.find(t => t.name === targetTypeName)
      if (targetTypeDef) {
        const nestedFields = getRelationFields(targetTypeDef)
        if (nestedFields.length > 0) {
          tagged = await expandRelations(tagged, nestedFields, db, workspaceId, {
            schema: opts.schema,
            depth: depth - 1,
            seen,
            publicView: opts.publicView,
          })
        }
      }
    }

    const map = new Map<string, Record<string, unknown>>()
    for (const r of tagged) {
      map.set(r.id as string, r)
    }
    return map
  }

  await Promise.all([
    ...[...grouped.entries()].map(async ([targetTypeName, fields]) => {
      // TL-2: a disabled target type never loads — the raw id stays in the payload
      if (disabledTargets.has(targetTypeName)) {
        for (const f of fields) resolvedMaps.set(f.fieldName, new Map())
        return
      }
      const map = await loadTarget(targetTypeName, collectIds(fields), undefined)
      for (const f of fields) resolvedMaps.set(f.fieldName, map)
    }),
    ...solo.map(async (rf) => {
      if (disabledTargets.has(rf.targetTypeName)) {
        resolvedMaps.set(rf.fieldName, new Map())
        return
      }
      resolvedMaps.set(rf.fieldName, await loadTarget(rf.targetTypeName, collectIds([rf]), opts?.populate?.[rf.fieldName]))
    }),
  ])

  return rows.map(row => {
    const expanded = { ...row }
    for (const { fieldName, many } of relationFields) {
      const map = resolvedMaps.get(fieldName)
      const val = row[fieldName]
      if (many) {
        // ids on the expansion path (cycle guard) stay raw; missing records are dropped
        expanded[fieldName] = parseIdArray(val)
          .map(id => map?.get(id) ?? (seen.has(id) && !map?.has(id) ? id : null))
          .filter((r): r is Record<string, unknown> | string => r !== null)
      } else if (typeof val === 'string' && val.length > 0 && map) {
        // ids on the expansion path (cycle guard) stay raw; missing records → null
        expanded[fieldName] = map.get(val) ?? (seen.has(val) && !map.has(val) ? val : null)
      } else {
        expanded[fieldName] = null
      }
    }
    return expanded
  })
}
