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
 *
 *          An internal link gained an `href` on 2026-10-19, and the rule it
 *          used to state is the reason: "never invent a route". A type that
 *          DECLARES `path` is not an invention - the platform composes that
 *          address from the tree and the slugs it already holds, which is
 *          what `docs/content-paths.md` describes. A type declaring none
 *          still has no `href`, and the routing is still the site's.
 */

/**
 * The destinations a link may hold (2026-10-14: `path` joined the first two).
 *
 * `path` exists because the other two left a hole a real site falls into: a
 * Next.js app has routes that are not content objects - `/contact`, `/pricing`,
 * anything hand-built - so `internal` has no object to point at, while
 * `external` would hard-code the domain into content and break between staging
 * and production. A path is neither, and refusing it forced one of those two
 * wrong answers.
 *
 * It fits this file's own boundary rather than bending it. "Tangen resolves
 * content identity; the application resolves site routing" - and a path IS site
 * routing, stored verbatim and handed over untouched, so Tangen resolves
 * nothing about it and can be wrong about nothing. The usual objection, that a
 * stored path breaks when a route moves, is a content objection: a slug rename
 * is a content action nobody tracks, while `/design` is a route its own
 * developer moves in code and knows they moved.
 */
export const LINK_KINDS = ['internal', 'external', 'path'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** The schemes an external link may use unless the field narrows them. */
export const DEFAULT_LINK_SCHEMES = ['https', 'http', 'mailto', 'tel'] as const
export type LinkScheme = string

/**
 * Schemes no link may ever use, whatever a field allows (2026-10-14). The
 * allow-list is the field's policy; this is the floor beneath it, because
 * these name code or a local handle rather than a destination, and the
 * hostname check below is not a substitute: `javascript://host/%0aalert(1)`
 * parses with a hostname and still executes in a browser. Enforced BEFORE
 * `allowedSchemes`, so a schema cannot opt back into one by listing it.
 */
export const DENIED_LINK_SCHEMES = ['javascript', 'vbscript', 'data', 'blob', 'filesystem', 'file'] as const

/**
 * The schemes whose URLs always carry an authority, so a host is required
 * even when the author omitted the slashes: the WHATWG special schemes, whose
 * parser reads `https:example.com` as the host `example.com` anyway. Every
 * other scheme is authority-bearing only when `//` actually follows the colon.
 */
const AUTHORITY_SCHEMES = new Set(['http', 'https', 'ws', 'wss', 'ftp'])

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

/**
 * A path on this site: the application's own routing, which Tangen stores and
 * returns without interpreting. Always begins with a single `/`; `//host` is
 * refused, because that is protocol-relative and therefore another origin
 * wearing a path's clothes.
 */
export interface PathLinkValue extends LinkExtras {
  type: 'path'
  /**
   * Leading slash, no origin. Query and anchor live below, not in here.
   *
   * ABSENT MEANS THIS PAGE (2026-11-04), so `{ type: 'path', anchor: 'plans' }`
   * is the same-page link `#plans` that a "See plans" button scrolling to a
   * section needs. Before this it had no home: `path` was required and had to
   * begin with `/`, so an author either typed the current page's own address -
   * duplicating what the page tree already composes, and breaking the day the
   * page moves - or typed `#plans` into the path box, where it was silently
   * read as `/`. An absent path is only valid WITH an anchor or a query;
   * nothing at all is not a link.
   */
  path?: string
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
export type LinkValue = InternalLinkValue | ExternalLinkValue | PathLinkValue

/** What a read returns for an internal link: identity, plus current facts. */
export interface ResolvedInternalLink extends LinkExtras {
  type: 'internal'
  /** The authored identity, always present, so a broken link stays repairable. */
  targetRef: { type: string; id: string }
  /**
   * The target's current facts, or null when it cannot be resolved here.
   * `path` is the target's composed address when its type declares one -
   * locale-prefixed, and `null` for a type that declares no path.
   */
  target: { type: string; id: string; slug: string | null; title: string | null; status: string; path: string | null } | null
  /**
   * Where this link goes: the target's `path` with the postfix appended, so a
   * consumer renders all three link kinds the same way. Absent when the target
   * could not be resolved or its type declares no path - the authored identity
   * is then still in `targetRef` and the routing is the site's to decide.
   */
  href?: string
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

/**
 * What a read returns for a path link: one href, which is the path with the
 * query and anchor appended. Derived like an external link's, so a consumer
 * renders both the same way and only an internal link needs routing.
 */
export interface ResolvedPathLink extends LinkExtras {
  type: 'path'
  href: string
}

export type ResolvedLink = ResolvedInternalLink | ResolvedExternalLink | ResolvedPathLink

/** True when the value is shaped like a stored link, on any branch. */
export function isLinkValue(value: unknown): value is LinkValue {
  const v = value as { type?: unknown } | null
  if (!v || typeof v !== 'object') return false
  return (LINK_KINDS as readonly string[]).includes(v.type as string)
}

/** True when the value is a link a read produced rather than one a client authored. */
export function isResolvedLink(value: unknown): value is ResolvedLink {
  const v = value as { type?: unknown; targetRef?: unknown; href?: unknown } | null
  if (!v || typeof v !== 'object') return false
  if (v.type === 'internal') return typeof v.targetRef === 'object'
  return (v.type === 'external' || v.type === 'path') && typeof v.href === 'string'
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
  if (value.type === 'path') {
    const raw = (value as PathLinkValue).path
    const given = typeof raw === 'string' ? raw.trim() : ''
    // A same-page link has no path, only somewhere on this page to go. It is
    // a link because the anchor (or the query) is what it carries; with
    // neither it is an empty value, which `null` is the answer for.
    if (given === '') {
      if (!anchor && !query) return null
      return { type: 'path', ...(label ? { label } : {}), ...(newTab ? { newTab } : {}), ...(anchor ? { anchor } : {}), ...(query ? { query } : {}) }
    }
    // A postfix in the path box is refused here as well as by the validator,
    // so the two cannot disagree: `normalizePath` would return a DIFFERENT,
    // valid-looking link (`/solutions` for `/solutions#our-work`), and a
    // normalizer that quietly changes a destination is the defect itself.
    if (pathLinkIssue(raw)?.reason === 'postfix') return null
    const path = normalizePath(raw)
    if (path === null) return null
    return { type: 'path', path, ...(label ? { label } : {}), ...(newTab ? { newTab } : {}), ...(anchor ? { anchor } : {}), ...(query ? { query } : {}) }
  }
  const url = typeof (value as ExternalLinkValue).url === 'string' ? (value as ExternalLinkValue).url.trim() : ''
  if (url === '') return null
  return { type: 'external', url, ...(label ? { label } : {}), ...(newTab ? { newTab } : {}), ...(anchor ? { anchor } : {}), ...(query ? { query } : {}) }
}

/**
 * The stored form of a site path: exactly one leading slash, trailing
 * whitespace gone, no query or anchor (those have their own homes, so a value
 * has one place to live). `design` is accepted and stored as `/design` -
 * typing the slash is not a thing to get wrong. Returns null when it is not a
 * usable path at all, which `pathLinkIssue` explains.
 */
export function normalizePath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const raw = path.trim()
  if (raw === '') return null
  if (urlScheme(raw)) return null              // an absolute URL is the other branch
  if (raw.startsWith('//')) return null        // protocol-relative: another origin
  const [beforeHash] = raw.split('#')
  const [beforeQuery] = (beforeHash ?? '').split('?')
  const body = (beforeQuery ?? '').replace(/\/+$/, '') || '/'
  const slashed = body.startsWith('/') ? body : `/${body}`
  return slashed.replace(/^\/+/, '/')
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
  /**
   * A code the caller maps to its own message. `scheme` is "this field does
   * not allow it"; `unsafe` is "nothing allows it" - two different answers,
   * because the first is a schema decision the developer can change.
   * `relative` and `absolute` are each other's mirror: a path in the URL box,
   * and a URL in the path box. Both mean "right value, wrong branch", and both
   * name the branch that would take it.
   *
   * `postfix` is the third of that family and the one that used to be silent:
   * a query or anchor typed into the path box. `normalizePath` keeps the path
   * alone, so `/solutions#our-work` stored as a path became `/solutions` and
   * the fragment was gone with nothing said. It is now refused by name. The
   * Admin never hit this - `setPath` moves a typed postfix into its own field
   * - but REST, GraphQL, the SDK and Porter all write straight through the
   * validator, and they did.
   */
  reason: 'malformed' | 'relative' | 'scheme' | 'unsafe' | 'absolute' | 'postfix'
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
  if ((DENIED_LINK_SCHEMES as readonly string[]).includes(scheme)) return { reason: 'unsafe', scheme }
  if (!allowed.map((s) => s.toLowerCase()).includes(scheme)) return { reason: 'scheme', scheme }
  // A host can only be required where the URL has one. An authority scheme
  // always does; any other scheme does only when `//` follows the colon, so
  // `whatsapp://send?text=hi` is checked for a host while `sms:+15551234`,
  // `fb-messenger:user?id=1` and `intent:#Intent;...` - opaque, like the
  // `mailto:` and `tel:` this generalises - need only something after it.
  const rest = raw.slice(scheme.length + 1)
  if (!AUTHORITY_SCHEMES.has(scheme) && !rest.startsWith('//')) {
    return rest.trim() === '' ? { reason: 'malformed' } : null
  }
  try {
    const parsed = new URL(raw)
    if (!parsed.hostname) return { reason: 'malformed' }
    return null
  } catch {
    return { reason: 'malformed' }
  }
}

/** Why this is not a usable site path, or null when it is. */
export function pathLinkIssue(path: unknown): UrlIssue | null {
  if (typeof path !== 'string' || path.trim() === '') return { reason: 'malformed' }
  const raw = path.trim()
  const scheme = urlScheme(raw)
  // An absolute URL in the path box is not malformed, it is in the wrong box,
  // and `absolute` is what lets the caller say exactly that.
  if (scheme) return { reason: 'absolute', scheme }
  // `//evil.test/x` reads as a path and is another origin. Refusing it here is
  // the whole reason this branch cannot just be "a string starting with /".
  if (raw.startsWith('//')) return { reason: 'absolute' }
  // A query or an anchor in the path box: the value is right, the box is
  // wrong, and `normalizePath` would drop it. Named rather than discarded.
  if (raw.includes('#') || raw.includes('?')) return { reason: 'postfix' }
  return normalizePath(raw) === null ? { reason: 'malformed' } : null
}

/**
 * The href a read returns for a path link: the stored path with the query and
 * anchor appended. Built by hand rather than through `new URL()`, which needs
 * a base and would invent an origin this link deliberately does not have.
 */
export function pathHref(value: PathLinkValue): string {
  const postfix = formatLinkPostfix({ anchor: normalizeAnchor(value.anchor), query: normalizeQuery(value.query) })
  // A same-page link is the postfix alone. `/#plans` would also scroll, but it
  // is a navigation to the root with a fragment, which reloads the page in a
  // client router; `#plans` never leaves it.
  const given = typeof value.path === 'string' ? value.path.trim() : ''
  if (given === '') return postfix
  return `${normalizePath(value.path) ?? '/'}${postfix}`
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
  // An opaque URL is returned untouched, by the same shape test the validator
  // uses. Merging into one does not append, it rewrites: the URL parser reads
  // `intent:#Intent;package=com.x;end` as an empty path plus a fragment, so
  // setting a hash on it yields `intent:#frag` and the destination is gone.
  if (!scheme || (!AUTHORITY_SCHEMES.has(scheme) && !url.slice(scheme.length + 1).startsWith('//'))) {
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
