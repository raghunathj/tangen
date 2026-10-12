/**
 * File Name: object-loader.ts
 * Purpose: Expands typed object-reference fields in content rows into full records,
 *   fetching each referenced type in parallel and supporting recursive depth expansion.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db (contentTables), @tangen/types (flattenFields, SchemaDefinition).
 */
import { eq, and, inArray } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import { applyPublishedSnapshot } from './local-client'
import type { SchemaDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'

interface Ref { id: string; type: string }

/**
 * Metadata describing a single object-type field extracted from a type definition.
 */
export interface ObjectFieldMeta {
  fieldName: string
  many: boolean
}

/**
 * Extracts all object-type field descriptors from a content type definition.
 * @param typeDef - The content type definition to inspect.
 * @returns Array of ObjectFieldMeta for every field with fieldType 'object'.
 */
export function getObjectFields(typeDef: SchemaDefinition['types'][number]): ObjectFieldMeta[] {
  return flattenFields(typeDef.fields)
    .filter(f => f.fieldType === 'object')
    .map(f => ({
      fieldName: f.name,
      many: !!((f.config as Record<string, unknown>)?.many),
    }))
}

function isRef(v: unknown): v is Ref {
  return !!v && typeof v === 'object' && typeof (v as Ref).id === 'string' && typeof (v as Ref).type === 'string'
}

/**
 * Replaces object-reference values in content rows with the full referenced records.
 * References from all rows are grouped by type and fetched in parallel; nested objects
 * are recursively expanded up to remainingDepth levels deep.
 * @param rows - Content rows containing Ref objects or arrays of Refs.
 * @param objectFields - Descriptors of which fields to expand and whether they are many.
 * @param db - Drizzle database client.
 * @param workspaceId - Workspace scope for all lookups.
 * @param schema - Full schema definition used to resolve nested object fields.
 * @param remainingDepth - How many more levels of nesting to expand (0 = stop).
 * @returns A new array of rows with Ref values replaced by full record objects.
 */
export async function expandObjectFields(
  rows: Record<string, unknown>[],
  objectFields: ObjectFieldMeta[],
  db: any,
  workspaceId: string,
  schema: SchemaDefinition,
  remainingDepth: number,
  /** Public published view: only published refs load, as their publish snapshot. */
  publicView = false,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0 || objectFields.length === 0) return rows

  // Collect all refs, grouped by type
  const refsByType = new Map<string, Set<string>>()
  for (const { fieldName, many } of objectFields) {
    for (const row of rows) {
      const val = row[fieldName]
      const refs: Ref[] = many
        ? (Array.isArray(val) ? (val as unknown[]).filter(isRef) : [])
        : isRef(val) ? [val] : []
      for (const ref of refs) {
        if (!refsByType.has(ref.type)) refsByType.set(ref.type, new Set())
        refsByType.get(ref.type)!.add(ref.id)
      }
    }
  }

  if (refsByType.size === 0) return rows

  // Fetch from each type's table in parallel
  const fetchedByType = new Map<string, Map<string, Record<string, unknown>>>()

  await Promise.all(
    Array.from(refsByType.entries()).map(async ([type, ids]) => {
      const table = (contentTables as Record<string, any>)[type]
      if (!table) { fetchedByType.set(type, new Map()); return }

      let fetched = (await db
        .select()
        .from(table)
        .where(and(
          inArray(table.id, Array.from(ids)),
          eq(table.workspaceId, workspaceId),
          ...(publicView ? [eq(table.status, 'published')] : []),
        ))) as Record<string, unknown>[]
      if (publicView) fetched = applyPublishedSnapshot(fetched, 'published')

      // Tag each fetched row with its type, then recurse if depth allows
      fetched = fetched.map(r => ({ ...r, type }))

      if (remainingDepth > 1) {
        const targetTypeDef = schema.types.find(t => t.name === type)
        if (targetTypeDef) {
          const nested = getObjectFields(targetTypeDef)
          if (nested.length > 0) {
            fetched = await expandObjectFields(fetched, nested, db, workspaceId, schema, remainingDepth - 1, publicView)
          }
        }
      }

      const map = new Map<string, Record<string, unknown>>()
      for (const r of fetched) map.set(r.id as string, r)
      fetchedByType.set(type, map)
    }),
  )

  // Substitute refs with full objects
  return rows.map(row => {
    const out = { ...row }
    for (const { fieldName, many } of objectFields) {
      const val = row[fieldName]
      if (many) {
        const arr = Array.isArray(val) ? (val as unknown[]).filter(isRef) : []
        out[fieldName] = arr
          .map(ref => fetchedByType.get((ref as Ref).type)?.get((ref as Ref).id) ?? null)
          .filter(Boolean)
      } else {
        out[fieldName] = isRef(val)
          ? (fetchedByType.get(val.type)?.get(val.id) ?? null)
          : null
      }
    }
    return out
  })
}
