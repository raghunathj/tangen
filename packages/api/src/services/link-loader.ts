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
 *          An internal link had no href while Tangen owned no route model.
 *          A type that declares `path` now says where its objects live, so
 *          the target's address is one of its facts and `href` is that
 *          address with this link's postfix appended (slice 5 of
 *          tasks/plan-content-paths.md). A type that declares no path still
 *          gets no href: there the routing is the site's to decide, and an
 *          invented address would be worse than none.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import type { ComponentDef } from '@tangen/types'
import { externalHref, pathHref, parseLinkPostfix, formatLinkPostfix, isLinkValue, normalizeLinkValue } from '@tangen/types'
import type { ExternalLinkValue, InternalLinkValue, PathLinkValue, LinkValue, ResolvedLink } from '@tangen/types'
import { mapFieldsOfType, declaresFieldType, isRecord, type AnyField, type TypeLike } from './field-walker'
import { fetchI18nRows } from './i18n'
import { pathColumnsFor, resolvePathsFor, type PathResolverDeps } from './path-resolver'

/** The bounded facts a resolved internal target contributes. Nothing else travels. */
export interface LinkTargetFacts {
  type: string
  id: string
  slug: string | null
  title: string | null
  status: string
  /** The target's composed address, or null when its type declares no path. */
  path: string | null
}

export interface ResolveLinksOptions {
  /** Public published view: only published targets resolve. */
  publicView?: boolean
  /** The read's locale, used when a link does not name one of its own. */
  locale?: string | null
  /**
   * What a target's address is composed from. Without it a link resolves
   * exactly as it did before slice 5 - the four facts and `path: null` - so a
   * caller that has no schema at hand degrades rather than guesses.
   */
  pathDeps?: PathResolverDeps
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
  if (value.type === 'path' && typeof value.href === 'string' && value.path == null) {
    // The same round trip for a path. Its href carries the query and anchor,
    // so they are parsed back out rather than left glued to the path, which is
    // what keeps a re-resolve idempotent instead of nesting them deeper.
    const href = value.href
    const cut = Math.min(...['?', '#'].map((c) => (href.indexOf(c) === -1 ? href.length : href.indexOf(c))))
    return normalizeLinkValue({
      type: 'path',
      path: href.slice(0, cut),
      ...parseLinkPostfix(href.slice(cut)),
      label: value.label,
      newTab: value.newTab,
    })
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
  const facts = await loadTargetFacts(groups, db, workspaceId, opts.publicView === true, opts.pathDeps)

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
  if (value.type === 'path') {
    // Nothing to load: the application owns this route, so the href is the
    // whole answer and no target fact is consulted.
    const pv = value as PathLinkValue
    return { type: 'path', href: pathHref(pv), ...(pv.label ? { label: pv.label } : {}), ...(pv.newTab ? { newTab: true } : {}) }
  }
  const v = value as InternalLinkValue
  const locale = v.locale ?? readLocale ?? null
  const target = facts.get(targetKey(v.target.type, v.target.id, locale)) ?? null
  const postfix = formatLinkPostfix(v)
  return {
    type: 'internal',
    targetRef: { type: v.target.type, id: v.target.id },
    target,
    // One key a consumer can render whatever the link kind, present only
    // when there is a real address behind it.
    ...(target?.path ? { href: `${target.path}${postfix}` } : {}),
    ...(v.label ? { label: v.label } : {}),
    ...(v.newTab ? { newTab: true } : {}),
    ...(v.locale ? { locale: v.locale } : {}),
    ...(v.anchor ? { anchor: v.anchor } : {}),
    ...(v.query ? { query: v.query } : {}),
    // Ready to append to whatever route the application builds for the target.
    postfix,
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
  pathDeps?: PathResolverDeps,
): Promise<Map<string, LinkTargetFacts>> {
  const out = new Map<string, LinkTargetFacts>()
  if (groups.size === 0) return out

  await Promise.all([...groups.values()].map(async ({ type, locale, ids }) => {
    const table = (contentTables as Record<string, any>)[type]
    if (!table) return                       // no such type here: the link stays unresolved
    const idList = [...ids]
    // The address needs the columns the target type's `path` reads - its slug
    // and the relations the pattern names - so they are selected alongside the
    // four facts. `null` from pathColumnsFor is a path FUNCTION, which may read
    // any column, so the whole target row is taken for it. A type with no path
    // adds nothing to the select and costs no second query.
    const pathCols = pathDeps
      ? pathColumnsFor(pathDeps.schema.types?.find((t) => t.name === type))
      : []
    const facts = { id: table.id, slug: table.slug, title: table.title, status: table.status }
    const selection = pathCols === null
      ? null
      : { ...facts, ...Object.fromEntries(pathCols.filter((c) => table[c] !== undefined).map((c) => [c, table[c]])) }
    const rows = (await (selection ? db.select(selection) : db.select())
      .from(table)
      .where(and(
        inArray(table.id, idList),
        eq(table.workspaceId, workspaceId),
        ...(publicView ? [eq(table.status, 'published')] : []),
      ))) as Array<Record<string, unknown>>

    // A locale only changes the title and the address's PREFIX: the system slug
    // is single-valued by design, so a link never needs a locale to know which
    // object it points at, only which locale's front door to use.
    const wantPath = !!pathDeps && (pathCols === null || pathCols.length > 0) && rows.length > 0
    const [titles, paths] = await Promise.all([
      locale && rows.length > 0 ? localizedTitles(db, type, rows, locale) : Promise.resolve(null),
      wantPath ? resolvePathsFor(rows, type, pathDeps!, { locale }) : Promise.resolve(null),
    ])

    rows.forEach((r, i) => {
      const id = r.id as string
      out.set(targetKey(type, id, locale), {
        type,
        id,
        slug: (r.slug as string | null) ?? null,
        title: titles?.get(id) ?? ((r.title as string | null) ?? null),
        status: String(r.status ?? 'draft'),
        path: paths?.[i]?.path ?? null,
      })
    })
  }))
  return out
}

/** `id -> title` in one locale, from the type's i18n side table. */
async function localizedTitles(
  db: any, type: string, rows: Array<Record<string, unknown>>, locale: string,
): Promise<Map<string, string>> {
  const side = await fetchI18nRows(db, type, rows.map((r) => r.id as string), locale)
  const titles = new Map<string, string>()
  for (const s of side as unknown as Array<Record<string, unknown>>) {
    const t = s.__title
    if (typeof t === 'string' && t !== '') titles.set(s.objectId as string, t)
  }
  return titles
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
    // A same-page link has no `path` at all, so "has a string path" stopped
    // covering every stored path link. No `href` is the real test: that key
    // only exists on a value a read produced.
    if (value.type === 'path' && typeof (value as { href?: unknown }).href !== 'string') return value
    return authored
  }
  return mapFieldsOfType(values, typeDef.fields as AnyField[], 'link', [], registry ?? [], collapse, false)
}
