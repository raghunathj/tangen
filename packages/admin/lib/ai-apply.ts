/**
 * File Name: ai-apply.ts
 * Purpose: Pure merge logic for applying an AI generation preview — the fields
 *          the admin accepted plus ids of newly created related objects become
 *          one { title?, values } patch for the editor's setField/save.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: applying always results in a DRAFT save — publishing
 *          stays an explicit human action.
 */

export interface GeneratePreviewShape {
  title?: string
  fields: Record<string, { value: unknown; display?: string }>
  unresolved: { field: string; suggestion: unknown }[]
  toCreate: { type: string; title: string; forField: string }[]
  /** Image-generation offers for eligible media fields (prompt only - the
   *  panel generates through /admin/ai/image). Never treated as field values:
   *  only acceptedImages entries, carrying a member-witnessed generated asset,
   *  can reach the patch. */
  images?: Record<string, { prompt: string }>
}

export interface ApplyPatch {
  title?: string
  values: Record<string, unknown>
}

/**
 * Builds the field patch from an accepted subset of a generation preview.
 * Created related-object ids merge into their relation field: appended for
 * many relations (starting a fresh array if nothing was accepted), assigned
 * for single relations. Accepted generated images (asset values the member
 * watched generate) assign their media field - preview.images itself never
 * reaches the patch.
 */
export function buildApplyPatch(input: {
  preview: GeneratePreviewShape
  acceptedFields: Set<string>
  acceptTitle: boolean
  created: { forField: string; id: string }[]
  manyFields: Set<string>
  /** Accepted image offers with their generated asset value (the same shape
   *  the tagged-field image mode applies to a media field). */
  acceptedImages?: { field: string; value: unknown }[]
}): ApplyPatch {
  const { preview, acceptedFields, acceptTitle, created, manyFields, acceptedImages } = input
  const values: Record<string, unknown> = {}

  for (const [name, fv] of Object.entries(preview.fields)) {
    if (acceptedFields.has(name)) values[name] = fv.value
  }

  for (const { forField, id } of created) {
    if (manyFields.has(forField)) {
      const existing = values[forField]
      values[forField] = Array.isArray(existing) ? [...existing, id] : [id]
    } else {
      values[forField] = id
    }
  }

  for (const { field, value } of acceptedImages ?? []) {
    values[field] = value
  }

  return {
    ...(acceptTitle && preview.title ? { title: preview.title } : {}),
    values,
  }
}
