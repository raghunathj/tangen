/**
 * File Name: form-submissions.ts
 * Purpose: Pure helpers for the form-submissions admin surface — mapping field
 *   names to human labels, rendering submitted values, and shaping the notes
 *   PATCH body. Kept framework-free so they can be unit-tested in isolation.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: none (pure functions).
 */

/** Minimal shape needed to resolve a field's display label. */
export interface LabelledField {
  name: string
  label?: string
}

/**
 * Builds a name → label lookup from a form's field definitions. Fields with no
 * label fall back to their name so the map always resolves to something usable.
 * @param fields - the form's field definitions
 * @returns a record keyed by field name
 */
export function buildFieldLabelMap(fields: LabelledField[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const f of fields ?? []) {
    if (!f || typeof f.name !== 'string') continue
    map[f.name] = f.label && f.label.trim() !== '' ? f.label : f.name
  }
  return map
}

/**
 * Resolves the human label for a submitted key, falling back to the raw key.
 * @param map - the name → label map
 * @param key - the submitted field name
 */
export function fieldLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key
}

/**
 * Renders an arbitrary submitted value as a readable string. Arrays are joined
 * with commas, objects are JSON-stringified, and null/undefined become ''.
 * @param value - the submitted value
 */
export function formatSubmissionValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((v) => formatSubmissionValue(v)).join(', ')
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Shapes the PATCH body for saving a submission's internal notes. Trims the
 * input; an all-whitespace note is sent as an empty string (the API clears it).
 * @param notes - the raw textarea value
 */
export function buildNotesPatchBody(notes: string): { notes: string } {
  const trimmed = notes.trim()
  return { notes: trimmed }
}
