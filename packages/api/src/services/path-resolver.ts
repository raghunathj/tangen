/**
 * File Name: path-resolver.ts
 * Purpose: Resolves a type's declared `path` into an address for a BATCH of
 *          rows - slice 3 of tasks/plan-content-paths.md. The composer in
 *          @tangen/schema is pure and already tested; this is the half that
 *          has to fetch a relation's slug and walk an ancestor chain.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The thing this must not do is one query per row, or one
 *          per level of a tree. A relation's slugs come back in ONE grouped
 *          select per target type; an ancestor chain comes back in ONE
 *          recursive query per target type, however deep the tree is and
 *          however many rows asked.
 *
 *          It builds its SQL from names rather than from the generated
 *          `contentTables` registry, because a field's column is its field
 *          name verbatim and a table is its type name (schema-drift keys
 *          columns by `f.name`, and its index DDL names the table `t.name`).
 *          That also lets it be tested on the shared PGlite harness against
 *          tables the shared DDL builders created.
 *
 *          Composing an address is the platform's job; turning an address back
 *          into content is the SITE's, because its router already declares
 *          those routes.
 */
import { sql } from 'drizzle-orm'
import {
  parsePathPattern, resolvePathPattern, applyLocalePrefix, PATH_MAX_SEGMENTS,
  type PathSegment, type PathValues,
} from '@tangen/schema'
import { pathPatternOf, isPathField, isPathFn, type SchemaDefinition, type ObjectTypeDefinition } from '@tangen/types'
import { projectLocalization } from './i18n'

/** What a read returns for one row: the address, and its shape for the editor. */
export interface ResolvedPath {
  path: string | null
  /** The address with `:slug` left where the slug goes, for the editor's URL preview. */
  template: string | null
}

export interface PathResolverDeps {
  db: any
  workspaceId: string
  schema: SchemaDefinition
  /** Decides the locale prefix; absent means no prefix at all. */
  localization?: {
    enabled: boolean
    defaultLocale: string
    locales: readonly { code: string; label?: string; url?: string }[]
    pathPrefix?: 'as-needed' | 'always' | 'never'
  }
}

const NONE: ResolvedPath = { path: null, template: null }

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

/** The relation field by this name, or null when it is not one. */
function relationTarget(typeDef: ObjectTypeDefinition, fieldName: string): string | null {
  const f = (typeDef.fields ?? []).find((x) => x.name === fieldName)
  if (!f || f.fieldType !== 'relation') return null
  const target = (f.config as { targetType?: string } | undefined)?.targetType
  return typeof target === 'string' && target !== '' ? target : null
}

/**
 * The field a type walks UP through: its own self-referential relation, which
 * `hierarchical: true` auto-provides. Found by target rather than by name, so
 * a hand-declared parent under another name still works.
 */
function selfParentField(typeDef: ObjectTypeDefinition): string | null {
  for (const f of typeDef.fields ?? []) {
    if (f.fieldType !== 'relation') continue
    const c = f.config as { targetType?: string; many?: boolean } | undefined
    if (c?.targetType === typeDef.name && c?.many !== true) return f.name
  }
  return null
}

/** `id -> slug` for one target type, in one select. */
async function slugsById(
  deps: PathResolverDeps, typeName: string, ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const res = await deps.db.execute(sql`
    SELECT id, slug FROM ${sql.identifier(typeName)}
     WHERE workspace_id = ${deps.workspaceId}
       AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
  for (const r of rowsOf(res)) {
    if (typeof r.slug === 'string') out.set(String(r.id), r.slug)
  }
  return out
}

/**
 * `seedId -> [slug, ...]` root first, for one target type, in ONE recursive
 * query however deep the tree goes.
 *
 * `seen` is not belt and braces: a cycle written before the save-time guard
 * existed, or straight through SQL, would otherwise spin here forever. The
 * depth bound alone would stop it, but `seen` stops it at the first repeat
 * rather than after six wasted rounds.
 */
async function chainsBySeed(
  deps: PathResolverDeps, typeName: string, parentField: string, seeds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (seeds.length === 0) return out
  const t = sql.identifier(typeName)
  const p = sql.identifier(parentField)
  const res = await deps.db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id AS origin, id, slug, ${p} AS next, 1 AS depth, ARRAY[id] AS seen
        FROM ${t}
       WHERE workspace_id = ${deps.workspaceId}
         AND id IN (${sql.join(seeds.map((s) => sql`${s}`), sql`, `)})
      UNION ALL
      SELECT c.origin, n.id, n.slug, n.${p}, c.depth + 1, c.seen || n.id
        FROM ${t} n
        JOIN chain c ON n.id = c.next
       WHERE n.workspace_id = ${deps.workspaceId}
         AND c.depth < ${PATH_MAX_SEGMENTS}
         AND NOT (n.id = ANY(c.seen))
    )
    SELECT origin, slug, depth FROM chain ORDER BY origin, depth DESC`)
  for (const r of rowsOf(res)) {
    if (typeof r.slug !== 'string') continue
    const key = String(r.origin)
    const list = out.get(key) ?? []
    list.push(r.slug)                        // already root first: depth DESC
    out.set(key, list)
  }
  return out
}

