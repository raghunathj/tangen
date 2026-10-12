/**
 * File Name: link.ts
 * Purpose: The Core `link` field's value contract (closure plan Phase 6B,
 *          Unit 2): one discriminated value that is either a Tangen content
 *          target held BY IDENTITY, or an external URL. Pure, so the API,
 *          the Admin, the SDK and the CLI all read one definition.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The v1 boundary is "Tangen resolves content identity;
 *          the application resolves site routing". An internal link
 *          therefore stores `{ type, id }` and NOTHING derived - no slug, no
 *          path, no href - and Delivery resolves the target's current facts
 *          at read time, so renaming a slug never rewrites a link. An
 *          external link's URL is authoritative, and its Delivery `href` is
 *          derived from it, so the two can never contradict each other.
 *          There is no internal `href` in v1: Tangen owns no canonical route
 *          model, and a fabricated one would be wrong the moment a site
 *          disagreed with it.
 */

/** The destinations a link may hold. */
export const LINK_KINDS = ['internal', 'external'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** The schemes an external link may use unless the field narrows them. */
export const DEFAULT_LINK_SCHEMES = ['https', 'http', 'mailto', 'tel'] as const
export type LinkScheme = string

/** Query parameters travel structured, never as a raw string. */
export type LinkQuery = Record<string, string>

/**
 * What travels with a link on either branch (2026-09-13): its words - a call
 * to action's text, offered when the field sets `config.withLabel`, stored
 * trimmed and absent when empty - and whether it opens in a new tab, stored
 * only when true.
 */
export interface LinkExtras {
  label?: string
  newTab?: boolean
}

/** An internal link: the target's identity, plus how to arrive at it. */
export interface InternalLinkValue extends LinkExtras {
  type: 'internal'
  /** The authoritative destination. Nothing derived is stored beside it. */
  target: { type: string; id: string }
  /** Which locale of the target to resolve; absent means the read's locale. */
  locale?: string
  /** Without the `#`. */
  anchor?: string
  query?: LinkQuery
}

/** An external link: the URL is the destination. */
export interface ExternalLinkValue extends LinkExtras {
  type: 'external'
  /** Authoritative. Query and anchor below are merged into it on delivery. */
  url: string
  anchor?: string
  query?: LinkQuery
}

/** The longest text a link may carry. A call to action is a phrase, not a paragraph. */
export const LINK_LABEL_MAX = 200

/** What a `link` field stores. */
export type LinkValue = InternalLinkValue | ExternalLinkValue

/** What a read returns for an internal link: identity, plus current facts. */
export interface ResolvedInternalLink extends LinkExtras {
  type: 'internal'
  /** The authored identity, always present, so a broken link stays repairable. */
  targetRef: { type: string; id: string }
  /** The target's current facts, or null when it cannot be resolved here. */
  target: { type: string; id: string; slug: string | null; title: string | null; status: string } | null
  locale?: string
  anchor?: string
  query?: LinkQuery
  /** The query and anchor ready to append to the route you build: `?source=footer#team`, or '' (2026-09-13). */
  postfix: string
}

/** What a read returns for an external link: one derived href. */
export interface ResolvedExternalLink extends LinkExtras {
  type: 'external'
  /** `url` with the query merged and the anchor appended. Derived, deterministic. */
  href: string
}

export type ResolvedLink = ResolvedInternalLink | ResolvedExternalLink

/** True when the value is shaped like a stored link (either branch). */
export function isLinkValue(value: unknown): value is LinkValue {
  const v = value as { type?: unknown } | null
  return !!v && typeof v === 'object' && (v.type === 'internal' || v.type === 'external')
}

/** True when the value is a link a read produced rather than one a client authored. */
export function isResolvedLink(value: unknown): value is ResolvedLink {
  const v = value as { type?: unknown; targetRef?: unknown; href?: unknown } | null
  if (!v || typeof v !== 'object') return false
  return (v.type === 'internal' && typeof v.targetRef === 'object') || (v.type === 'external' && typeof v.href === 'string')
}

// ── Normalization ────────────────────────────────────────────────────────────

/** The link's text, trimmed; empty or not a string becomes absent. */
export function normalizeLinkLabel(label: unknown): string | undefined {
  if (typeof label !== 'string') return undefined
  const trimmed = label.trim()
  return trimmed === '' ? undefined : trimmed
}

/** `#team`, ` team ` and `team` all store as `team`; empty becomes absent. */
export function normalizeAnchor(anchor: unknown): string | undefined {
  if (typeof anchor !== 'string') return undefined
  const trimmed = anchor.trim().replace(/^#+/, '')
  return trimmed === '' ? undefined : trimmed
}

/**
 * Query parameters as stored: string keys and string values, key order
 * normalized so the same query always serializes the same way. An empty
 * object is absent; a value may be empty (`?flag=`), a key may not.
 */
export function normalizeQuery(query: unknown): LinkQuery | undefined {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return undefined
  const out: LinkQuery = {}
  for (const key of Object.keys(query as Record<string, unknown>).sort()) {
    if (key.trim() === '') continue
    const raw = (query as Record<string, unknown>)[key]
    if (raw === null || raw === undefined) continue
    if (typeof raw === 'object') continue
    out[key] = String(raw)
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** The stored form of an authored value: trimmed, ordered, nothing derived. */
export function normalizeLinkValue(value: unknown): LinkValue | null {
  if (!isLinkValue(value)) return null
  const anchor = normalizeAnchor((value as { anchor?: unknown }).anchor)
  const query = normalizeQuery((value as { query?: unknown }).query)
  const label = normalizeLinkLabel((value as { label?: unknown }).label)
  const newTab = (value as { newTab?: unknown }).newTab === true
  if (value.type === 'internal') {
    const target = (value as InternalLinkValue).target
    if (!target || typeof target !== 'object') return null
    const type = typeof target.type === 'string' ? target.type.trim() : ''
    const id = typeof target.id === 'string' ? target.id.trim() : ''
    if (type === '' || id === '') return null
    const locale = typeof value.locale === 'string' && value.locale.trim() !== '' ? value.locale.trim() : undefined
    return { type: 'internal', target: { type, id }, ...(label ? { label } : {}), ...(newTab ? { newTab } : {}), ...(locale ? { locale } : {}), ...(anchor ? { anchor } : {}), ...(query ? { query } : {}) }
  }
  const url = typeof (value as ExternalLinkValue).url === 'string' ? (value as ExternalLinkValue).url.trim() : ''
  if (url === '') return null
  return { type: 'external', url, ...(label ? { label } : {}), ...(newTab ? { newTab } : {}), ...(anchor ? { anchor } : {}), ...(query ? { query } : {}) }
}

// ── The postfix ──────────────────────────────────────────────────────────────

/**
 * The query and anchor as ONE piece of text the author types after the
 * destination - `?source=footer#team` (the user, 2026-09-13: one box, not
 * an anchor field and a table of parameters). Storage stays structured, so
 * delivery and the SDK are unchanged: this is the editor's reading of it.
 * Anything before the first `?` or `#` is not a postfix (a path belongs in
 * the URL) and is ignored.
 */
export function parseLinkPostfix(text: unknown): { anchor?: string; query?: LinkQuery } {
  if (typeof text !== 'string') return {}
  const raw = text.trim()
  const hashAt = raw.indexOf('#')
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt)
  const anchor = hashAt === -1 ? undefined : normalizeAnchor(raw.slice(hashAt + 1))
  const qAt = beforeHash.indexOf('?')
  let query: LinkQuery | undefined
  if (qAt !== -1) {
    const params = new URLSearchParams(beforeHash.slice(qAt + 1))
    const obj: Record<string, string> = {}
    params.forEach((v, k) => { obj[k] = v })
    query = normalizeQuery(obj)
  }
  return { ...(anchor ? { anchor } : {}), ...(query ? { query } : {}) }
}

/** The postfix as the author sees it: `?a=b&c=d#anchor`, or '' when the link has neither. */
export function formatLinkPostfix(value: { anchor?: string; query?: LinkQuery } | null | undefined): string {
  if (!value) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(value.query ?? {})) params.set(k, v)
  const q = params.toString()
  return `${q ? `?${q}` : ''}${value.anchor ? `#${value.anchor}` : ''}`
}

// ── External URLs ────────────────────────────────────────────────────────────

/** The scheme of an absolute URL, lower-cased and without the colon; null when it is not one. */
export function urlScheme(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim())
  return m ? m[1]!.toLowerCase() : null
}

export interface UrlIssue {
  /** A code the caller maps to its own message. */
  reason: 'malformed' | 'relative' | 'scheme'
  /** The offending scheme, when there was one. Never the whole URL. */
  scheme?: string
}

/**
 * Why this external URL is not usable, or null when it is. A RELATIVE url is
 * refused on purpose: a site path is routing, which an internal link (or the
 * application) owns - not a value Tangen would have to resolve against a
 * route model it does not have.
 */
export function externalUrlIssue(url: unknown, allowed: readonly string[] = DEFAULT_LINK_SCHEMES): UrlIssue | null {
  if (typeof url !== 'string' || url.trim() === '') return { reason: 'malformed' }
  const raw = url.trim()
  const scheme = urlScheme(raw)
  if (!scheme) return { reason: 'relative' }
  if (!allowed.map((s) => s.toLowerCase()).includes(scheme)) return { reason: 'scheme', scheme }
  // `mailto:` and `tel:` are opaque; the rest must parse as a URL with a host.
  if (scheme === 'mailto' || scheme === 'tel') {
    return raw.slice(scheme.length + 1).trim() === '' ? { reason: 'malformed' } : null
  }
  try {
    const parsed = new URL(raw)
    if (!parsed.hostname) return { reason: 'malformed' }
    return null
  } catch {
    return { reason: 'malformed' }
  }
}

/**
 * The href a read returns for an external link: the URL with the stored
 * query merged in and the anchor appended. Derived every time, so `url`
 * stays the only authority. `mailto:`/`tel:` keep their opaque form.
 */
export function externalHref(value: ExternalLinkValue): string {
  const url = value.url.trim()
  const scheme = urlScheme(url)
  const anchor = normalizeAnchor(value.anchor)
  const query = normalizeQuery(value.query)
  if (scheme === 'mailto' || scheme === 'tel' || !scheme) {
    // Nothing to merge into: an opaque scheme has no query or fragment slot.
    return url
  }
  try {
    const parsed = new URL(url)
    if (query) for (const [k, v] of Object.entries(query)) parsed.searchParams.set(k, v)
    if (anchor) parsed.hash = anchor
    return parsed.toString()
  } catch {
    return url
  }
}
