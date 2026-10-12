/**
 * File Name: column-types.ts
 * Purpose: The field type to Postgres column type mapping, and the identifier
 *          guard, in one dependency-free module so the planner (read-only), the
 *          apply (transactional) and the plan printer all agree on which fields
 *          carry a column and what that column is.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. `fieldTypeToSql` is re-exported from apply.ts for
 *          the callers that always imported it from there. It is THE mapping:
 *          diff derives the cast tier of a type change from it, the planner
 *          renders DDL from it, codegen's fieldTypeToDrizzleCall and
 *          @tangen/schema's expectedSqlKind mirror it, and
 *          column-mapping.test.ts pins all four to each other for every field
 *          type. Index eligibility and the index method (GIN for arrays) come
 *          from the column kind too, so codegen and the planner declare the
 *          same indexes.
 */
import { isSafeIdent, safeIdent as safeId } from '@tangen/types'


/** The Postgres column families push creates. */
export type { ColumnKind } from '@tangen/types'
export { fieldTypeToSql, fieldHasColumn, fieldIsIndexable, fieldIndexMethod } from '@tangen/types'
import { fieldTypeToSql, fieldIndexMethod } from '@tangen/types'

export type CastTier = 1 | 2 | 3

const SCALAR_FROM_TEXT: ReadonlySet<string> = new Set(['NUMERIC', 'BOOLEAN', 'TIMESTAMPTZ', 'TEXT[]'])

/** The tier of a change from one column kind to another (null = no column, e.g. a group). */
export function classifyColumnChange(from: string | null, to: string | null): CastTier {
  if (from === to) return 1
  if (from === null || to === null) return 3
  if (from === 'TEXT' && SCALAR_FROM_TEXT.has(to)) return 2
  if (to === 'TEXT' && SCALAR_FROM_TEXT.has(from)) return 2
  return 3
}

/**
 * The USING expression that converts an existing column from one kind to
 * another - the same expression for the main column and the localized side
 * column. Only the tier-2 pairs have one; anything else returns the column
 * unchanged (callers never plan a cast for those).
 */
export function castExpression(column: string, from: string | null, to: string | null): string {
  const q = `"${safeId(column)}"`
  if (from === to || from === null || to === null) return q
  if (to === 'TEXT') return from === 'TEXT[]' ? `array_to_string(${q}, ',')` : `${q}::TEXT`
  if (from !== 'TEXT') return q
  if (to === 'TEXT[]') return `(CASE WHEN ${q} IS NULL OR ${q} = '' THEN NULL WHEN ${q} LIKE '{%' THEN ${q}::text[] ELSE ARRAY[${q}] END)`
  return `NULLIF(${q}, '')::${to}`
}

/** Column kinds an index is meaningful on: B-tree for scalars, GIN for arrays. JSONB and ranges are not indexed by `index: true`. */

/** True when `index: true` on a field of this type creates an index (codegen declares one exactly then). */

/** The index method for a field's column: GIN on arrays (containment queries), B-tree otherwise. */

/** The name push gives a field index. */
export function fieldIndexName(typeName: string, fieldName: string): string {
  return `${typeName}_${fieldName}_idx`
}

/** The CREATE INDEX statement for a field, the one place it is rendered. */
export function fieldIndexDdl(typeName: string, fieldName: string, fieldType: string, config?: Record<string, unknown> | null): string {
  const name = fieldIndexName(typeName, fieldName)
  const tbl = safeId(typeName)
  const col = safeId(fieldName)
  return fieldIndexMethod(fieldType, config) === 'gin'
    ? `CREATE INDEX IF NOT EXISTS "${name}" ON "${tbl}" USING GIN ("${col}")`
    : `CREATE INDEX IF NOT EXISTS "${name}" ON "${tbl}" ("${col}")`
}

// The identifier contract lives in @tangen/types (Phase 6B, Unit 7) so the
// modules that used to carry their own copy of this regex cannot drift. It is
// imported (this file calls it) and re-exported (its callers import it here).
export { isSafeIdent, safeId }

/**
 * The Postgres column type for a field, or null when the field carries no
 * column at all (`group` is an admin-only visual grouping).
 */

/** True when a field of this type owns a physical column on its type table. */
