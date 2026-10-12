/**
 * File Name: redirects.ts
 * Purpose: The redirect model and its safety rules (closure plan Phase 9A,
 *          Unit 8). A redirect is a security surface: an open redirect sends a
 *          site's visitors wherever an attacker asked, and a loop takes a page
 *          down. Both are refused at write time.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. An INTERNAL destination stores `{ type, id }` -
 *          the Phase 6B identity - and is resolved to a URL at consumption
 *          time through the same application boundary the canonical uses. A
 *          copied slug would go stale the moment the slug changed, which is
 *          the very thing redirects exist to survive.
 */
import { validateCanonical, MAX_URL_LENGTH } from './canonical'

export const REDIRECT_STATUSES = [301, 302] as const
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number]

export type RedirectDestination =
  /** A full address, including the scheme: `https://example.com/new`, `https://example.com`. */
  | { kind: 'external'; url: string }
  /** A path on this site: `/abc.html`, `/abc/123/`. The site turns it into a Location. */
  | { kind: 'path'; path: string }
  /** A piece of content, stored as identity so it survives the page's URL changing. */
  | { kind: 'internal'; type: string; id: string }

export interface SeoRedirect {
  /** A normalized path, always. Never an absolute URL. */
  source: string
  destination: RedirectDestination
  status: RedirectStatus
  enabled: boolean
  createdAt: string
  updatedAt: string
  /** Free-text note for the team. Editorial only; never served. */
  note?: string
  /**
   * Whether the visitor's query string rides along to the destination.
   * Default (absent) is to carry it: a campaign parameter on an old address
   * belongs on the new one.
   */
  keepQuery?: boolean
}

/** How far a write-time cycle check walks before it stops claiming anything. */
export const CYCLE_SCAN_LIMIT = 10

/**
 * One canonical spelling of a path, so `/Old/` and `/old` are one entry.
 * Lowercased because a redirect that only fires for one capitalization is a
 * redirect that will be reported as broken.
 */
export function normalizeSource(raw: string): string {
  let value = String(raw ?? '').trim()
  const hash = value.indexOf('#')
  if (hash >= 0) value = value.slice(0, hash)
  const q = value.indexOf('?')
  let path = q >= 0 ? value.slice(0, q) : value
  const query = q >= 0 ? value.slice(q) : ''
  path = path.replace(/\/{2,}/g, '/')
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (path === '') path = '/'
  return `${path.toLowerCase()}${query}`
}

/**
 * The path half of a source, with any query string dropped. A redirect is
 * normally FOR a path, so `/old-page?utm_source=mail` must reach the rule
 * written for `/old-page`; a rule that names a query stays exact.
 */
export function normalizeSourcePath(raw: string): string {
  const normalized = normalizeSource(raw)
  const q = normalized.indexOf('?')
  return q >= 0 ? normalized.slice(0, q) : normalized
}

/** The query string of a source, '' when it has none. */
export function sourceQuery(raw: string): string {
  const normalized = normalizeSource(raw)
  const q = normalized.indexOf('?')
  return q >= 0 ? normalized.slice(q) : ''
}

/**
 * The destination a visitor is sent to, with the query they arrived with when
 * the redirect carries it. A destination that already names a query keeps its
 * own and gains the visitor's.
 */
export function applyQuery(destination: string, incomingQuery: string, keepQuery?: boolean): string {
  const query = incomingQuery.replace(/^\?/, '')
  if (keepQuery === false || !query) return destination
  const [base, own] = destination.split('#')[0]!.split('?')
  const merged = own ? `${own}&${query}` : query
  const hash = destination.includes('#') ? destination.slice(destination.indexOf('#')) : ''
  return `${base}?${merged}${hash}`
}

/** The store key. Being the source itself is what makes a duplicate impossible. */
export function redirectKey(source: string): string {
  return `redirect:${normalizeSource(source)}`
}

export type RedirectCheck =
  | { ok: true }
  | { ok: false; reason: 'SOURCE_EMPTY' | 'SOURCE_NOT_A_PATH' | 'DESTINATION_EMPTY' | 'DESTINATION_SCHEME' | 'DESTINATION_NOT_ABSOLUTE' | 'DESTINATION_NOT_A_PATH' | 'DESTINATION_IDENTITY' | 'SELF_REDIRECT' | 'STATUS' }

/**
 * Whether a redirect may be stored. Everything here is a BOUNDED check on one
 * record plus, for the cycle case, a short walk - `detectCycle` says so
 * explicitly rather than implying the whole graph was analysed.
 */
export function validateRedirect(r: SeoRedirect & { siteUrl?: string }): RedirectCheck {
  const source = String(r.source ?? '').trim()
  if (!source) return { ok: false, reason: 'SOURCE_EMPTY' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//')) return { ok: false, reason: 'SOURCE_NOT_A_PATH' }
  if (!REDIRECT_STATUSES.includes(r.status as RedirectStatus)) return { ok: false, reason: 'STATUS' }

  const normalized = normalizeSource(source)

  if (r.destination?.kind === 'internal') {
    if (!r.destination.type?.trim() || !r.destination.id?.trim()) return { ok: false, reason: 'DESTINATION_IDENTITY' }
    return { ok: true }
  }

  if (r.destination?.kind === 'path') {
    const path = String(r.destination.path ?? '').trim()
    if (!path) return { ok: false, reason: 'DESTINATION_EMPTY' }
    // A path, not an address and not a protocol-relative URL in disguise.
    if (!path.startsWith('/') || path.startsWith('//')) return { ok: false, reason: 'DESTINATION_NOT_A_PATH' }
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(path) || path.includes('#')) return { ok: false, reason: 'DESTINATION_NOT_A_PATH' }
    if (path.length > MAX_URL_LENGTH) return { ok: false, reason: 'DESTINATION_NOT_A_PATH' }
    if (normalizeSourcePath(path) === normalizeSourcePath(normalized)) return { ok: false, reason: 'SELF_REDIRECT' }
    return { ok: true }
  }

  const url = String((r.destination as { url?: string } | undefined)?.url ?? '').trim()
  if (!url) return { ok: false, reason: 'DESTINATION_EMPTY' }
  const checked = validateCanonical(url)
  if (!checked.ok) {
    return { ok: false, reason: checked.reason === 'CANONICAL_SCHEME' ? 'DESTINATION_SCHEME' : 'DESTINATION_NOT_ABSOLUTE' }
  }
  // A redirect to its own address is a loop of length one.
  try {
    const dest = new URL(checked.url)
    if (normalizeSource(dest.pathname) === normalized && (!r.siteUrl || new URL(r.siteUrl).host === dest.host)) {
      return { ok: false, reason: 'SELF_REDIRECT' }
    }
  } catch { /* validateCanonical already accepted it */ }
  return { ok: true }
}

/**
 * Whether adding `source -> destination` closes a loop among the redirects
 * already stored. Bounded to {@link CYCLE_SCAN_LIMIT} hops: this is a
 * write-time guard against the obvious mistake, NOT a global graph analysis,
 * and it says which of the two it did.
 */
export function detectCycle(
  source: string,
  destinationPath: string,
  existing: Map<string, string>,
): { cycle: true; path: string[] } | { cycle: false; truncated?: true } {
  const start = normalizeSource(source)
  const walked = [start]
  let current = normalizeSource(destinationPath)
  for (let hop = 0; hop < CYCLE_SCAN_LIMIT; hop++) {
    walked.push(current)
    if (current === start) return { cycle: true, path: walked }
    const next = existing.get(current)
    if (next === undefined) return { cycle: false }
    current = normalizeSource(next)
  }
  return { cycle: false, truncated: true }
}
