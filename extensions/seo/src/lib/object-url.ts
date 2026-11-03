/**
 * File Name: object-url.ts
 * Purpose: One place that answers "what is this object's URL". Three answers,
 *          most explicit first: the site's own `resolveUrl`, then a FIELD the
 *          site declared as this type's address (`urlField: { page: 'path' }`),
 *          then the address Tangen itself composed from the type's declared
 *          `path`. The last is why a site that declares `path` configures
 *          nothing here: `siteUrl` is the only thing Tangen cannot know.
 *
 *          Every answer is a PATH made absolute under one origin, and a
 *          resolver is handed the other two so it can prefix rather than
 *          rebuild. Pure.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { SeoHelpers } from '../contract'
import { validateCanonical } from './canonical'

/** The field this type's URL lives in, when the site declared one. */
export function urlFieldName(helpers: SeoHelpers | undefined, type: string): string | null {
  const declared = helpers?.urlField
  if (!declared) return null
  if (typeof declared === 'string') return declared.trim() || null
  const own = declared[type]
  return typeof own === 'string' && own.trim() ? own.trim() : null
}

/**
 * The declared field's value for one object: a path, or null. Only ever reads
 * the ONE field the site named, and only accepts what could be a path - a
 * stray title or an id is not a URL.
 */
export function urlFieldValue(helpers: SeoHelpers | undefined, type: string, row: Record<string, unknown> | null | undefined): string | null {
  const field = urlFieldName(helpers, type)
  if (!field || !row) return null
  const raw = row[field]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

/** The site's origin without a trailing slash, or null when it declared none. */
const originOf = (helpers: SeoHelpers | undefined): string | null => {
  const site = helpers?.siteUrl?.trim()
  return site ? site.replace(/\/+$/, '') : null
}

export interface ObjectUrlInput {
  helpers: SeoHelpers | undefined
  workspaceId: string
  type: string
  id: string
  locale?: string | null
  slug?: string | null
  /** The declared field's value, already read by the caller (it holds the row). */
  fieldValue?: string | null
  /**
   * The address Tangen composed from the type's declared `path` (`_path` on a
   * read that asked for it), locale prefix included. Null for a type that
   * declares no path, which is why the answer below can still be null.
   */
  pathValue?: string | null
}

/** A path is only a path: a bare slug, a protocol-relative host or an absolute URL is not one. */
const pathLike = (value: string | null | undefined): string | null => {
  const v = value?.trim()
  return v && v.startsWith('/') && !v.startsWith('//') ? v : null
}

/**
 * The object's absolute URL. Three sources, most explicit first: the site's
 * own resolver, the field it declared for this type, then the address the
 * type's own `path` composes. Null means "this object has no page", which
 * every caller treats as a reason to omit it rather than invent an address.
 */
export async function objectUrl(input: ObjectUrlInput): Promise<string | null> {
  const composed = pathLike(input.pathValue)
  const identity = {
    workspaceId: input.workspaceId, type: input.type, id: input.id,
    locale: input.locale ?? null, slug: input.slug ?? null,
    ...(input.fieldValue ? { fieldValue: input.fieldValue } : {}),
    ...(composed ? { path: composed } : {}),
  }
  const resolver = input.helpers?.resolveUrl
  if (resolver) {
    try {
      const answer = await resolver(identity)
      if (answer) return answer
    } catch { /* a site resolver that throws must not take the page down */ }
  }
  // The convention, in the order of how explicitly the site said it: a field
  // it declared for this type, then the address the type itself declares.
  const origin = originOf(input.helpers)
  if (!origin) return null
  for (const path of [input.fieldValue, composed]) {
    if (!path) continue
    const checked = validateCanonical(`${origin}${path}`)
    if (checked.ok) return checked.url
  }
  return null
}
