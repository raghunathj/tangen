/**
 * File Name: field-presentation.ts
 * Purpose: The presentation category of a field (UI V2 spec §18). Placement
 *          is the schema's decision (`admin.editorView.{main,sidebar}`);
 *          this decides HOW a field renders where the schema put it:
 *          `document` fields get comfortable vertical space, `compact`
 *          fields become a property row (label and control on one line)
 *          when they sit in the inspector, `structured` fields keep their
 *          dedicated surface. Never a second widget set: the control is
 *          the field's own.
 *
 * Author: Raghunath J
 * License: MIT
 */
export type PresentationCategory = 'document' | 'compact' | 'structured'

const COMPACT = new Set(['boolean', 'number', 'currency', 'date', 'time', 'select', 'slug', 'color', 'rating', 'range', 'url', 'email', 'phone', 'form'])
const STRUCTURED = new Set(['media', 'object', 'json', 'code', 'geopoint', 'link', 'repeater', 'component', 'group', 'multiselect', 'tags'])

export interface PresentationField {
  fieldType: string
  config?: { many?: boolean; localized?: boolean; admin?: { width?: unknown } } & Record<string, unknown>
}

export function presentationCategory(field: PresentationField): PresentationCategory {
  const t = field.fieldType
  if (t === 'relation') return field.config?.many ? 'structured' : 'compact'
  if (COMPACT.has(t)) return 'compact'
  if (STRUCTURED.has(t)) return 'structured'
  // text, textarea, richtext and anything unknown (an extension field type)
  // read as document content: comfortable, stacked.
  return 'document'
}

/** In the inspector, a compact field is a one-line property row unless it is
 *  localized (its per-locale inputs need the stacked layout). */
export function inspectorLayout(field: PresentationField): 'inline' | 'stacked' {
  if (presentationCategory(field) !== 'compact') return 'stacked'
  if (field.config?.localized) return 'stacked'
  return 'inline'
}
