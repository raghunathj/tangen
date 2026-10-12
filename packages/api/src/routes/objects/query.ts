/**
 * File Name: query.ts
 * Purpose: Elysia route plugin for POST /api/v1/objects/query, supporting filtering, sorting, pagination,
 *          relation/media expansion, richtext serialization, and optional Redis result caching.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db contentTables and extensionData, query-compiler, relation-loader,
 *                     media-loader, richtext-serializer, and route-cache services.
 */
import { eq, and, ne, asc, desc, sql, inArray, notInArray, getTableColumns } from 'drizzle-orm'
import { flattenFields } from '@tangen/types'
import type { SQL } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { Elysia, t } from 'elysia'
import { extensionData } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import type { QueryObject } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { resolveReadStatus, isPublicPublishedView, applyPublishedSnapshot } from '../../lib/public-view'
import { computeHasDraftChanges, coerceNumericFields, stripDisabledFields, stripInternalColumns } from '../../services/local-client'
import { expandComponentRelations, makeNestedLoader, makeTargetExpander } from '../../services/component-relation-expansion'
import { projectComponentValues } from '../../services/component-projection'
import { normalizeRangeReads, normalizeManyRelationReads } from '../../services/field-validator'
import { resolveReadLocales, filterI18nMap, buildI18nMap, fetchI18nRows, localizeRow, publishedI18nSide, publishedI18nMap, projectLocalization, localizedFieldNames } from '../../services/i18n'
import { compileBaseQuery, conditionToSQL, buildSelectColumns, cursorToSQL, encodeCursor, referencedByToSQL, localizedColumnExpr, cursorSortSelection, cursorSortValue, CURSOR_SORT } from '../../services/query-compiler'
import { extractLabelFilter, filterEntityIds, contentEntityType, listTagsForEntities } from '../../services/tags'
import { stripDisabledBlocks } from '../../lib/strip-disabled'
import { fieldAccessContext, restrictedReadFields, applyFieldAccessMask } from '../../lib/field-access'
import { applyContentSerialize } from '../../services/content-filters'
import { getRelationFields, expandRelations, applyProps } from '../../services/relation-loader'
import { getObjectFields, expandObjectFields } from '../../services/object-loader'
import { expandMediaDeep } from '../../services/media-loader'
import { resolveLinksDeep } from '../../services/link-loader'
import { applySerialize } from '../../services/richtext-serializer'
import { queryCacheKeyFor, withQueryCache, collectQueryTags } from '../../services/route-cache'
import { applyFieldAfterRead, getActiveBehaviorRegistry } from '../../services/field-behavior'
import { gatewayContextOf } from '../../gateway/request-context'
import { clampRead, readLimitsFor, type ReadClamp } from '../../gateway/read-limits'
import { emitQueryFacts, queryObserverCount, type QueryFacts } from '../../services/query-observer'
import { qmAls } from '../../lib/query-monitor'

function hashQueryObject(input: QueryObject): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)
}

/**
 * TypeBox schema for the static envelope of a query request. Field-level filter
 * semantics stay schema-aware in the query compiler; this rejects malformed
 * shapes (missing type, non-numeric limit, bad sort) with a 422 before the
 * handler runs. Additional properties are allowed for forward compatibility.
 */
/** Transient column carrying the admin draft-changes indicator through the page query. */
const DRAFT_FLAG = '__has_draft_app_data'

export const queryBodySchema = t.Object({
  type: t.String(),
  status: t.Optional(t.String()),
  query: t.Optional(t.Record(t.String(), t.Any())),
  cacheStrategy: t.Optional(t.Object({ ttl: t.Number(), swr: t.Optional(t.Number()) })),
  sort: t.Optional(t.Object({
    field: t.String(),
    direction: t.Union([t.Literal('asc'), t.Literal('desc')]),
  })),
  limit: t.Optional(t.Number()),
  offset: t.Optional(t.Number()),
  after: t.Optional(t.String()),
  depth: t.Optional(t.Number()),
  props: t.Optional(t.Array(t.String())),
  populate: t.Optional(t.Record(t.String(), t.Array(t.String()))),
  serialize: t.Optional(t.Record(t.String(), t.Any())),
  locale: t.Optional(t.String()),
  includeLabels: t.Optional(t.Boolean()),
  total: t.Optional(t.Boolean()),
})


