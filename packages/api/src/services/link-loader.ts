/**
 * File Name: link-loader.ts
 * Purpose: Resolves link field values for a read (closure plan Phase 6B,
 *          Units 6, 7, 10, 11 and 13). An internal link stores identity, so
 *          the read is where its current facts come from: one batched lookup
 *          per referenced target type, never one per row. An external link
 *          needs no lookup at all - its href is derived from the URL it
 *          already holds.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Walks with field-walker.ts, so links resolve at every
 *          position media does - top-level columns, group sub-fields,
 *          repeater rows and component blocks. Resolution consumes NO
 *          relation depth and never recurses: a target contributes bounded
 *          facts (id, slug, title, status) and nothing else, so a link cannot
 *          become a second, unbounded expansion path.
 *
 *          A target that is missing, deleted, or not public in this view
 *          resolves to `target: null` while `targetRef` keeps the authored
 *          identity - the link is preserved and repairable, and an
 *          unpublished target never leaks through a published source.
 *
 *          There is deliberately NO internal href. Tangen resolves content
 *          identity; the application resolves site routing.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import type { ComponentDef } from '@tangen/types'
import { externalHref, formatLinkPostfix, isLinkValue, normalizeLinkValue } from '@tangen/types'
import type { ExternalLinkValue, InternalLinkValue, LinkValue, ResolvedLink } from '@tangen/types'
import { mapFieldsOfType, declaresFieldType, isRecord, type AnyField, type TypeLike } from './field-walker'
import { fetchI18nRows } from './i18n'

/** The bounded facts a resolved internal target contributes. Nothing else travels. */
export interface LinkTargetFacts {
  type: string
  id: string
  slug: string | null
  title: string | null
  status: string
}

export interface ResolveLinksOptions {
  /** Public published view: only published targets resolve. */
  publicView?: boolean
  /** The read's locale, used when a link does not name one of its own. */
  locale?: string | null
}

/** A target key: the type and id an internal link named, plus the locale to read it in. */
function targetKey(type: string, id: string, locale: string | null): string {
  return `${type} ${id} ${locale ?? ''}`
}

/** True when the type declares a link field anywhere (top level or in a container). */
export function declaresLink(typeDef: TypeLike, registry: ComponentDef[] = []): boolean {
  return declaresFieldType(typeDef.fields as AnyField[], 'link', registry)
}

/**
 * The authored value behind a stored or already-resolved link. A read that is
 * fed back in (the editor echoing an autosave) resolves from its `targetRef`,
 * so re-resolving is idempotent and never loses identity.
 */
function authoredValue(value: unknown): LinkValue | null {
  if (!isRecord(value)) return null
  if (value.type === 'internal' && isRecord(value.targetRef)) {
    return normalizeLinkValue({ ...value, target: value.targetRef })
  }
  if (value.type === 'external' && typeof value.href === 'string' && value.url == null) {
    // A delivered external link carries only its derived href; that href IS a
    // valid authored URL, so it round-trips without inventing anything.
    return normalizeLinkValue({ type: 'external', url: value.href, label: value.label, newTab: value.newTab })
  }
  return isLinkValue(value) ? normalizeLinkValue(value) : null
}

/**
 * Every internal target an authored value in `rows` names, grouped by content
 * type and locale, so the caller can load each group in one query.
 */
export function collectLinkTargets(
  rows: Record<string, unknown>[],
  typeDef: TypeLike,
  registry: ComponentDef[] = [],
  readLocale: string | null = null,
): Map<string, { type: string; locale: string | null; ids: Set<string> }> {
  const groups = new Map<string, { type: string; locale: string | null; ids: Set<string> }>()
  const collect = (value: unknown) => {
    const v = authoredValue(value)
    if (!v || v.type !== 'internal') return value
    const locale = v.locale ?? readLocale ?? null
    const key = `${v.target.type} ${locale ?? ''}`
    const group = groups.get(key) ?? { type: v.target.type, locale, ids: new Set<string>() }
    group.ids.add(v.target.id)
    groups.set(key, group)
    return value
  }
  for (const row of rows) mapFieldsOfType(row, typeDef.fields as AnyField[], 'link', [], registry, collect, false)
  return groups
}

/**
 * Replaces every authored link with its delivered form. One query per
 * referenced (target type, locale) pair for the whole row set - a hundred rows
 * pointing at the same page cost the same as one.
 */
