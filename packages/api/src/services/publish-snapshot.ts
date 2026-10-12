/**
 * File Name: publish-snapshot.ts
 * Purpose: The ONE builder for publishedValues - the snapshot the public view
 *          serves for a published object. Every path that can set
 *          status='published' (publish route, create-as-published, PATCH
 *          status, bulk status update) must write this, or the public site
 *          serves live draft columns (a row with status='published' and no
 *          snapshot falls through applyPublishedSnapshot untouched).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { buildI18nMap } from './i18n'
import type { I18nRow } from './i18n'

/**
 * Builds the publish-time snapshot from an effective row (current values at
 * the moment of publishing): title + slug + every schema field, plus the
 * translations map when side rows exist. Shape matches the publish route's
 * historical output exactly.
 */
export function buildPublishedValues(
  row: Record<string, unknown>,
  typeDef: { fields: Array<{ name: string }> },
  i18nRows: I18nRow[] = [],
): Record<string, unknown> {
  // undefined would be DROPPED by JSON.stringify on the way into jsonb, and a
  // missing snapshot key lets the live draft column bleed through on apply -
  // coerce to null so "empty at publish time" stays empty on the public site.
  const pv: Record<string, unknown> = { title: row.title ?? null, slug: row.slug ?? null }
  for (const f of typeDef.fields) pv[f.name] = row[f.name] === undefined ? null : row[f.name]
  if (i18nRows.length > 0) pv.i18n = buildI18nMap(i18nRows, typeDef as never)
  return pv
}
