/**
 * File Name: strip-disabled.ts
 * Purpose: Removes editor-only metadata from component field blocks before they are
 *          returned in API-key (non-admin) responses, hiding draft-only and disabled blocks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Applied only to external REST responses; admin routes receive the
 *                     full block data including _disabled and _label keys.
 */
import type { ObjectTypeDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'

/**
 * Removes blocks with _disabled:true from component fields, and strips
 * internal editor-only keys (_disabled, _label) from included blocks.
 * Applied to all non-admin (API-key) REST responses.
 */
export function stripDisabledBlocks(
  row: Record<string, unknown>,
  typeDef: ObjectTypeDefinition,
): Record<string, unknown> {
  const componentFields = flattenFields(typeDef.fields).filter(f => f.fieldType === 'component').map(f => f.name)
  if (componentFields.length === 0) return row

  const result = { ...row }
  for (const name of componentFields) {
    const val = result[name]
    if (!Array.isArray(val)) continue
    result[name] = (val as Record<string, unknown>[])
      .filter(block => !block._disabled)
      .map(block => {
        const { _disabled, _label, ...rest } = block
        return rest
      })
  }
  return result
}