export async function resolveLinksDeep(
  rows: Record<string, unknown>[],
  typeDef: TypeLike,
  registry: ComponentDef[] | null | undefined,
  db: any,
  workspaceId: string,
  opts: ResolveLinksOptions = {},
): Promise<Record<string, unknown>[]> {
  const reg = registry ?? []
  if (rows.length === 0 || !declaresLink(typeDef, reg)) return rows

  const readLocale = opts.locale && opts.locale !== 'all' ? opts.locale : null
  const groups = collectLinkTargets(rows, typeDef, reg, readLocale)
  const facts = await loadTargetFacts(groups, db, workspaceId, opts.publicView === true)

  const resolve = (value: unknown) => {
    const v = authoredValue(value)
    if (!v) return value
    return resolveOne(v, facts, readLocale)
  }
  return rows.map((row) => mapFieldsOfType(row, typeDef.fields as AnyField[], 'link', [], reg, resolve, false))
}

/** One authored value's delivered form. Pure - every fact it needs is already loaded. */
export function resolveOne(
  value: LinkValue,
  facts: Map<string, LinkTargetFacts>,
  readLocale: string | null = null,
): ResolvedLink {
  if (value.type === 'external') {
    const e = value as ExternalLinkValue
    return { type: 'external', href: externalHref(e), ...(e.label ? { label: e.label } : {}), ...(e.newTab ? { newTab: true } : {}) }
  }
  const v = value as InternalLinkValue
  const locale = v.locale ?? readLocale ?? null
  return {
    type: 'internal',
    targetRef: { type: v.target.type, id: v.target.id },
    target: facts.get(targetKey(v.target.type, v.target.id, locale)) ?? null,
    ...(v.label ? { label: v.label } : {}),
    ...(v.newTab ? { newTab: true } : {}),
    ...(v.locale ? { locale: v.locale } : {}),
    ...(v.anchor ? { anchor: v.anchor } : {}),
    ...(v.query ? { query: v.query } : {}),
    // Ready to append to whatever route the application builds for the target.
    postfix: formatLinkPostfix(v),
  }
}

/**
 * The facts for every collected target: one select per (type, locale) group,
 * plus one i18n select per group that asks for a locale. A target the view
 * cannot see - unpublished under publicView, deleted, or of a type this
 * database has no table for - is simply absent, which is what makes its link
 * resolve to null rather than to someone else's content.
 */
async function loadTargetFacts(
  groups: Map<string, { type: string; locale: string | null; ids: Set<string> }>,
  db: any,
  workspaceId: string,
  publicView: boolean,
): Promise<Map<string, LinkTargetFacts>> {
  const out = new Map<string, LinkTargetFacts>()
  if (groups.size === 0) return out

  await Promise.all([...groups.values()].map(async ({ type, locale, ids }) => {
    const table = (contentTables as Record<string, any>)[type]
    if (!table) return                       // no such type here: the link stays unresolved
    const idList = [...ids]
    const rows = (await db
      .select({ id: table.id, slug: table.slug, title: table.title, status: table.status })
      .from(table)
      .where(and(
        inArray(table.id, idList),
        eq(table.workspaceId, workspaceId),
        ...(publicView ? [eq(table.status, 'published')] : []),
      ))) as Array<Record<string, unknown>>

    // A locale only changes the title: the system slug is single-valued by
    // design, so a link never needs a locale to know where it points.
    let titles: Map<string, string> | null = null
    if (locale && rows.length > 0) {
      const side = await fetchI18nRows(db, type, rows.map((r) => r.id as string), locale)
      titles = new Map()
      for (const s of side as unknown as Array<Record<string, unknown>>) {
        const t = s.__title
        if (typeof t === 'string' && t !== '') titles.set(s.objectId as string, t)
      }
    }

    for (const r of rows) {
      const id = r.id as string
      out.set(targetKey(type, id, locale), {
        type,
        id,
        slug: (r.slug as string | null) ?? null,
        title: titles?.get(id) ?? ((r.title as string | null) ?? null),
        status: String(r.status ?? 'draft'),
      })
    }
  }))
  return out
}

/**
 * Write-side inverse: folds a delivered link back to its authored value at
 * every link position, so a client echoing a read stores identity again
 * rather than a snapshot of the facts that read happened to resolve.
 */
export function collapseLinksDeep(
  values: Record<string, unknown>,
  typeDef: TypeLike,
  registry: ComponentDef[] | null | undefined,
): Record<string, unknown> {
  const collapse = (value: unknown) => {
    if (!isRecord(value)) return value
    const authored = authoredValue(value)
    if (!authored) return value
    // Already the stored form: return the value itself so nothing rewrites.
    if (value.type === 'internal' && value.targetRef == null) return value
    if (value.type === 'external' && typeof value.url === 'string') return value
    return authored
  }
  return mapFieldsOfType(values, typeDef.fields as AnyField[], 'link', [], registry ?? [], collapse, false)
}
