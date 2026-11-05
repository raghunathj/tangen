/**
 * File Name: link-editor.ts
 * Purpose: The link editor's logic, kept out of the React component so it can
 *          be tested (closure plan Phase 6B, Unit 20): which destinations a
 *          field offers, what switching between them does to the value, and
 *          how the anchor and query rows edit.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The editor authors the STORED shape - identity for
 *          internal links, a URL for external ones, a path for site routes -
 *          and never the resolved
 *          shape a read returns. A value echoed back from a read is folded to
 *          identity server-side, but the editor reads `targetRef` directly so
 *          what it shows and what it saves agree immediately.
 */
import type { FieldDefinition, LinkKind, LinkValue, LinkQuery, PathLinkValue } from '@tangen/types'
import { LINK_KINDS, normalizeAnchor, normalizeQuery, normalizeLinkLabel, parseLinkPostfix, formatLinkPostfix } from '@tangen/types'

export interface LinkFieldConfigView {
  kinds: LinkKind[]
  allowedTargets: string[]
  anchor: boolean
  query: boolean
  /** The field offers a text on the link (a call to action's words). */
  withLabel: boolean
  /** The field offers "Open in a new tab". */
  newTab: boolean
}

/** What this particular field offers, with the defaults spelled out. */
export function linkConfigView(field: Pick<FieldDefinition, 'config'>): LinkFieldConfigView {
  const cfg = (field.config ?? {}) as {
    allowedKinds?: unknown; allowedTargets?: unknown; anchor?: unknown; query?: unknown; withLabel?: unknown; newTab?: unknown
  }
  const declared = Array.isArray(cfg.allowedKinds)
    ? (cfg.allowedKinds as string[]).filter((k): k is LinkKind => (LINK_KINDS as readonly string[]).includes(k))
    : []
  return {
    // All three by default. A field that wants fewer says so, and an existing
    // field that already named two keeps exactly those.
    kinds: declared.length > 0 ? declared : [...LINK_KINDS],
    allowedTargets: Array.isArray(cfg.allowedTargets) ? (cfg.allowedTargets as string[]) : [],
    anchor: cfg.anchor !== false,
    query: cfg.query !== false,
    withLabel: cfg.withLabel === true,
    newTab: cfg.newTab !== false,
  }
}

/**
 * The stored value behind whatever the editor was handed: an authored value
 * passes through, and a value echoed from a read is read by its identity
 * rather than by the facts that read resolved.
 */
export function authoredLink(value: unknown): LinkValue | null {
  const v = value as Record<string, unknown> | null
  if (!v || typeof v !== 'object') return null
  if (v.type === 'internal') {
    const t = (v.targetRef ?? v.target) as { type?: unknown; id?: unknown } | null
    if (!t || typeof t.type !== 'string' || typeof t.id !== 'string') return null
    return {
      type: 'internal',
      target: { type: t.type, id: t.id },
      ...(typeof v.label === 'string' && v.label ? { label: v.label } : {}),
      ...(v.newTab === true ? { newTab: true } : {}),
      ...(typeof v.locale === 'string' && v.locale ? { locale: v.locale } : {}),
      ...(typeof v.anchor === 'string' && v.anchor ? { anchor: v.anchor } : {}),
      ...(v.query && typeof v.query === 'object' ? { query: v.query as LinkQuery } : {}),
    }
  }
  if (v.type === 'external') {
    const url = typeof v.url === 'string' ? v.url : (typeof v.href === 'string' ? v.href : '')
    if (!url) return null
    return {
      type: 'external',
      url,
      ...(typeof v.label === 'string' && v.label ? { label: v.label } : {}),
      ...(v.newTab === true ? { newTab: true } : {}),
      ...(typeof v.anchor === 'string' && v.anchor ? { anchor: v.anchor } : {}),
      ...(v.query && typeof v.query === 'object' ? { query: v.query as LinkQuery } : {}),
    }
  }
  if (v.type === 'path') {
    let path = typeof v.path === 'string' ? v.path : ''
    let anchor = typeof v.anchor === 'string' && v.anchor ? v.anchor : undefined
    let query = v.query && typeof v.query === 'object' ? (v.query as LinkQuery) : undefined
    // A READ returns the destination as a derived `href` and nothing else -
    // no path, no anchor, no query - exactly as it does for an external link.
    // The external branch above has always read `href` as a fallback; this one
    // never did, so EVERY resolved path link read back as "no link" and the
    // editor offered to add one, silently discarding the link on the next save.
    // `/about` was as broken as `#plans`; a same-page link only made it
    // visible, because an external link beside it kept working.
    //
    // Split the same way `link-loader.ts`'s `authoredValue` splits it, so the
    // round trip is idempotent rather than nesting the postfix deeper.
    if (!path.trim() && !anchor && !query && typeof v.href === 'string' && v.href !== '') {
      const href = v.href
      const cut = Math.min(...['?', '#'].map((c) => (href.indexOf(c) === -1 ? href.length : href.indexOf(c))))
      path = href.slice(0, cut)
      const post = parseLinkPostfix(href.slice(cut))
      anchor = post.anchor
      query = post.query
    }
    // A SAME-PAGE link has no path, only somewhere on this page to go, so an
    // empty path is not an empty link when an anchor or a query is there.
    // Without this every setter erased one: `setPostfix` and `setLabel` start
    // by reading the value back through here, so clearing the path and typing
    // `plans` in the postfix box produced nothing at all.
    if (!path.trim() && !anchor && !query) return null
    return {
      type: 'path',
      ...(path.trim() ? { path } : {}),
      ...(typeof v.label === 'string' && v.label ? { label: v.label } : {}),
      ...(v.newTab === true ? { newTab: true } : {}),
      ...(anchor ? { anchor } : {}),
      ...(query ? { query } : {}),
    }
  }
  return null
}

