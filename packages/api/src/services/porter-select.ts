/**
 * File Name: porter-select.ts
 * Purpose: Server-side filtered selection for migration. The sheet never
 *   lists a thousand objects - it shows the TOTAL and a latest-10 preview,
 *   and filters (multiple ids, multiple slugs, status, updated date range)
 *   resolve in the database. The full id list rides along for the run.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { eq, and, or, inArray, gte, lte, desc, count, ilike, notIlike, sql } from 'drizzle-orm'

/** Columns a FilterBar contains-token may target. */
const CONTAINS_COLUMNS = new Set(['title', 'slug', 'id'])

export interface MigrationSelectFilter {
  ids?: string[]
  slugs?: string[]
  /** A single status (eq) or a list (in). An empty list matches nothing. */
  status?: string | string[]
  /** FilterBar text tokens: case-insensitive contains (or not-contains) on
   *  title/slug/id. Each entry is its own condition in any-mode. */
  fields?: { name: 'title' | 'slug' | 'id'; contains: string; not?: boolean }[]
  /** Labels facet (S19): set ops over entity_tags, or a name substring.
   *  ONE condition regardless of how many labels; needs opts.entityType. */
  labels?: { values: string[]; op: 'all' | 'any' | 'none' | 'contains' | 'starts' | 'ends' }
  /** ISO timestamps bounding updatedAt (inclusive). */
  updatedFrom?: string
  updatedTo?: string
  /** 'all' (default) intersects the filters; 'any' unions them. Workspace
   *  and environment scoping is ALWAYS an intersection - never part of the OR. */
  match?: 'all' | 'any'
  /** Case-insensitive contains over title and slug. Combines with the rest
   *  per `match` like any other filter. */
  search?: string
}

export interface MigrationSelectOptions {
  page?: number
  pageSize?: number
  /** Include the FULL matching id list (only ask at migrate time). */
  withIds?: boolean
  /** entity_tags entity type (content:<typeName>) - required for the labels
   *  facet; without it a labels filter is ignored. */
  entityType?: string
}

export interface MigrationSelection {
  total: number
  /** One page of rows (updatedAt desc). */
  rows: {
    id: string
    title: string | null
    slug: string | null
    status: string | null
    updatedAt: unknown
  }[]
  /** Present only when opts.withIds - the full matching id list for a run. */
  ids?: string[]
}

const DEFAULT_PAGE_SIZE = 50

/**
 * One SQL condition for the labels facet, over entity_tags. Set ops match
 * whole tags; substring ops (contains/starts/ends) match the tag NAME
 * case-insensitively with the single provided term.
 */
function labelsCondition(
  table: any,
  workspaceId: string,
  entityType: string,
  labels: NonNullable<MigrationSelectFilter['labels']>,
): any {
  const tagExists = (tagCond: any) => sql`EXISTS (
    SELECT 1 FROM entity_tags et
    WHERE et.workspace_id = ${workspaceId}
      AND et.entity_type = ${entityType} AND et.entity_id = ${table.id}
      AND ${tagCond})`

  if (labels.op === 'all') {
    return and(...labels.values.map((v) => tagExists(sql`et.tag = ${v}`)))
  }
  if (labels.op === 'any') {
    return tagExists(inArray(sql`et.tag`, labels.values))
  }
  if (labels.op === 'none') {
    return sql`NOT ${tagExists(inArray(sql`et.tag`, labels.values))}`
  }
  const term = labels.values[0]
  if (!term) return undefined
  const pattern = labels.op === 'contains' ? `%${term}%` : labels.op === 'starts' ? `${term}%` : `%${term}`
  return tagExists(sql`et.tag ILIKE ${pattern}`)
}

export async function selectObjectsForMigration(
  db: any,
  workspaceId: string,
  table: any,
  filter: MigrationSelectFilter,
  opts: MigrationSelectOptions = {},
): Promise<MigrationSelection> {
  const scope = [eq(table.workspaceId, workspaceId)]
  const userConds: any[] = []
  if (filter.ids && filter.ids.length > 0) userConds.push(inArray(table.id, filter.ids))
  if (filter.slugs && filter.slugs.length > 0 && table.slug !== undefined) {
    userConds.push(inArray(table.slug, filter.slugs))
  }
  if (Array.isArray(filter.status)) {
    // An empty list is an explicit "none of the statuses" - match nothing.
    userConds.push(filter.status.length > 0 ? inArray(table.status, filter.status) : sql`false`)
  } else if (filter.status) {
    userConds.push(eq(table.status, filter.status))
  }
  for (const f of filter.fields ?? []) {
    if (!CONTAINS_COLUMNS.has(f.name) || table[f.name] === undefined) continue
    const value = String(f.contains ?? '').trim()
    if (!value) continue
    const term = `%${value}%`
    userConds.push(f.not ? notIlike(table[f.name], term) : ilike(table[f.name], term))
  }
  if (filter.search && filter.search.trim()) {
    const term = `%${filter.search.trim()}%`
    userConds.push(table.slug !== undefined
      ? or(ilike(table.title, term), ilike(table.slug, term))
      : ilike(table.title, term))
  }
  if (filter.labels && filter.labels.values.length > 0 && opts.entityType) {
    const cond = labelsCondition(table, workspaceId, opts.entityType, filter.labels)
    if (cond) userConds.push(cond)
  }
  const range: any[] = []
  if (filter.updatedFrom) range.push(gte(table.updatedAt, new Date(filter.updatedFrom)))
  if (filter.updatedTo) range.push(lte(table.updatedAt, new Date(filter.updatedTo)))
  // A date range is one condition (from AND to), even in 'any' mode.
  if (range.length > 0) userConds.push(range.length === 1 ? range[0] : and(...range))

  const combined = userConds.length === 0
    ? undefined
    : filter.match === 'any' && userConds.length > 1
      ? or(...userConds)
      : and(...userConds)
  const where = combined ? and(...scope, combined) : and(...scope)

  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), 200)
  const page = Math.max(opts.page ?? 1, 1)

  const [totalRows, rows, idRows] = await Promise.all([
    db.select({ n: count() }).from(table).where(where) as Promise<{ n: number }[]>,
    db.select({ id: table.id, title: table.title, slug: table.slug, status: table.status, updatedAt: table.updatedAt })
      .from(table)
      .where(where)
      .orderBy(desc(table.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize) as Promise<MigrationSelection['rows']>,
    opts.withIds
      ? db.select({ id: table.id }).from(table).where(where) as Promise<{ id: string }[]>
      : Promise.resolve(null),
  ])

  return {
    total: Number(totalRows[0]?.n ?? 0),
    rows,
    ...(idRows ? { ids: idRows.map((r: { id: string }) => r.id) } : {}),
  }
}
