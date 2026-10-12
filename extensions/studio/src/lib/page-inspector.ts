/**
 * File Name: page-inspector.ts
 * Purpose: What the right rail shows when no block is selected - the page's
 *          own settings (title, slug, SEO), grouped the way the type
 *          declared them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `defineObjectType` flattens a group's sub-fields into
 *          the top-level array as WELL as leaving them on the group marker,
 *          so every grouped field arrives twice. Rendering both copies would
 *          show each SEO control twice and wire two controls to one value,
 *          so grouped names are claimed before the loose pass runs.
 */
import type { FieldDefinition } from '@tangen/types'

export interface PageSection {
  /** Stable across renders - used as the React key. */
  id: string
  /** null = the page's own fields, shown before any named group. */
  label: string | null
  fields: FieldDefinition[]
}

interface PageInspectorOptions {
  /** The component field the canvas edits; it is not a page setting. */
  blocksField: string | null
  /**
   * Every component field on the type. Each is a REGION the navigator can
   * select, so none of them belong here - a nested block editor in a 320px
   * rail was always the worse of the two surfaces.
   */
  regionNames?: string[]
}

/** Hidden from the editor by the schema, by config or by soft-disable. */
function excluded(field: FieldDefinition): boolean {
  return field.disabled === true || field.admin?.hidden === true
}

function subFields(field: FieldDefinition): FieldDefinition[] {
  const sub = (field.config as { groupFields?: unknown } | undefined)?.groupFields
  return Array.isArray(sub) ? (sub as FieldDefinition[]) : []
}

/**
 * Splits a type's fields into the sections the page inspector renders.
 * Loose fields lead regardless of where they were declared - they are the
 * page's identity, and burying them under a group reads as an error.
 */
export function pageInspectorSections(
  fields: FieldDefinition[] | undefined,
  opts: PageInspectorOptions,
): PageSection[] {
  if (!Array.isArray(fields)) return []

  const groups: PageSection[] = []
  const claimed = new Set<string>()

  for (const field of fields) {
    if (field.fieldType !== 'group') continue
    const kids = subFields(field).filter((k) => !excluded(k))
    for (const k of subFields(field)) claimed.add(k.name)   // claimed even if excluded
    if (kids.length === 0) continue
    groups.push({ id: `group:${field.name}`, label: field.label || field.name, fields: kids })
  }

  const regions = new Set(opts.regionNames ?? (opts.blocksField ? [opts.blocksField] : []))
  const loose = fields.filter((field) => (
    field.fieldType !== 'group' &&
    !excluded(field) &&
    !claimed.has(field.name) &&
    !regions.has(field.name)
  ))

  return loose.length > 0
    ? [{ id: 'page', label: null, fields: loose }, ...groups]
    : groups
}