/** Which tab the editor opens on: what the value is, else the only kind offered. */
export function currentKind(value: unknown, view: LinkFieldConfigView): LinkKind {
  const v = authoredLink(value)
  if (v && view.kinds.includes(v.type)) return v.type
  return view.kinds[0]!
}

/** What belongs to the link rather than to a branch: its text, new-tab, anchor and query. */
function carriedOf(v: LinkValue | null): Partial<Pick<LinkValue, 'label' | 'newTab' | 'anchor' | 'query'>> {
  return { ...(v?.label ? { label: v.label } : {}), ...(v?.newTab ? { newTab: true } : {}), ...(v?.anchor ? { anchor: v.anchor } : {}), ...(v?.query ? { query: v.query } : {}) }
}

/** Set or clear "open in a new tab". Stored only when on. */
export function setNewTab(value: unknown, on: boolean): LinkValue | null {
  const v = authoredLink(value)
  if (!v) return null
  const { newTab: _drop, ...rest } = v as LinkValue & { newTab?: boolean }
  return (on ? { ...rest, newTab: true } : rest) as LinkValue
}

/** The query and anchor as the one piece of text the author types after the destination. */
export function postfixOf(value: unknown): string {
  return formatLinkPostfix(authoredLink(value))
}

/** Write the postfix back: `?a=b#c` becomes the stored query and anchor; empty clears both. */
export function setPostfix(value: unknown, text: string): LinkValue | null {
  const v = authoredLink(value)
  if (!v) return null
  const { anchor: _a, query: _q, ...rest } = v as LinkValue & { anchor?: string; query?: LinkQuery }
  return { ...rest, ...parseLinkPostfix(text) } as LinkValue
}

/**
 * Switching destination keeps the text, anchor and query (they belong to the
 * link, not to the branch) and drops the other branch's destination, because
 * a URL is not an identity and an identity is not a URL.
 */
export function switchKind(value: unknown, kind: LinkKind): LinkValue | null {
  const v = authoredLink(value)
  const carried = carriedOf(v)
  if (kind === 'external') return { type: 'external', url: v?.type === 'external' ? v.url : '', ...carried }
  if (kind === 'path') return { type: 'path', path: v?.type === 'path' ? v.path : '', ...carried }
  if (v?.type === 'internal') return v
  return null   // an internal link with no target chosen yet is simply empty
}

/** Choose the internal target: `{ type, id }` from the object picker. */
export function setTarget(value: unknown, target: { type: string; id: string } | null): LinkValue | null {
  const v = authoredLink(value)
  if (!target) return null
  return { type: 'internal', target: { type: target.type, id: target.id }, ...carriedOf(v) }
}

/** Set or clear the link's text. Trimmed; empty is absent. Needs a destination to hang on. */
export function setLabel(value: unknown, label: string): LinkValue | null {
  const v = authoredLink(value)
  if (!v) return null
  const next = normalizeLinkLabel(label)
  const { label: _drop, ...rest } = v as LinkValue & { label?: string }
  return (next ? { ...rest, label: next } : rest) as LinkValue
}

/** Type the external URL. Empty clears the whole value rather than storing a blank link. */
export function setUrl(value: unknown, url: string): LinkValue | null {
  const v = authoredLink(value)
  if (url.trim() === '') return null
  return { type: 'external', url: url.trim(), ...carriedOf(v) }
}

