/**
 * File Name: ancestors.ts
 * Purpose: The chain a row SITS UNDER, root first, for a whole page of rows in
 *          one recursive query.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This exists because the Admin cannot work it out itself.
 *          A hierarchical list is paginated like any other, and the tree view
 *          built its hierarchy from the rows of ONE PAGE: any row whose parent
 *          was not in that page was promoted to the root, so a search, a
 *          filter, or simply page 2 displayed children as top-level rows. The
 *          chain has to come from the database, where the whole tree is.
 *
 *          Deliberately NOT part of path-resolver.ts, which answers an
 *          ADDRESS and selects slugs. This answers titles, for display. The
 *          two share a shape - one recursive walk up, bounded, cycle-guarded -
 *          rather than a function, because conflating "where does this live on
 *          the web" with "where does this sit in the tree" is how one of them
 *          ends up wrong.
 *
 *          Bounded by the same PATH_MAX_SEGMENTS: a tree deeper than that has
 *          no usable address either, and the bound is what stops a cycle
 *          written straight through SQL from spinning here.
 */
import { sql } from 'drizzle-orm'
import { PATH_MAX_SEGMENTS } from '@tangen/schema'

/** One ancestor, with enough to render and to link it. */
export interface AncestorRef {
  id: string
  title: string | null
}

export interface AncestorDeps {
  db: any
  workspaceId: string
}

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

/**
 * The ancestors of every row, parallel to the rows given, root first and
 * EXCLUDING the row itself - so a root answers `[]` and renders no prefix.
 *
 * One query for the page, whatever its size and however deep the tree: the
 * walk starts from every row at once and the depth is a column, not a round
 * trip.
 */
export async function ancestorsFor(
  rows: ReadonlyArray<Record<string, unknown>>,
  typeName: string,
  parentField: string,
  deps: AncestorDeps,
): Promise<AncestorRef[][]> {
  if (rows.length === 0) return []

  const seeds = [...new Set(rows.map((r) => String(r.id)).filter(Boolean))]
  if (seeds.length === 0) return rows.map(() => [])

  const t = sql.identifier(typeName)
  const p = sql.identifier(parentField)
  const res = await deps.db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id AS origin, id, title, ${p} AS next, 0 AS depth, ARRAY[id] AS seen
        FROM ${t}
       WHERE workspace_id = ${deps.workspaceId}
         AND id IN (${sql.join(seeds.map((s) => sql`${s}`), sql`, `)})
      UNION ALL
      SELECT c.origin, n.id, n.title, n.${p}, c.depth + 1, c.seen || n.id
        FROM ${t} n
        JOIN chain c ON n.id = c.next
       WHERE n.workspace_id = ${deps.workspaceId}
         AND c.depth < ${PATH_MAX_SEGMENTS}
         AND NOT (n.id = ANY(c.seen))
    )
    SELECT origin, id, title, depth FROM chain WHERE depth > 0 ORDER BY origin, depth DESC`)

  // depth DESC puts the furthest ancestor - the root - first, which is the
  // order a breadcrumb reads in.
  const byOrigin = new Map<string, AncestorRef[]>()
  for (const r of rowsOf(res)) {
    const key = String(r.origin)
    const list = byOrigin.get(key) ?? []
    list.push({ id: String(r.id), title: r.title == null ? null : String(r.title) })
    byOrigin.set(key, list)
  }

  return rows.map((r) => byOrigin.get(String(r.id)) ?? [])
}

/**
 * The self-referential parent field of a HIERARCHICAL type, or null.
 *
 * The same three conditions the Admin's tree used: a relation, pointing at
 * this very type, holding one. A type that is not declared hierarchical
 * answers null even if it happens to have such a field, because the hierarchy
 * is a declaration and not an accident of the field list.
 */
export function selfParentFieldOf(
  typeDef: { admin?: { taxonomy?: { hierarchical?: boolean } }; fields?: Array<{ name: string; fieldType: string; config?: Record<string, unknown> }> } | undefined,
  typeName: string,
): string | null {
  if (!typeDef?.admin?.taxonomy?.hierarchical) return null
  const field = (typeDef.fields ?? []).find(
    (f) => f.fieldType === 'relation'
      && (f.config as { targetType?: string } | undefined)?.targetType === typeName
      && !(f.config as { many?: boolean } | undefined)?.many,
  )
  return field?.name ?? null
}
