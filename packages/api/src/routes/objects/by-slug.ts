/**
 * File Name: by-slug.ts
 * Purpose: GET /api/v1/objects/by-slug/:slug — fetches a single content object
 *   by its slug, with optional relation/media expansion, richtext serialization,
 *   Redis caching, and disabled-block stripping for public (non-admin) callers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, relation-loader,
 *   object-loader, media-loader, richtext-serializer, object-cache, strip-disabled
 */
import { eq, and, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition, SerializeHint } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { resolveReadStatus, isPublicPublishedView, applyPublishedSnapshot, assertRowPublished } from '../../lib/public-view'
import { computeHasDraftChanges, coerceNumericFields, stripDisabledFields, stripInternalColumns } from '../../services/local-client'
import { expandComponentRelations, makeNestedLoader, makeTargetExpander } from '../../services/component-relation-expansion'
import { projectComponentValues } from '../../services/component-projection'
import { normalizeRangeReads, normalizeManyRelationReads } from '../../services/field-validator'
import { getRelationFields, expandRelations } from '../../services/relation-loader'
import { getObjectFields, expandObjectFields } from '../../services/object-loader'
import { expandMediaDeep } from '../../services/media-loader'
import { resolveLinksDeep } from '../../services/link-loader'
import { applySerialize } from '../../services/richtext-serializer'
import {
  resolveTypeCacheTtl,
  resolveCacheConfig,
  readObjectCache,
  writeObjectCache,
  objectCacheKey,
} from '../../services/object-cache'
import { stripDisabledBlocks } from '../../lib/strip-disabled'
import { fieldAccessContext, restrictedReadFields, applyFieldAccessMask } from '../../lib/field-access'
import { applyContentSerialize } from '../../services/content-filters'
import { resolveReadLocales, filterI18nMap, buildI18nMap, fetchI18nRows, localizeRow, projectLocalization, publishedI18nSide, publishedI18nMap } from '../../services/i18n'
import { gatewayContextOf } from '../../gateway/request-context'
import { clampRead, readLimitsFor } from '../../gateway/read-limits'

/**
 * Resolves and validates the context needed to execute a by-slug lookup,
 * including the type definition and expansion depth.
 * @param typeName   - Content type name from the ?type query param
 * @param depthParam - Relation expansion depth from the ?depth query param
 * @param serialize  - Optional per-field richtext serialization hints
 * @param schema     - Workspace schema definition
 * @returns Validated context object with typeDef and numeric depth
 */