/**
 * Type the site path. Empty clears the whole value rather than storing a blank
 * link, the way `setUrl` does.
 *
 * A `?` or `#` typed into the path box is MOVED into the postfix rather than
 * dropped: `normalizePath` stores the path alone, so without this the query a
 * person typed would vanish between keystroke and save with nothing said.
 */
export function setPath(value: unknown, path: string): LinkValue | null {
  const v = authoredLink(value)
  const raw = path.trim()
  // Emptying the path leaves a SAME-PAGE link when there is still an anchor or
  // a query; it clears the value only when there is nothing left to go to.
  if (raw === '') {
    if (v?.type !== 'path') return null
    const { path: _drop, ...rest } = v as PathLinkValue
    return rest.anchor || rest.query ? ({ ...rest, type: 'path' } as LinkValue) : null
  }
  const cut = Math.min(...['?', '#'].map((c) => (raw.indexOf(c) === -1 ? raw.length : raw.indexOf(c))))
  const body = raw.slice(0, cut)
  const typedPostfix = raw.slice(cut)
  const carried = carriedOf(v)
  // An empty body is OMITTED rather than stored as '', so this agrees with
  // `authoredLink` and with the stored form about what a pathless link looks
  // like. Typing `#plans` leaves the path absent, not blank.
  const withBody = body ? { path: body } : {}
  if (!typedPostfix) return { type: 'path', ...withBody, ...carried }
  // What was typed wins over what was there: it is the more recent intent.
  const { anchor: _a, query: _q, ...rest } = carried as { anchor?: string; query?: LinkQuery }
  return { type: 'path', ...withBody, ...rest, ...parseLinkPostfix(typedPostfix) }
}

/** Set or clear the anchor. Stored without its `#`, so `#team` and `team` are one value. */
export function setAnchor(value: unknown, anchor: string): LinkValue | null {
  const v = authoredLink(value)
  // A path link with no path yet is not a link until it has somewhere to go,
  // and this is the call that gives it one. `setPostfix` is what the editor
  // uses, but this is exported beside it and must agree with it.
  if (!v) {
    const next = normalizeAnchor(anchor)
    const isPathKind = !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'path'
    return isPathKind && next ? { type: 'path', anchor: next } : null
  }
  const next = normalizeAnchor(anchor)
  const { anchor: _drop, ...rest } = v as LinkValue & { anchor?: string }
  return (next ? { ...rest, anchor: next } : rest) as LinkValue
}

/** The query as editable rows, in the order they are stored. */
export function queryRows(value: unknown): Array<{ key: string; value: string }> {
  const v = authoredLink(value)
  return Object.entries(v?.query ?? {}).map(([key, val]) => ({ key, value: String(val) }))
}

/** Write the edited rows back. Rows with an empty key are dropped, an empty value is kept. */
export function setQueryRows(value: unknown, rows: Array<{ key: string; value: string }>): LinkValue | null {
  const v = authoredLink(value)
  if (!v) return null
  const obj: Record<string, string> = {}
  for (const row of rows) {
    if (row.key.trim() === '') continue
    obj[row.key.trim()] = row.value
  }
  const next = normalizeQuery(obj)
  const { query: _drop, ...rest } = v as LinkValue & { query?: LinkQuery }
  return (next ? { ...rest, query: next } : rest) as LinkValue
}

/**
 * What the editor shows about an internal target it was handed by a read: the
 * title and slug when it resolved, and an honest "cannot be found" when it did
 * not, so a broken link looks broken instead of empty.
 */
export function targetSummary(
  value: unknown,
): { label: string; detail: string; broken: boolean; resolved: boolean } | null {
  const v = value as Record<string, any> | null
  if (!v || v.type !== 'internal') return null
  const ref = v.targetRef ?? v.target
  if (!ref?.id) return null
  if (!v.target) {
    return { label: ref.id, detail: `This ${ref.type} cannot be found`, broken: true, resolved: true }
  }
  const t = v.target
  // `resolved` separates "the read told us about this target" from "all we
  // have is what the author picked". A freshly picked target is
  // `{ type, id }` and nothing else, so `label` below falls back to the id -
  // which is what the editor showed after choosing a page by its name. The
  // caller resolves the title itself when this is false.
  return {
    label: t.title || t.id,
    detail: [t.type, t.slug ? `/${t.slug}` : null, t.status !== 'published' ? t.status : null].filter(Boolean).join(' '),
    broken: false,
    resolved: t.title !== undefined || t.slug !== undefined || t.status !== undefined,
  }
}
