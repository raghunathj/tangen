/**
 * File Name: draft-changes.ts
 * Purpose: Single source of truth for "does this published entry have unpublished
 *          draft changes?" — comparing live field values against the
 *          published_values snapshot. Both the content list and the object
 *          editor use this so the marker never disagrees between the two.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: normalizes representation differences that are NOT edits —
 *          NUMERIC fields (API sends numbers, snapshot holds strings),
 *          relation/media (live may be expanded to objects, snapshot holds ids),
 *          and key order (canonical compare).
 */

const NUMERIC_FIELD_TYPES = new Set(['number', 'currency', 'rating'])

/** Reduce a relation/media value (possibly expanded to an object) to its id. */
function toId(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) return (v as { id?: unknown }).id ?? v
  return v
}

/** Normalize a field value for draft-vs-published comparison per field type. */
export function normFieldValue(fieldType: string | undefined, v: unknown): unknown {
  if (v == null) return null
  if (fieldType && NUMERIC_FIELD_TYPES.has(fieldType)) {
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
    return v
  }
  if (fieldType === 'relation' || fieldType === 'media') {
    return Array.isArray(v) ? v.map(toId) : toId(v)
  }
  return v
}

/** Canonical JSON equality — keys sorted recursively, undefined dropped. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const val = (v as Record<string, unknown>)[k]
        if (val !== undefined) out[k] = norm(val)
      }
      return out
    }
    return v
  }
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/** True when a field's live value differs from its snapshot value (type-aware). */
export function fieldValueChanged(fieldType: string | undefined, live: unknown, snap: unknown): boolean {
  return !canonicalEqual(normFieldValue(fieldType, live), normFieldValue(fieldType, snap))
}

/**
 * Whether the live translation map diverges from the publish-time snapshot
 * (publishedValues.i18n). Empty values ('' / null / undefined) mean "not
 * translated" on both sides - a blank draft entry never counts as a change
 * against an absent snapshot entry, matching localizeRow's fallback rules.
 */
export function i18nDiverges(
  live: Record<string, Record<string, unknown>> | null | undefined,
  published: Record<string, Record<string, unknown>> | null | undefined,
): boolean {
  const clean = (m?: Record<string, Record<string, unknown>> | null) => {
    const out: Record<string, Record<string, unknown>> = {}
    for (const [locale, entry] of Object.entries(m ?? {})) {
      if (!entry || typeof entry !== 'object') continue
      const e: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(entry)) {
        if (v === null || v === undefined || v === '') continue
        e[k] = v
      }
      if (Object.keys(e).length > 0) out[locale] = e
    }
    return out
  }
  return !canonicalEqual(clean(live), clean(published))
}
