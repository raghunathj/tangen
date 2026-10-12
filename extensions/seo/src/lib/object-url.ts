/**
 * File Name: object-url.ts
 * Purpose: One place that answers "what is this object's URL", for a site that
 *          routes by a FIELD rather than by the slug. The site declares the
 *          field per type (`urlField: { page: 'path' }`); Tangen reads that one
 *          field - never the whole object - and, with `siteUrl`, that is the
 *          whole answer. An explicit `resolveUrl` still wins, and receives the
 *          field's value so it can prefix or localise it. Pure.
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
}

/**
 * The object's absolute URL: the site's own resolver first, then the declared
 * field under the site's origin. Null means "this object has no page", which
 * every caller treats as a reason to omit it rather than invent an address.
 */
export async function objectUrl(input: ObjectUrlInput): Promise<string | null> {
  const identity = {
    workspaceId: input.workspaceId, type: input.type, id: input.id,
    locale: input.locale ?? null, slug: input.slug ?? null,
    ...(input.fieldValue ? { fieldValue: input.fieldValue } : {}),
  }
  const resolver = input.helpers?.resolveUrl
  if (resolver) {
    try {
      const answer = await resolver(identity)
      if (answer) return answer
    } catch { /* a site resolver that throws must not take the page down */ }
  }
  // The convention: the declared field IS the path, under the declared origin.
  const origin = originOf(input.helpers)
  if (origin && input.fieldValue) {
    const candidate = `${origin}${input.fieldValue}`
    const checked = validateCanonical(candidate)
    if (checked.ok) return checked.url
  }
  return null
}
