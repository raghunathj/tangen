/**
 * File Name: canonical.ts
 * Purpose: Canonical URL resolution and its safety rules (closure plan Phase
 *          9A, Unit 3). The one rule that governs the whole file: Tangen
 *          never invents a URL. A canonical is stated, resolved by the
 *          application, or omitted.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. Phase 6B froze "Tangen resolves content identity;
 *          the consuming application resolves site routing", so there is no
 *          slug concatenation here and no Core href resolver is introduced.
 */
import type { SeoUrlInput, SeoUrlResolver } from '../contract'

/** Schemes a canonical may use. Everything else is refused, not sanitized. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:'])

/** Long enough for any real URL; short enough that nothing absurd is stored. */
export const MAX_URL_LENGTH = 2048

export type CanonicalCheck =
  | { ok: true; url: string }
  | { ok: false; reason: 'CANONICAL_EMPTY' | 'CANONICAL_MALFORMED' | 'CANONICAL_NOT_ABSOLUTE' | 'CANONICAL_SCHEME' | 'CANONICAL_FRAGMENT' | 'CANONICAL_TOO_LONG' }

/**
 * Whether a string may be used as a canonical.
 *
 * Fragments are REFUSED rather than stripped. A canonical names the page a
 * search engine should index; `#section` names a place inside one, and
 * quietly deleting it would hide an editor's mistake instead of showing it.
 */
export function validateCanonical(value: unknown): CanonicalCheck {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, reason: 'CANONICAL_EMPTY' }
  const raw = value.trim()
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: 'CANONICAL_TOO_LONG' }

  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, reason: raw.startsWith('/') ? 'CANONICAL_NOT_ABSOLUTE' : 'CANONICAL_MALFORMED' } }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: 'CANONICAL_SCHEME' }
  if (!url.hostname) return { ok: false, reason: 'CANONICAL_MALFORMED' }
  if (url.hash) return { ok: false, reason: 'CANONICAL_FRAGMENT' }
  return { ok: true, url: raw }
}

export interface CanonicalResolveInput extends SeoUrlInput {
  /** The editor's explicit canonical, if they stated one. */
  override?: string | null
  /** The application's resolver, if the site supplied one. */
  resolveUrl?: SeoUrlResolver
}

/**
 * The canonical for one object, in precedence order:
 *
 * 1. the editor's explicit override
 * 2. the consuming application's resolver
 * 3. nothing
 *
 * A resolver that throws is treated as "no answer": a site bug must not take
 * a page down, and a wrong canonical is worse than an absent one.
 */
export async function resolveCanonical(input: CanonicalResolveInput): Promise<string | undefined> {
  if (input.override) {
    const checked = validateCanonical(input.override)
    return checked.ok ? checked.url : undefined
  }
  if (!input.resolveUrl) return undefined

  let answer: string | null
  try {
    answer = await input.resolveUrl({
      workspaceId: input.workspaceId,
      type: input.type,
      id: input.id,
      locale: input.locale,
      slug: input.slug,
      ...(input.fieldValue ? { fieldValue: input.fieldValue } : {}),
    })
  } catch { return undefined }

  if (!answer) return undefined
  const checked = validateCanonical(answer)
  return checked.ok ? checked.url : undefined
}
