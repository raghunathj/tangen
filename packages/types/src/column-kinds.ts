/**
 * File Name: column-kinds.ts
 * Purpose: The ONE mapping from a field type to the PostgreSQL column it is
 *          stored in. The CLI plans DDL from it, codegen writes the generated
 *          content-tables.ts from it, and the API builds its runtime table
 *          objects from it - so the database, the types and the running
 *          process can never disagree about a column's kind.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. A custom (site/extension) field type inherits a
 *          built-in primitive and stores a SCALAR, so TEXT is the default.
 */

export type ColumnKind = 'TEXT' | 'TEXT[]' | 'NUMERIC' | 'BOOLEAN' | 'TIMESTAMPTZ' | 'JSONB' | 'NUMRANGE'

export function fieldTypeToSql(fieldType: string, config?: Record<string, unknown> | null): ColumnKind | null {
  // many:true relations store an id LIST - a real array column, like multiselect/tags
  if (fieldType === 'relation' && (config as { many?: boolean } | undefined)?.many === true) return 'TEXT[]'
  switch (fieldType) {
    case 'range':
      return 'NUMRANGE'
    case 'text':
    case 'slug':
    case 'textarea':
    case 'email':
    case 'url':
    case 'phone':
    case 'select':
    case 'relation':
    case 'media':
    case 'color':
    case 'time':
    case 'code':
      return 'TEXT'
    case 'number':
    case 'currency':
    case 'rating':
      return 'NUMERIC'
    case 'date':
      return 'TIMESTAMPTZ'
    case 'boolean':
      return 'BOOLEAN'
    case 'multiselect':
    case 'tags':
      return 'TEXT[]'
    case 'richtext':
    case 'repeater':
    case 'component':
    case 'json':
    case 'object':
    case 'geopoint':
    case 'link':
      return 'JSONB'
    case 'group':
      return null  // group is an admin-only visual grouping - no DB column
    default:
      return 'TEXT'
  }
}

export function fieldHasColumn(fieldType: string, config?: Record<string, unknown> | null): boolean {
  return fieldTypeToSql(fieldType, config) !== null
}

const INDEXABLE_KINDS: ReadonlySet<string> = new Set(['TEXT', 'TEXT[]', 'NUMERIC', 'BOOLEAN', 'TIMESTAMPTZ'])

export function fieldIsIndexable(fieldType: string, config?: Record<string, unknown> | null): boolean {
  const kind = fieldTypeToSql(fieldType, config)
  return kind !== null && INDEXABLE_KINDS.has(kind)
}

export function fieldIndexMethod(fieldType: string, config?: Record<string, unknown> | null): 'gin' | 'btree' {
  return fieldTypeToSql(fieldType, config) === 'TEXT[]' ? 'gin' : 'btree'
}

/** One column of a content table, as the runtime builder and codegen both see it. */
export interface ContentColumnSpec { name: string; kind: ColumnKind }

/** One content table, by name, with its field columns (system columns are implied). */
export interface ContentTableSpec { name: string; columns: ContentColumnSpec[] }

/** One localized side table (`<type>_i18n`), keyed by the type it belongs to. */
export interface ContentI18nTableSpec { type: string; columns: ContentColumnSpec[] }
