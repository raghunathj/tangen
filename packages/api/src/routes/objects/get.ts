/**
 * File Name: get.ts
 * Purpose: Handles GET /api/v1/objects/:id — fetches a single content object with optional
 *          relation/media expansion, Redis caching, and extension-data attachment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; admin calls (member JWT) bypass Redis cache;
 *   public calls serve published extension data from a separate cache key.
 */
import { eq, and } from 'drizzle-orm'
import { extensionData } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import type { SerializeHint } from '@tangen/types'
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
import { extensionDataCacheKey, publishedExtensionDataCacheKey, EXTENSION_DATA_CACHE_TTL } from '../../hooks/runner'
import { stripDisabledBlocks } from '../../lib/strip-disabled'
import { fieldAccessContext, restrictedReadFields, applyFieldAccessMask } from '../../lib/field-access'
import { applyContentSerialize } from '../../services/content-filters'
import { applyFieldAfterRead, getActiveBehaviorRegistry } from '../../services/field-behavior'
import { resolveReadLocales, filterI18nMap, fetchI18nRows, localizeRow, buildI18nMap, projectLocalization, publishedI18nSide, publishedI18nMap } from '../../services/i18n'
import { pickAuditActorIds, resolveActorLabels, buildAudit, type AuditInfo } from '../../lib/actor'
import { gatewayContextOf } from '../../gateway/request-context'
import { clampRead, readLimitsFor } from '../../gateway/read-limits'
import { attachObjectEtag } from '../../lib/object-etag'

/**
 * Validates query parameters and resolves the type definition for a GET object request.
 * @param typeName - The ?type query parameter value from the request.
 * @param depthParam - The ?depth query parameter controlling relation expansion depth.
 * @param serialize - Optional per-field serialization hints (e.g. richtext format).
 * @param schema - Workspace schema definition used to look up the type.
 * @returns Resolved typeName, typeId, typeDef, depth, and serialize hint map.
 */
export function buildGetContext(
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
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
  }
  const depth = Math.max(0, Number(depthParam ?? 0))
  return { typeName, typeId: typeDef.id ?? typeName, typeDef, depth, serialize }
}

/**
 * Handler for fetching a single object by id. The content type comes from
 * ctx.query.type — the resource router injects it from the :type path param;
 * the legacy dispatcher passes it through from ?type=.
 */
