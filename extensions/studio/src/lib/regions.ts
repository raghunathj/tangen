/**
 * File Name: regions.ts
 * Purpose: A page's editable regions - one per component field - and which
 *          one Studio is currently editing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio used to take the FIRST component field and
 *          ignore the rest, so a type with `sections` and `footerBlocks` had
 *          half its content unreachable on the canvas. A region is edited at
 *          a time, chosen the way a preview width is chosen - the site's
 *          template decides whether two regions even render adjacently, so
 *          Studio cannot honestly show both at once.
 */
import type { FieldDefinition } from '@tangen/types'

export interface PageRegion {
  /** The component field this region edits. */
  name: string
  label: string
  field: FieldDefinition
}

/** Hidden from the editor by config or by soft-disable. */
function excluded(field: FieldDefinition): boolean {
  return field.disabled === true || field.admin?.hidden === true
}

/** The component fields of a type, in declaration order. */
export function pageRegions(fields: FieldDefinition[] | undefined): PageRegion[] {
  if (!Array.isArray(fields)) return []
  return fields
    .filter((f) => f.fieldType === 'component' && !excluded(f))
    .map((f) => ({ name: f.name, label: f.label || f.name, field: f }))
}

/**
 * The region to edit given the one last chosen. Selection carries across page
 * switches, and the new type may not have that field - falling back beats an
 * editor pointed at nothing.
 */
export function resolveRegion(regions: PageRegion[], wanted: string | null): string | null {
  if (regions.length === 0) return null
  return regions.some((r) => r.name === wanted) ? wanted : regions[0].name
}