/**
 * The keys a query body may carry, DERIVED from the schema so the two cannot
 * drift. Held as a separate check because Elysia normalises unknown properties
 * away before validation, so `additionalProperties: false` never fires - and
 * because by the time a handler reads `ctx.body`, the unknown key is already
 * gone. The guard therefore runs against the RAW parsed body.
 */
export const QUERY_BODY_KEYS = new Set(
  Object.keys((queryBodySchema as unknown as { properties: Record<string, unknown> }).properties),
)

/**
 * An unknown key used to be dropped in silence, so a caller who sent `where` -
 * the SDK builder's own vocabulary, not the wire key - got 200 and an
 * UNFILTERED list. Being handed the wrong rows is worse than being told no.
 */
export function assertKnownQueryKeys(body: unknown, allowed: Set<string> = QUERY_BODY_KEYS): void {
  if (!body || typeof body !== 'object') return
  const unknown = Object.keys(body as Record<string, unknown>).filter((k) => !allowed.has(k))
  if (unknown.length === 0) return
  throw new RequestError(
    'VALIDATION_ERROR',
    `Unknown query ${unknown.length > 1 ? 'keys' : 'key'} ${unknown.map((k) => `"${k}"`).join(', ')}. ` +
    `A filter goes in "query" - the SDK's .where() writes it there. Supported: ${[...allowed].sort().join(', ')}.`,
  )
}

/**
 * Elysia plugin providing POST /api/v1/objects/query with optional Redis result caching for non-admin callers.
 * @returns Elysia plugin function
 */
/**
 * Handler for object queries. Expects ctx.body to be a full QueryObject
 * (including type) — the resource router injects type from the :type path param.
 */
export const handleQuery = async (ctx: any) => {
  const { redis, workspaceId, memberId, schema, request } = ctx

  // M6: `limit` and `depth` meet the resolved ceilings here, before the cache
  // key is taken, so a clamped read and the read it became share one entry.
  // Clamped, never refused; the meta below says what was applied.
  const limits = readLimitsFor(ctx)
  const requested = ctx.body as QueryObject
  const { limit, depth, clamped } = clampRead(gatewayContextOf(ctx), limits, requested)
  if (clamped) {
    ctx.body = { ...requested, ...(limit !== undefined ? { limit } : {}), ...(depth !== undefined ? { depth } : {}) }
    ctx.readClamp = clamped
  }
  ctx.readMaxLimit = limits.maxQueryLimit
  const input = ctx.body as QueryObject

  // Cache wrapping: skip for admin callers (memberId present) and when no cacheStrategy
  const run = () => {
    if (!memberId && input.cacheStrategy && redis) {
      // The key carries the SCHEMA it was answered under, so a schema push
      // cannot serve a result shaped by the old one (Phase 6B, Unit 4).
      const queryKey = queryCacheKeyFor(schema, hashQueryObject(input))
      const noCacheRead = request?.headers?.get?.('cache-control') === 'no-cache'
      const tags = collectQueryTags(schema, input.type, input.depth ?? 0)
      return withQueryCache(redis, workspaceId, input.type, queryKey, input.cacheStrategy, () => executeQuery(ctx), { tags, noCacheRead })
    }
    return executeQuery(ctx)
  }
  // The observation seam (services/query-observer.ts): one fact per read for
  // whatever Telemetry becomes. Nobody listening costs a Set size check.
  if (queryObserverCount() === 0) return run()
  const started = performance.now()
  try {
    const result = await run()
    emitQueryFacts(queryFactsOf(ctx, input, started, result as { data?: unknown[]; meta?: Record<string, unknown> }))
    return result
  } catch (e) {
    emitQueryFacts({ ...queryFactsOf(ctx, input, started, null), ok: false, errorCode: codeOf(e) })
    throw e
  }
}

/** The stable code of a thrown RequestError, never its message. */
function codeOf(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'INTERNAL'
}

/** The shape facts of one read: nothing here comes from the data itself. */
function queryFactsOf(ctx: any, input: QueryObject, started: number, result: { data?: unknown[]; meta?: Record<string, unknown> } | null): QueryFacts {
  const meta = result?.meta ?? {}
  const cache = meta.cache
  const total = meta.total
  return {
    requestId: gatewayContextOf(ctx)?.requestId ?? null,
    workspaceId: String(ctx.workspaceId ?? ''),
    type: String(input.type ?? ''),
    operation: 'query',
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    rows: Array.isArray(result?.data) ? result!.data!.length : 0,
    total: typeof total === 'number' ? total : null,
    depth: input.depth ?? 0,
    cache: cache === 'hit' || cache === 'stale' || cache === 'miss' ? cache : null,
    statements: qmAls.getStore()?.queries.length ?? null,
    ok: result !== null,
    errorCode: null,
  }
}