export const handleGetById = async (ctx: any) => {
    const { params, query, request, db, redis, schema, workspaceId, memberId, workspaceProjects, set } = ctx
    const { id } = params

    const { typeName, typeDef, depth: requestedDepth, serialize } = buildGetContext(
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

    // ── Cache resolution ────────────────────────────────────────────────────
    // Admin calls (member JWT) always bypass cache — they must see live data.
    const isAdminCall = !!memberId
    const afterReadCtx = { workspaceId }
    // Public/admin boundary: API keys see the published web (drafts need the
    // objects:read_draft grant + an explicit ?status=).
    const effectiveStatus = resolveReadStatus({
      memberId, permissions: ctx.permissions, typeName, requested: (query.status as string | undefined) ?? null,
    })
    const publicView = isPublicPublishedView(ctx, effectiveStatus)
    const finalize = (r: Record<string, unknown>): Record<string, unknown> => {
      // Strip disabled fields AFTER any published overlay (so a value published
      // before the field was disabled can't slip back in), then drop internal
      // columns (publishedValues/workspaceId) for non-admin callers.
      let out = stripDisabledFields([r], typeDef)[0]
      if (!isAdminCall) out = stripInternalColumns([out])[0]
      return out
    }
    const presentRow = (raw: Record<string, unknown>): Record<string, unknown> => {
      const r = coerceNumericFields([raw], typeDef)[0]
      if (!publicView) {
        // Every draft-view read carries the "ahead of published?" marker: one
        // rule, computed here, for preview keys and members alike (K3).
        return { ...finalize(r), hasDraftChanges: computeHasDraftChanges(raw, typeDef) }
      }
      assertRowPublished(r)
      return finalize(applyPublishedSnapshot([r], 'published')[0])
    }

    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const readLocales = resolveReadLocales(query.locale as string | undefined, projectLocalization(project), { isMember: isAdminCall })
    const locale = readLocales?.mode === 'overlay' ? readLocales.locale : readLocales ? 'all' : null
    const envCacheConfig = resolveCacheConfig(project)
    const workspaceCacheConfig = project?.cache
    const ttl = isAdminCall ? null : resolveTypeCacheTtl(typeName, envCacheConfig, workspaceCacheConfig)

    const noCacheHeader = request.headers.get('cache-control') === 'no-cache'
    const cacheKey = ttl !== null ? objectCacheKey(workspaceId, typeName, id) : null

    // ── Content: cache or Postgres ──────────────────────────────────────────
    let serialized: Record<string, unknown>

    const cached = cacheKey && !noCacheHeader ? await readObjectCache(redis, cacheKey) : null

    const objectFields = depth >= 1 ? getObjectFields(typeDef) : []
    const relationFields = depth >= 1 ? getRelationFields(typeDef) : []
    // Media expands at every depth (blocks and rows included), resolving
    // registry-named blocks through the workspace's components.
    const mediaRegistry = ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never

    // Locale overlay — translations from <type>_i18n over main-table values
    let i18nMap: Record<string, Record<string, unknown>> | null = null
    // The live translations map when this read fetched every locale (the
    // editor's ?locale=all): the draft-changes marker compares it too (K3).
    let liveI18nFull: Record<string, Record<string, unknown>> | null = null
    async function applyLocale(rows: Record<string, unknown>[], raw: Record<string, unknown>): Promise<Record<string, unknown>[]> {
      if (!readLocales) return rows
      // Public reads: translations come from the publish-time snapshot on
      // the RAW row (presentRow strips publishedValues for non-admin callers)
      // - live side rows are draft state and must not leak, in either mode (K0).
      if (publicView) {
        if (readLocales.mode === 'overlay') {
          const side = publishedI18nSide(raw, readLocales.locale)
          return rows.map(r => localizeRow(r, side, typeDef))
        }
        i18nMap = filterI18nMap(publishedI18nMap(raw), readLocales.locales)
        return rows
      }
      const sideRows = await fetchI18nRows(db, typeName, rows.map(r => r.id as string),
        readLocales.mode === 'overlay' ? readLocales.locale : 'all')
      if (readLocales.mode === 'map') {
        const full = buildI18nMap(sideRows, typeDef)
        if (readLocales.locales === 'all') liveI18nFull = full
        i18nMap = filterI18nMap(full, readLocales.locales)
        return rows
      }
      const byId = new Map(sideRows.map(r => [r.objectId, r]))
      return rows.map(r => localizeRow(r, byId.get(r.id as string), typeDef))
    }

    if (cached) {
      let result: Record<string, unknown>[] = [presentRow(cached)]
      result = await applyLocale(result, cached)
      if (!publicView && liveI18nFull) result = result.map((r) => ({ ...r, hasDraftChanges: computeHasDraftChanges(cached, typeDef, liveI18nFull) }))
      if (depth >= 1) {
        result = await expandRelations(result, relationFields, db, workspaceId, { schema, depth, publicView })
        result = await expandObjectFields(result, objectFields, db, workspaceId, schema, depth, publicView)
        // CR-3: relations nested in component blocks — resolve-and-filter (ACF model)
        result = await expandComponentRelations(result, typeDef, {
          registry: ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never,
          schema,
          loadByIds: makeNestedLoader(db, contentTables as Record<string, any>, workspaceId, publicView),
          depth,
          expandTarget: makeTargetExpander({ db, schema, workspaceId, publicView, registry: ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never }),
          })
      }
      result = normalizeManyRelationReads(normalizeRangeReads(result, typeDef.fields), typeDef.fields)
      result = await expandMediaDeep(result, typeDef, mediaRegistry, db, workspaceId, locale === 'all' ? null : locale)
      // Links resolve their target's CURRENT facts here; a public read never
      // resolves an unpublished one (Phase 6B, Units 6 and 11).
      result = await resolveLinksDeep(result, typeDef, mediaRegistry, db, workspaceId, { publicView, locale: locale === 'all' ? null : locale })
      result = result.map(r => applyFieldAfterRead(getActiveBehaviorRegistry(), workspaceId, typeDef, r, afterReadCtx))
      // C5 read side: the response follows the CURRENT component definition.
      // Storage keeps what it was given; this only shapes what is shown.
      result = result.map(r => projectComponentValues(typeDef, mediaRegistry as never, r))
      ;[serialized] = applySerialize(
        result.map(r => ({ ...r, type: typeName })),
        serialize,
      )
    } else {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
        .limit(1)

      if (!rows.length) {
        throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
      }

      // The concurrency token (Phase 6B, Unit 6): the row's own updated_at at
      // the database's precision, so a conditional write can compare it
      // exactly. A Date would drop the microseconds.
      await attachObjectEtag(ctx, db, table, { id, workspaceId })

      if (cacheKey && ttl !== null) {
        await writeObjectCache(redis, cacheKey, rows[0] as Record<string, unknown>, ttl)
      }

      let result: Record<string, unknown>[] = [presentRow((rows as Record<string, unknown>[])[0])]
      result = await applyLocale(result, (rows as Record<string, unknown>[])[0])
      if (!publicView && liveI18nFull) result = result.map((r) => ({ ...r, hasDraftChanges: computeHasDraftChanges((rows as Record<string, unknown>[])[0], typeDef, liveI18nFull) }))

      if (depth >= 1) {
        result = await expandRelations(result, relationFields, db, workspaceId, { schema, depth, publicView })
        result = await expandObjectFields(result, objectFields, db, workspaceId, schema, depth, publicView)
        // CR-3: relations nested in component blocks — resolve-and-filter (ACF model)
        result = await expandComponentRelations(result, typeDef, {
          registry: ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never,
          schema,
          loadByIds: makeNestedLoader(db, contentTables as Record<string, any>, workspaceId, publicView),
        })
      }

      result = normalizeManyRelationReads(normalizeRangeReads(result, typeDef.fields), typeDef.fields)
      result = await expandMediaDeep(result, typeDef, mediaRegistry, db, workspaceId, locale === 'all' ? null : locale)
      // Links resolve their target's CURRENT facts here; a public read never
      // resolves an unpublished one (Phase 6B, Units 6 and 11).
      result = await resolveLinksDeep(result, typeDef, mediaRegistry, db, workspaceId, { publicView, locale: locale === 'all' ? null : locale })
      result = result.map(r => applyFieldAfterRead(getActiveBehaviorRegistry(), workspaceId, typeDef, r, afterReadCtx))
      // C5 read side: the response follows the CURRENT component definition.
      // Storage keeps what it was given; this only shapes what is shown.
      result = result.map(r => projectComponentValues(typeDef, mediaRegistry as never, r))
      ;[serialized] = applySerialize(
        result.map(r => ({ ...r, type: typeName })),
        serialize,
      )
    }

    if (!isAdminCall) {
      serialized = stripDisabledBlocks(serialized, typeDef)
    }

    // Field-level read mask — members only (API keys unaffected in v1)
    if (memberId) {
      ;[serialized] = applyFieldAccessMask([serialized], restrictedReadFields(typeDef, fieldAccessContext(ctx)))
    }
    // K4.4: content.serialize@1 - the row as it will be returned.
    ;[serialized] = await applyContentSerialize({ workspaceId, typeName, rows: [serialized], status: (query.status as string | undefined) ?? null, context: { exec: ctx.exec ?? null } })

    // ── Extension data ───────────────────────────────────────────────────────
    // Included by default. Pass ?includeExtensionData=false to skip.
    // Admin (member JWT): returns draft `data` — always fresh, no cache.
    // Public (API key):   returns `publishedData` — cached under a separate key,
    //                     busted only when the object is published.
    // Admin-only: who created/updated/published — ids resolved to display labels
    // (member name/email or API-key label). Public REST responses skip the lookups.
    let audit: AuditInfo | null = null
    if (isAdminCall) {
      audit = buildAudit(serialized, await resolveActorLabels(db, pickAuditActorIds(serialized)))
    }

    if (query.includeExtensionData !== 'false' && query.includeAppData !== 'false') {
      let extDataMap: Record<string, Record<string, unknown>> = {}
      // Admin-only companion to extensionData: published_data per extension —
      // null when the row exists but has never been published; extensions with
      // no row are simply absent. Mirrors the per-panel route's publishedData
      // so the admin editor can read both from this one call.
      let publishedExtDataMap: Record<string, Record<string, unknown> | null> | null = null

      if (memberId) {
        // Admin path: draft + published data, always fresh (single query)
        const extDataRows = await db
          .select({
            extensionId: extensionData.extensionId,
            data: extensionData.data,
            publishedData: extensionData.publishedData,
          })
          .from(extensionData)
          .where(
            and(
              eq(extensionData.objectId, id),
              eq(extensionData.workspaceId, workspaceId),
              ),
          )
        publishedExtDataMap = {}
        for (const row of extDataRows) {
          extDataMap[row.extensionId] = row.data as Record<string, unknown>
          publishedExtDataMap[row.extensionId] = (row.publishedData ?? null) as Record<string, unknown> | null
        }
      } else {
        // Public path: published data, Redis-cached (Redis failure is non-fatal)
        const pubCacheKey = publishedExtensionDataCacheKey(workspaceId, id)
        const cachedPub = await redis?.get(pubCacheKey).catch(() => null) ?? null
        if (cachedPub) {
          extDataMap = JSON.parse(cachedPub)
        } else {
          const extDataRows = await db
            .select({ extensionId: extensionData.extensionId, publishedData: extensionData.publishedData })
            .from(extensionData)
            .where(
              and(
                eq(extensionData.objectId, id),
                eq(extensionData.workspaceId, workspaceId),
                ),
            )
          for (const row of extDataRows) {
            if (row.publishedData) {
              extDataMap[row.extensionId] = row.publishedData as Record<string, unknown>
            }
          }
          redis?.set(pubCacheKey, JSON.stringify(extDataMap), 'EX', EXTENSION_DATA_CACHE_TTL).catch(() => {})
        }
      }

      return {
        data: serialized,
        ...(i18nMap ? { i18n: i18nMap } : {}),
        ...(audit ? { audit } : {}),
        extensionData: extDataMap,
        ...(publishedExtDataMap ? { publishedExtensionData: publishedExtDataMap } : {}),
      }
    }

    return { data: serialized, ...(i18nMap ? { i18n: i18nMap } : {}), ...(audit ? { audit } : {}) }
}
