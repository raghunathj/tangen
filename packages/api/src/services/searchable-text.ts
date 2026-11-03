/**
 * File Name: searchable-text.ts
 * Purpose: What of a content row is searchable text - independent of any engine.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lifted out of the previous engine's service when that was
 *   removed. It never had anything to do with which engine stored the result:
 *   it answers "which fields hold prose, and what does that prose say", which is
 *   a question about the schema. Richtext arrives as a ProseMirror node tree, so
 *   it has to be walked rather than stringified.
 */
import type { SchemaDefinition } from '@tangen/types'
import { contentDocText } from '@tangen/types'

const TEXT_FIELD_TYPES = new Set(['text', 'textarea', 'richtext'])

/**
 * Plain text from a richtext document, for the search column.
 *
 * `contentDocText` with a SPACE separator: all that matters for a search
 * index is that words from two blocks do not fuse into one token. The
 * previous walker here put a space between every child rather than at block
 * boundaries, which split hyphenated and marked-up words apart.
 */
const extractRichtextText = (node: unknown): string => contentDocText(node, { separator: ' ' })

/**
 * Every searchable word in a content row: text, textarea and richtext fields,
 * joined. Fields of other types hold values, not prose, and are filtered on
 * instead of searched.
 *
 * @param row - The raw database row.
 * @param typeDef - The schema type, which decides which fields count.
 * @returns One space-joined string.
 */
export function extractSearchableText(
  row: Record<string, unknown>,
  typeDef: SchemaDefinition['types'][number],
): string {
  const parts: string[] = []
  for (const field of typeDef.fields) {
    if (!TEXT_FIELD_TYPES.has(field.fieldType)) continue
    const value = row[field.name]
    if (!value) continue
    if (field.fieldType === 'richtext' && typeof value === 'object') {
      parts.push(extractRichtextText(value))
    } else if (typeof value === 'string') {
      parts.push(value)
    }
  }
  return parts.join(' ').trim()
}