export function buildBySlugContext(
  typeName: string | undefined,
  depthParam: string | number | undefined,
  serialize: Record<string, SerializeHint> | undefined,
  schema: SchemaDefinition,
) {
  if (!typeName) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: type')
  }
  const typeDef = schema.types.find(t => t.name === typeName)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`, 404)
  }
  const depth = Math.max(0, Number(depthParam ?? 0))
  return { typeName, typeId: typeDef.id ?? typeName, typeDef, depth, serialize }
}

/**
 * Registers GET /api/v1/objects/by-slug/:slug.
 * Looks up the object by slug within the workspace env, respects the Redis
 * cache for public callers, expands relations and media at depth >= 1,
 * serializes richtext fields, and strips disabled content blocks for
 * non-admin requests.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with the by-slug route registered
 */
/** Handler for slug lookup; ctx.query.type carries the content type. */
export const handleGetBySlug = async (ctx: any) => {
    const { params, query, request, db, redis, schema, workspaceId, memberId, workspaceProjects } = ctx
    const slug = decodeURIComponent(params.slug as string)

    const { typeName, typeDef, depth: requestedDepth, serialize } = buildBySlugContext(
      query.type as string | undefined,
      query.depth as string | undefined,
      query.serialize as Record<string, SerializeHint> | undefined,
      schema,
    )
    // M6: ?depth= meets the resolved maxRelationDepth - clamped, never refused.
    const depth = clampRead(gatewayContextOf(ctx), readLimitsFor(ctx), { depth: requestedDepth }).depth ?? requestedDepth

    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
    }

    const isAdminCall = !!memberId
    const effectiveStatus = resolveReadStatus({
      memberId, permissions: ctx.permissions, typeName, requested: (query.status as string | undefined) ?? null,
    })
    const publicView = isPublicPublishedView(ctx, effectiveStatus)
    const finalize = (r: Record<string, unknown>): Record<string, unknown> => {
      let out = stripDisabledFields([r], typeDef)[0]
      if (!isAdminCall) out = stripInternalColumns([out])[0]
      return out
    }
    const presentRow = (raw: Record<string, unknown>): Record<string, unknown> => {
      const r = coerceNumericFields([raw], typeDef)[0]
      if (!publicView) {
        // One draft-changes rule for preview keys and members alike (K3).
        return { ...finalize(r), hasDraftChanges: computeHasDraftChanges(raw, typeDef) }
      }
      assertRowPublished(r)
      return finalize(applyPublishedSnapshot([r], 'published')[0])
    }
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const readLocales = resolveReadLocales(query.locale as string | undefined, projectLocalization(project), { isMember: isAdminCall })
    const locale = readLocales?.mode === 'overlay' ? readLocales.locale : null
    const envCacheConfig = resolveCacheConfig(project)
    const workspaceCacheConfig = project?.cache
    const ttl = isAdminCall ? null : resolveTypeCacheTtl(typeName, envCacheConfig, workspaceCacheConfig)

    const noCacheHeader = request.headers.get('cache-control') === 'no-cache'
    const cacheKey = ttl !== null ? objectCacheKey(workspaceId, typeName, `slug:${slug}`) : null

    const cached = cacheKey && !noCacheHeader ? await readObjectCache(redis, cacheKey) : null

    const objectFields = depth >= 1 ? getObjectFields(typeDef) : []
    const relationFields = depth >= 1 ? getRelationFields(typeDef) : []
    // Media expands at every depth (blocks and rows included), resolving
    // registry-named blocks through the workspace's components.
    const mediaRegistry = ((workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never

    let serialized: Record<string, unknown>

    async function applyLocale(rows: Record<string, unknown>[], raw: Record<string, unknown>): Promise<Record<string, unknown>[]> {
      if (!readLocales) return rows
      // Public reads take the publish-time snapshot from the RAW row in
      // either mode - live side rows are draft state and must not leak (K0).
      if (publicView) {
        if (readLocales.mode === 'map') {
          return rows.map(r => ({ ...r, i18n: filterI18nMap(publishedI18nMap(raw), readLocales.locales) }))
        }
        const side = publishedI18nSide(raw, readLocales.locale)
        return rows.map(r => localizeRow(r, side, typeDef))
      }
      if (readLocales.mode === 'map') {
        const sideRows = await fetchI18nRows(db, typeName, rows.map(r => r.id as string), 'all')
        return rows.map(r => ({
          ...r,
          i18n: filterI18nMap(
            buildI18nMap(sideRows.filter(sr => sr.objectId === r.id), typeDef),
            readLocales.locales,
          ),
        }))
      }
      const sideRows = await fetchI18nRows(db, typeName, rows.map(r => r.id as string), readLocales.locale)
      const byId = new Map(sideRows.map(r => [r.objectId, r]))
      return rows.map(r => localizeRow(r, byId.get(r.id as string), typeDef))
    }

    if (cached) {
      let result: Record<string, unknown>[] = [presentRow(cached)]
      result = await applyLocale(result, cached)
      if (depth >= 1) {
        result = await expandRelations(result, relationFields, db, workspaceId, { schema, depth, publicView })
        result = await expandObjectFields(result, objectFields, db, workspaceId, schema, depth, publicView)
        // CR-3: relations nested in component blocks — resolve-and-filter (ACF model)
        result = await expandComponentRelations(result, typeDef, {
          registry: ((workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never,
          schema,
          loadByIds: makeNestedLoader(db, contentTables as Record<string, any>, workspaceId, publicView),
          depth,
          expandTarget: makeTargetExpander({ db, schema, workspaceId, publicView, registry: ((workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never }),
          })
      }
      result = normalizeManyRelationReads(normalizeRangeReads(result, typeDef.fields), typeDef.fields)
      result = await expandMediaDeep(result, typeDef, mediaRegistry, db, workspaceId, locale)
      result = await resolveLinksDeep(result, typeDef, mediaRegistry, db, workspaceId, { publicView, locale })
      // C5 read side: the response follows the CURRENT component definition.
      result = result.map(r => projectComponentValues(typeDef, mediaRegistry as never, r))
      ;[serialized] = applySerialize(
        result.map(r => ({ ...r, type: typeName })),
        serialize,
      )
    } else {
      const rows = await db
        .select()
        .from(table)
        .where(
          and(
            eq(table.workspaceId, workspaceId),
            sql`${sql.raw('"slug"')} = ${slug}`,
          ),
        )
        .limit(1)

      if (!rows.length) {
        throw new RequestError('NOT_FOUND', `No object with slug "${slug}" found`, 404)
      }

      if (cacheKey && ttl !== null) {
        await writeObjectCache(redis, cacheKey, rows[0] as Record<string, unknown>, ttl)
      }

      let result: Record<string, unknown>[] = [presentRow((rows as Record<string, unknown>[])[0])]
      result = await applyLocale(result, (rows as Record<string, unknown>[])[0])

      if (depth >= 1) {
        result = await expandRelations(result, relationFields, db, workspaceId, { schema, depth, publicView })
        result = await expandObjectFields(result, objectFields, db, workspaceId, schema, depth, publicView)
        // CR-3: relations nested in component blocks — resolve-and-filter (ACF model)
        result = await expandComponentRelations(result, typeDef, {
          registry: ((workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never,
          schema,
          loadByIds: makeNestedLoader(db, contentTables as Record<string, any>, workspaceId, publicView),
        })
      }

      result = normalizeManyRelationReads(normalizeRangeReads(result, typeDef.fields), typeDef.fields)
      result = await expandMediaDeep(result, typeDef, mediaRegistry, db, workspaceId, locale)
      result = await resolveLinksDeep(result, typeDef, mediaRegistry, db, workspaceId, { publicView, locale })
      // C5 read side: the response follows the CURRENT component definition.
      result = result.map(r => projectComponentValues(typeDef, mediaRegistry as never, r))
      ;[serialized] = applySerialize(
        result.map(r => ({ ...r, type: typeName })),
        serialize,
      )
    }

    let finalData = isAdminCall ? serialized : stripDisabledBlocks(serialized, typeDef)
    if (ctx.memberId) {
      ;[finalData] = applyFieldAccessMask([finalData], restrictedReadFields(typeDef, fieldAccessContext(ctx)))
    }
    // K4.4: content.serialize@1 - the row as it will be returned.
    ;[finalData] = await applyContentSerialize({ workspaceId: ctx.workspaceId, typeName, rows: [finalData], status: (ctx.query?.status as string | undefined) ?? null, context: { exec: ctx.exec ?? null } })
    return { data: finalData }
}


