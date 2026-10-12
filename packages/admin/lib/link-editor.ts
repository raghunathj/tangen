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
 *          internal links, a URL for external ones - and never the resolved
 *          shape a read returns. A value echoed back from a read is folded to
 *          identity server-side, but the editor reads `targetRef` directly so
 *          what it shows and what it saves agree immediately.
 */
import type { FieldDefinition, LinkKind, LinkValue, LinkQuery } from '@tangen/types'
import { normalizeAnchor, normalizeQuery, normalizeLinkLabel, parseLinkPostfix, formatLinkPostfix } from '@tangen/types'

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
    ? (cfg.allowedKinds as string[]).filter((k): k is LinkKind => k === 'internal' || k === 'external')
    : []
  return {
    kinds: declared.length > 0 ? declared : ['internal', 'external'],
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

/** Set or clear the anchor. Stored without its `#`, so `#team` and `team` are one value. */
export function setAnchor(value: unknown, anchor: string): LinkValue | null {
  const v = authoredLink(value)
  if (!v) return null
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
export function targetSummary(value: unknown): { label: string; detail: string; broken: boolean } | null {
  const v = value as Record<string, any> | null
  if (!v || v.type !== 'internal') return null
  const ref = v.targetRef ?? v.target
  if (!ref?.id) return null
  if (!v.target) {
    return { label: ref.id, detail: `This ${ref.type} cannot be found`, broken: true }
  }
  const t = v.target
  return {
    label: t.title || t.id,
    detail: [t.type, t.slug ? `/${t.slug}` : null, t.status !== 'published' ? t.status : null].filter(Boolean).join(' '),
    broken: false,
  }
}