/**
 * The address for every row of one type, in declaration order.
 *
 * A row's address may legitimately be null - a type with no `path`, an object
 * with no slug, a pattern whose required segment is empty - and every artifact
 * that needs an address already treats that as "this has no page" rather than
 * an error.
 */
export async function resolvePathsFor(
  rows: ReadonlyArray<Record<string, unknown>>,
  typeName: string,
  deps: PathResolverDeps,
  opts: { locale?: string | null } = {},
): Promise<ResolvedPath[]> {
  if (rows.length === 0) return []
  const typeDef = (deps.schema.types ?? []).find((t) => t.name === typeName)
  if (!typeDef?.path) return rows.map(() => NONE)

  const localize = (path: string | null): string | null =>
    applyLocalePrefix(path, opts.locale, deps.localization)

  // ── the two non-pattern declarations ──────────────────────────────────────
  if (isPathFn(typeDef.path)) {
    const fn = typeDef.path
    return rows.map((r) => {
      const path = localize(fn(r as Record<string, unknown>))
      return { path, template: path }
    })
  }
  if (isPathField(typeDef.path)) {
    const key = typeDef.path.field
    return rows.map((r) => {
      const v = r[key]
      const path = localize(typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
      return { path, template: path }
    })
  }

  const declared = pathPatternOf(typeDef.path)
  if (!declared) return rows.map(() => NONE)
  let segments: PathSegment[]
  try {
    segments = parsePathPattern(declared.pattern)
  } catch {
    // A malformed pattern is refused at LOAD by defineObjectType. Reaching
    // here means the declaration came from the database rather than from code,
    // so answer "no address" instead of failing every read of the type.
    return rows.map(() => NONE)
  }

  // ── gather what the segments need, grouped so each target costs one query ──
  const oneHop = new Map<string, Set<string>>()        // targetType -> ids
  const chains = new Map<string, { parentField: string; seeds: Set<string> }>()

  for (const seg of segments) {
    if (seg.kind !== 'field') continue
    const target = relationTarget(typeDef, seg.field)
    if (!target) continue                               // validated at load; nothing to fetch
    for (const row of rows) {
      const id = row[seg.field]
      if (typeof id !== 'string' || id === '') continue
      if (!seg.chain) {
        if (!oneHop.has(target)) oneHop.set(target, new Set())
        oneHop.get(target)!.add(id)
      } else {
        const targetDef = (deps.schema.types ?? []).find((t) => t.name === target)
        // No self-relation on the target means there is no tree to walk, so a
        // chain degrades to the one hop it can see. The cross-type check that
        // refuses this at load is its own slice.
        const parentField = targetDef ? selfParentField(targetDef) : null
        if (!parentField) {
          if (!oneHop.has(target)) oneHop.set(target, new Set())
          oneHop.get(target)!.add(id)
          continue
        }
        if (!chains.has(target)) chains.set(target, { parentField, seeds: new Set() })
        chains.get(target)!.seeds.add(id)
      }
    }
  }

  const [hopResults, chainResults] = await Promise.all([
    Promise.all([...oneHop].map(async ([t, ids]) => [t, await slugsById(deps, t, [...ids])] as const)),
    Promise.all([...chains].map(async ([t, { parentField, seeds }]) =>
      [t, await chainsBySeed(deps, t, parentField, [...seeds])] as const)),
  ])
  const slugs = new Map(hopResults)
  const trees = new Map(chainResults)

  // ── compose ───────────────────────────────────────────────────────────────
  return rows.map((row) => {
    const fields: PathValues['fields'] = {}
    for (const seg of segments) {
      if (seg.kind !== 'field') continue
      const target = relationTarget(typeDef, seg.field)
      if (!target) continue
      const id = typeof row[seg.field] === 'string' ? (row[seg.field] as string) : null
      if (!id) { fields[seg.field] = seg.chain ? [] : null; continue }
      if (seg.chain && trees.has(target)) fields[seg.field] = trees.get(target)!.get(id) ?? []
      else if (seg.chain) fields[seg.field] = [slugs.get(target)?.get(id)].filter((s): s is string => !!s)
      else fields[seg.field] = slugs.get(target)?.get(id) ?? null
    }
    const slug = typeof row.slug === 'string' ? row.slug : null
    const result = resolvePathPattern(segments, { slug, fields }, { root: declared.root })
    return result.ok
      ? { path: localize(result.path), template: localize(result.template) }
      : { path: null, template: 'template' in result ? localize(result.template) : null }
  })
}

// ─── The read side (slice 4) ──────────────────────────────────────────────────

/** The response key carrying a row's address. */
export const PATH_KEY = '_path'
/** The response key carrying its shape, with `:slug` where the slug goes. */
export const PATH_TEMPLATE_KEY = '_pathTemplate'

/**
 * The columns a type's `path` declaration reads, so a read under a `props`
 * projection can select them even though the response will not show them. A
 * projection says what the CALLER wants back, not what the server may look at
 * - the sort column is already selected the same way, for the same reason.
 *
 * `null` means "any column": a path FUNCTION is given the row, so there is no
 * honest subset, and a caller asking for an address from a function type reads
 * the whole row.
 */
export function pathColumnsFor(typeDef: ObjectTypeDefinition | undefined): string[] | null {
  if (!typeDef?.path) return []
  if (isPathFn(typeDef.path)) return null
  if (isPathField(typeDef.path)) return [typeDef.path.field]
  const declared = pathPatternOf(typeDef.path)
  if (!declared) return []
  let segments: PathSegment[]
  try {
    segments = parsePathPattern(declared.pattern)
  } catch {
    return []
  }
  const cols = ['slug']
  for (const seg of segments) {
    if (seg.kind === 'field' && !cols.includes(seg.field)) cols.push(seg.field)
  }
  return cols
}

/** The resolver's dependencies, taken from a request context. */
export function pathDepsOf(ctx: {
  db: unknown
  workspaceId: string
  schema: SchemaDefinition
  workspaceProjects?: unknown[]
}): PathResolverDeps {
  const project = (ctx.workspaceProjects as Array<{ workspaceId?: string }> | undefined)
    ?.find((p) => p.workspaceId === ctx.workspaceId)
  const localization = projectLocalization(project)
  return {
    db: ctx.db,
    workspaceId: ctx.workspaceId,
    schema: ctx.schema,
    ...(localization ? { localization: localization as PathResolverDeps['localization'] } : {}),
  }
}

/**
 * The path keys to merge onto each presented row, index-aligned with the RAW
 * rows they were resolved from.
 *
 * Raw rows, not presented ones: a relation expanded at `depth >= 1` has become
 * an object where the resolver expects an id, and a field-access mask may have
 * taken the slug away from the response entirely. Neither changes what the
 * object's address is.
 *
 * The template is the editor's, which is why it is asked for rather than
 * always returned: a public read has no slug box to draw it under.
 */
export async function pathFactsFor(
  raw: ReadonlyArray<Record<string, unknown>>,
  typeName: string,
  deps: PathResolverDeps,
  opts: { locale?: string | null; template?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
  const resolved = await resolvePathsFor(raw, typeName, deps, { locale: opts.locale ?? null })
  return resolved.map((r) => ({
    [PATH_KEY]: r.path,
    ...(opts.template ? { [PATH_TEMPLATE_KEY]: r.template } : {}),
  }))
}