async function executeQuery(ctx: any) {
    const { body, db, schema, workspaceId, memberId, workspaceProjects } = ctx
    assertKnownQueryKeys(body)
    const input = body as QueryObject

    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    // Reads accept a single code (overlay), 'all', or a comma list ('de,ta' → map)
    const readLocales = resolveReadLocales(input.locale, projectLocalization(project), { isMember: !!memberId })
    const locale = readLocales?.mode === 'overlay' ? readLocales.locale : readLocales ? 'all' : null

    // Public/admin boundary: API keys read the published web unless the key
    // holds objects:read_draft and asked explicitly (preview keys).
    const effectiveStatus = resolveReadStatus({
      memberId, permissions: ctx.permissions, typeName: input.type, requested: input.status ?? null,
    })
    const publicView = isPublicPublishedView(ctx, effectiveStatus)
    // `labels` is an operational-tag filter, not a column — pull it out of the query
    // filter before compileBaseQuery (which rejects unknown filter fields) and
    // resolve it below.
    const rawFilter = (input.query ?? {}) as Record<string, unknown>
    const labelFilter = extractLabelFilter(rawFilter.labels ?? rawFilter._labels)
    const queryForCompile = labelFilter
      ? Object.fromEntries(Object.entries(rawFilter).filter(([k]) => k !== 'labels' && k !== '_labels'))
      : input.query

    const { typeName, statusFilter, excludeArchived, fieldFilters, sortField, sortDirection, limit, offset, referencedBy, cursor, wantTotal } =
      compileBaseQuery({ ...input, query: queryForCompile as never, status: (effectiveStatus ?? input.status) as never }, schema, { maxLimit: ctx.readMaxLimit })

    // TL-2: a disabled type answers exactly like an unknown one — read AND write
    const typeDefGate = schema.types.find((t: any) => t.name === typeName)
    if (!typeDefGate || typeDefGate.disabled) {
      throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
    }


    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
    }

    const conditions = [
      eq(table.workspaceId, workspaceId),
      ]
    if (statusFilter) {
      conditions.push(eq(table.status, statusFilter))
    } else if (excludeArchived) {
      conditions.push(ne(table.status, 'archived'))
    }
    // Non-default locale: filters/sorts on localized columns read the side table
    const typeDefForI18n = schema.types.find((t: any) => t.name === typeName)
    const i18nCtx = locale && locale !== 'all' && typeDefForI18n && localizedFieldNames(typeDefForI18n).length > 0
      ? { locale, localizedColumns: new Set([...localizedFieldNames(typeDefForI18n), 'title']) }
      : undefined
    for (const f of fieldFilters) conditions.push(conditionToSQL(f, { workspaceId, sourceTypeName: typeName, i18n: i18nCtx }))
    if (referencedBy) conditions.push(referencedByToSQL(referencedBy, typeName, workspaceId))
    // Operational-labels filter → constrain by matching ids. 'none' excludes records
    // that HAVE any of the labels (no match ⇒ everything passes); others require a match.
    if (labelFilter) {
      const ids = await filterEntityIds(db, {
        workspaceId, entityType: contentEntityType(typeName),
        tags: labelFilter.tags, op: labelFilter.op,
      })
      if (labelFilter.op === 'none') {
        if (ids.length) conditions.push(notInArray(table.id, ids))
      } else {
        conditions.push(ids.length ? inArray(table.id, ids) : sql`false`)
      }
    }

    // Cursor pagination: keyset predicate + count without it (total stays the full set)
    const countConditions = [...conditions]
    if (cursor) conditions.push(cursorToSQL(cursor, sortField, sortDirection))

    // id tiebreak keeps ordering deterministic so cursors from any page are stable
    const sortExpr = i18nCtx?.localizedColumns.has(sortField)
      ? localizedColumnExpr(typeName, sortField, i18nCtx.locale)
      : sql.raw(`"${sortField}"`)
    const orderExprs = sortDirection === 'asc'
      ? [asc(sortExpr), asc(table.id)]
      : [desc(sortExpr), desc(table.id)]

    // The sort column must be selected even under a props projection — the
    // next-page cursor is built from the last row's sort value.
    const sortJsKey = Object.keys(table).find(k => (table as any)[k]?.name === sortField) ?? sortField
    const colSelection = buildSelectColumns(table, input.props ? [...input.props, sortJsKey] : undefined)
    // The exact total is the dominant database cost of a list over a large
    // type: an index-only scan of every qualifying row, linear in their number,
    // while the page itself is a few dozen buffers. It stays the default - the
    // admin's "showing x of N" and several consumers depend on it - but a caller
    // that does not need it can say so. Without it, one extra row is fetched so
    // hasMore is exact rather than the "page was full" heuristic.
    const fetchLimit = wantTotal ? limit : limit + 1
    // The admin draft-changes indicator rides the page query as a correlated
    // EXISTS instead of a separate statement over the page's ids. Same answer
    // per row; one round trip fewer on every admin list. It is a few index
    // probes now that extension_data is indexed by object (0040) - without
    // that index the separate query was already a full scan of extension_data
    // on every list, and the fold would have been twenty of them.
    const withDraftFlag = Boolean(memberId)
    const draftFlagExpr = sql<boolean>`EXISTS (SELECT 1 FROM "extension_data" e
      WHERE e."workspace_id" = ${table.workspaceId} AND e."object_id" = ${table.id}
        AND (e."published_data" IS NULL OR e."data"::text != e."published_data"::text))`
    const cursorSel = cursorSortSelection(table as never, sortJsKey)
    const pageSelection = withDraftFlag || cursorSel
      ? { ...(colSelection ?? getTableColumns(table as never)), ...(withDraftFlag ? { [DRAFT_FLAG]: draftFlagExpr } : {}), ...(cursorSel ?? {}) }
      : colSelection
    const [fetched, countRow] = await Promise.all([
      (pageSelection ? db.select(pageSelection as never) : db.select()).from(table).where(and(...conditions)).orderBy(...orderExprs).limit(fetchLimit).offset(offset),
      wantTotal
        ? db.select({ count: sql<number>`COUNT(*)` }).from(table).where(and(...countConditions)).then((r: any[]) => r[0])
        : Promise.resolve(null),
    ])
    const rows = fetched.length > limit ? fetched.slice(0, limit) : fetched

    const total = wantTotal ? Number((countRow as any)?.count ?? 0) : null
    const hasMore = wantTotal
      ? (cursor ? rows.length === limit : offset + rows.length < (total as number))
      : fetched.length > limit

    // Next-page cursor from the last raw row (before expansion mutates values)
    const lastRow = (rows as Record<string, unknown>[])[rows.length - 1]
    const nextCursor = hasMore && lastRow
      ? encodeCursor(cursorSortValue(lastRow, sortJsKey), lastRow.id as string)
      : null
    if (cursorSel) for (const r of rows as Record<string, unknown>[]) delete r[CURSOR_SORT]

    // ── Concurrency (Query Monitor P1): every post-row step that needs only
    // row IDS starts NOW and overlaps the expansion pipeline below - draft
    // flags, labels, and the i18n side-row fetch are all independent reads.
    const rowIds = (rows as Record<string, unknown>[]).map(r => r.id as string)

    // Admin draft-changes flag: read off the page rows (the EXISTS column
    // above), then removed from them so the row shape below is unchanged.
    const draftExtDataIds = new Set<string>()
    if (withDraftFlag) {
      for (const r of rows as Record<string, unknown>[]) {
        if (r[DRAFT_FLAG] === true) draftExtDataIds.add(r.id as string)
        delete r[DRAFT_FLAG]
      }
    }

    const labelsPromise = ((input as { includeLabels?: boolean }).includeLabels && rowIds.length > 0)
      ? listTagsForEntities(db, { workspaceId, entityType: contentEntityType(typeName), entityIds: rowIds })
      : null

    // Public reads come from the publish-time snapshot (below) in both
    // modes, so the live side rows are only needed for member/draft reads (K0).
    const i18nSideRowsPromise = readLocales && !publicView
      ? fetchI18nRows(db, typeName, rowIds, readLocales.mode === 'overlay' ? readLocales.locale : 'all')
      : null

    // Relation + object-field expansion (recursive to depth)
    let expandedRows: Record<string, unknown>[] = rows as Record<string, unknown>[]
    if (publicView) expandedRows = applyPublishedSnapshot(expandedRows, 'published')
    const typeDef = schema.types.find((t: any) => t.name === typeName)!
    expandedRows = coerceNumericFields(expandedRows, typeDef)
    expandedRows = stripDisabledFields(expandedRows, typeDef)
    // Every draft-view read carries the "ahead of published?" marker - one rule
    // for preview keys and members alike; a full-map read counts translations (K3).
    if (!publicView) {
      const rawById = new Map((rows as Record<string, unknown>[]).map((r) => [r.id as string, r]))
      const liveMaps = readLocales?.mode === 'map' && readLocales.locales === 'all' && i18nSideRowsPromise
        ? await i18nSideRowsPromise.then((side) => {
            const grouped = new Map<string, typeof side>()
            for (const sr of side) grouped.set(sr.objectId, [...(grouped.get(sr.objectId) ?? []), sr])
            return new Map([...grouped].map(([oid, list]) => [oid, buildI18nMap(list, typeDef)]))
          })
        : null
      expandedRows = expandedRows.map((r) => ({ ...r, hasDraftChanges: computeHasDraftChanges(rawById.get(r.id as string) ?? r, typeDef, liveMaps?.get(r.id as string) ?? null) }))
    }
    // Drop internal columns (publishedValues/workspaceId) for API-key callers,
    // now that the snapshot overlay + draft-changes marker have used them.
    if (!memberId) expandedRows = stripInternalColumns(expandedRows)

    // Locale overlay — translations from <type>_i18n, per-field default fallback
    // (side rows were fetched concurrently above; only the merge happens here)
    if (readLocales?.mode === 'overlay') {
      // Draft translations must never leak to the public published view -
      // overlay the snapshot taken at publish, not the live side rows.
      const byId = publicView
        ? new Map((rows as Record<string, unknown>[]).map(r => [r.id as string, publishedI18nSide(r, readLocales.locale)]))
        : new Map((await i18nSideRowsPromise!).map(r => [r.objectId, r]))
      expandedRows = expandedRows.map(r => localizeRow(r, byId.get(r.id as string) ?? null, typeDef))
    } else if (readLocales?.mode === 'map' && publicView) {
      // Map mode on the public view: the snapshot's map, never the live rows.
      const rawById = new Map((rows as Record<string, unknown>[]).map(r => [r.id as string, r]))
      expandedRows = expandedRows.map(r => ({
        ...r,
        i18n: filterI18nMap(publishedI18nMap(rawById.get(r.id as string) ?? {}), readLocales.locales),
      }))
    } else if (readLocales?.mode === 'map') {
      // Map mode — every row carries its translations ('all' or the asked-for locales)
      const sideRows = await i18nSideRowsPromise!
      const byId = new Map<string, typeof sideRows>()
      for (const sr of sideRows) {
        const list = byId.get(sr.objectId) ?? []
        list.push(sr)
        byId.set(sr.objectId, list)
      }
      expandedRows = expandedRows.map(r => ({
        ...r,
        i18n: filterI18nMap(buildI18nMap(byId.get(r.id as string) ?? [], typeDef), readLocales.locales),
      }))
    }
    const depth = input.depth ?? 0
    // Media expansion runs AFTER the relation chain (below): it now reaches
    // media inside blocks and rows, the very values the component-relation
    // pass rewrites, so the two can no longer fork and merge per field.
    if (depth >= 1) {
      const relationFields = getRelationFields(typeDef)
      const objectFields = getObjectFields(typeDef)
      // The three expansions rewrite DISJOINT field sets - relation fields,
      // object fields, and component/repeater content (which resolves its
      // nested relations itself) - so they run CONCURRENTLY on the same
      // localized rows and merge per-field afterwards, like the media fork
      // above. Sequentially each stage paid its own DB round-trips.
      const [relRows, objRows, compRows] = await Promise.all([
        relationFields.length > 0
          ? expandRelations(expandedRows, relationFields, db, workspaceId, {
              schema, depth, populate: input.populate, publicView,
            })
          : Promise.resolve(expandedRows),
        objectFields.length > 0
          ? expandObjectFields(expandedRows, objectFields, db, workspaceId, schema, depth, publicView)
          : Promise.resolve(expandedRows),
        // CR-3: relations nested in component blocks — resolve-and-filter (ACF model)
        expandComponentRelations(expandedRows, typeDef, {
          registry: (project?.components ?? []) as never,
          schema,
          loadByIds: makeNestedLoader(db, contentTables as Record<string, any>, workspaceId, publicView),
          depth,
          expandTarget: makeTargetExpander({ db, schema, workspaceId, publicView, registry: (project?.components ?? []) as never }),
        }),
      ])
      const objById = objectFields.length > 0 ? new Map(objRows.map((r) => [r.id as string, r])) : null
      // flattenFields: container fields may sit inside groups (their values
      // are still top-level row keys) - match expandComponentRelations' scan.
      const compFieldNames = flattenFields(typeDef.fields)
        .filter((fd: { fieldType?: string }) => fd.fieldType === 'component' || fd.fieldType === 'repeater')
        .map((fd: { name: string }) => fd.name)
      const compById = compFieldNames.length > 0 ? new Map(compRows.map((r) => [r.id as string, r])) : null
      expandedRows = relRows.map((r) => {
        if (!objById && !compById) return r
        const out = { ...r }
        const o = objById?.get(r.id as string)
        if (o) for (const { fieldName } of objectFields) out[fieldName] = o[fieldName]
        const c = compById?.get(r.id as string)
        if (c) for (const name of compFieldNames) out[name] = c[name]
        return out
      })
    }

    expandedRows = normalizeManyRelationReads(normalizeRangeReads(expandedRows, typeDef.fields), typeDef.fields)
    // Media at every depth - top-level columns and the blocks/rows under them
    // (kit.image in a Studio page, a cover inside a site block). One query.
    expandedRows = await expandMediaDeep(expandedRows, typeDef, (project?.components ?? []) as never, db, workspaceId, locale === 'all' ? null : locale)
    // One batched target lookup for the whole page of rows, whatever the
    // page size - a link consumes no relation depth (Phase 6B, Units 12/13).
    expandedRows = await resolveLinksDeep(expandedRows, typeDef, (project?.components ?? []) as never, db, workspaceId, { publicView, locale: locale === 'all' ? null : locale })

    // Richtext serialisation
    // Field-level afterRead hooks (behavior overlay) — no-op for hook-less types
    const afterReadCtx = { workspaceId }
    expandedRows = expandedRows.map(r => applyFieldAfterRead(getActiveBehaviorRegistry(), workspaceId, typeDef, r, afterReadCtx))
    // C5 read side: the response follows the CURRENT component definition.
    expandedRows = expandedRows.map(r => projectComponentValues(typeDef, (project?.components ?? []) as never, r))

    const serialized = applySerialize(
      expandedRows.map(row => ({ ...row, type: typeName })),
      input.serialize,
    )

    // Props filter
    const filtered = applyProps(serialized, input.props)

    // Merge draft app-data flag (admin only; public callers always get false)
    const data = draftExtDataIds.size > 0
      ? filtered.map(row => ({ ...row, _has_draft_app_data: draftExtDataIds.has(row.id as string) }))
      : filtered

    const finalData = memberId
      ? data
      : data.map(row => stripDisabledBlocks(row as Record<string, unknown>, typeDef))

    // Field-level read mask — members only (API keys unaffected in v1)
    const maskedRows = memberId
      ? applyFieldAccessMask(finalData as Record<string, unknown>[], restrictedReadFields(typeDef, fieldAccessContext(ctx)))
      : finalData
    // K4.4: content.serialize@1 - the rows as they will be returned.
    const masked = await applyContentSerialize({ workspaceId, typeName, rows: maskedRows as Record<string, unknown>[], status: (effectiveStatus ?? input.status ?? null) as string | null, context: { exec: ctx.exec ?? null } })

    // Opt-in operational labels — fetched concurrently above, attached as `_labels`.
    let withLabels = masked as Record<string, unknown>[]
    if (labelsPromise) {
      const byId = await labelsPromise
      withLabels = withLabels.map((r) => ({ ...r, _labels: byId[r.id as string] ?? [] }))
    }

    const clamped = ctx.readClamp as ReadClamp | undefined
    return { data: withLabels, meta: { total, limit, offset, hasMore, nextCursor, ...(clamped ? { clamped } : {}) } }
}
