/**
 * File Name: draft-changes.ts
 * Purpose: Whether SAVED TRANSLATIONS are ahead of the publish-time snapshot.
 *          Nothing else: the question "does this published entry have
 *          unpublished draft changes?" is the SERVER's, answered by
 *          `computeHasDraftChanges`, and both the content list and the object
 *          editor read that one answer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: this file used to answer the whole question client-side
 *          by comparing the object the API returned against published_values
 *          field by field, and it could not: a read RESOLVES before it
 *          answers (a link's `url` becomes a derived `href`; media and
 *          relations expand from ids to objects) while the snapshot holds the
 *          authored form. Per-field normalization covered a top-level
 *          relation or media field and nothing else - a link had no case, and
 *          nothing descended into a `component` - so any link inside a block
 *          read as an edit and every page carrying one showed "Changes in
 *          draft" forever, while the list showed none.
 *
 *          The lesson is the one the header used to claim and not deliver:
 *          ONE implementation, and it belongs where the raw row is, because
 *          only there are both sides the same shape.
 *
 *          Translations stay here because both sides of that compare are
 *          already the same shape, and because the update route does not load
 *          the live i18n map to answer it.
 */

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
