/**
 * File Name: list.ts
 * Purpose: Paginates and searches media assets in the current workspace env,
 *   supporting filtering by folder, MIME type, and a full-text keyword query
 *   across filename, original name, alt text, and tags.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db
 */
import { eq, and, like, ilike, or, count, sql, notLike, ne, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { mediaAssets } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { assertMediaPermission, mediaFolderScope } from '../../lib/permissions'
import { resolveLocaleParam, projectLocalization } from '../../services/i18n'
import type { VariantMeta, VariantsStatus, ApiKeyPermissions } from '@tangen/types'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * SQL condition restricting a LIST or SEARCH to the folders a key may see,
 * or undefined when it may see all of them.
 *
 * One condition, two consumers: this route and the MCP search_media provider
 * (routes/mcp.ts), which already imports `categoryCondition` from here. They
 * read the same table and must answer the same way, and a second copy of this
 * is how one of them ends up unscoped - which is exactly what had happened.
 *
 * An EMPTY allowedFolders means no folder, not every folder, so it compiles to
 * `false` rather than to no filter at all.
 */
export function folderScopeCondition(permissions: ApiKeyPermissions | { admin: true }) {
  const scope = mediaFolderScope(permissions)
  if (!scope) return undefined
  return scope.length > 0 ? inArray(mediaAssets.folderId, scope) : sql`false`
}

/** SQL condition for a high-level media category (shared category model). */
export function categoryCondition(category: string) {
  if (category === 'image' || category === 'video' || category === 'audio') {
    return like(mediaAssets.mimeType, `${category}/%`)
  }
  if (category === 'document') {
    return or(
      eq(mediaAssets.mimeType, 'application/pdf'),
      eq(mediaAssets.mimeType, 'application/rtf'),
      eq(mediaAssets.mimeType, 'application/msword'),
      eq(mediaAssets.mimeType, 'application/vnd.ms-excel'),
      eq(mediaAssets.mimeType, 'application/vnd.ms-powerpoint'),
      like(mediaAssets.mimeType, 'application/vnd.openxmlformats-officedocument.%'),
      like(mediaAssets.mimeType, 'application/vnd.oasis.opendocument.%'),
      like(mediaAssets.mimeType, 'text/%'),
    )
  }
  if (category === 'other') {
    return and(
      notLike(mediaAssets.mimeType, 'image/%'),
      notLike(mediaAssets.mimeType, 'video/%'),
      notLike(mediaAssets.mimeType, 'audio/%'),
      notLike(mediaAssets.mimeType, 'text/%'),
      ne(mediaAssets.mimeType, 'application/pdf'),
      ne(mediaAssets.mimeType, 'application/rtf'),
      ne(mediaAssets.mimeType, 'application/msword'),
      ne(mediaAssets.mimeType, 'application/vnd.ms-excel'),
      ne(mediaAssets.mimeType, 'application/vnd.ms-powerpoint'),
      notLike(mediaAssets.mimeType, 'application/vnd.openxmlformats-officedocument.%'),
      notLike(mediaAssets.mimeType, 'application/vnd.oasis.opendocument.%'),
    )
  }
  return null
}

export interface ListParams {
  limit: number
  offset: number
  folderId?: string
  /** High-level category filter — image | video | audio | document | other. */
  category?: string
  mimeType?: string
  q?: string
  missingAlt?: boolean
}

/**
 * Parses and clamps pagination and filter params from raw query strings.
 * Limit is clamped to [1, 100]; offset to [0, ∞); invalid numbers fall back
 * to their defaults (50 and 0 respectively).
 * @param query - Raw query-string parameters keyed by name
 * @returns Validated ListParams ready for use in database queries
 */
export function parseListParams(query: Record<string, string>): ListParams {
  const rawLimit = Number(query.limit ?? 50)
  const rawOffset = Number(query.offset ?? 0)

  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50))
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0)

  const folderId = query.folderId?.trim() || undefined
  const category = query.category?.trim() || undefined
  const mimeType = query.mimeType?.trim() || undefined
  const q = query.q?.trim() || undefined
  const missingAlt = query.missingAlt === '1' || query.missingAlt === 'true'

  return { limit, offset, folderId, mimeType, category, q, missingAlt }
}

export interface MediaListItem {
  /** Storage backend name ('local' | 's3' | custom) — null for pre-adapter rows (local). */
  storage?: string | null
  id: string
  folderId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altText: string | null
  tags: string[]
  storagePath: string
  thumbnailPath: string | null
  variantsStatus: VariantsStatus
  variants: Record<string, VariantMeta>
  createdAt: string
  createdBy: string | null
  /** Editorial display name (metadata.title) — null when unset. */
  title: string | null
  /** Editorial caption (metadata.caption) — null when unset. */
  caption: string | null
  /** AI generation provenance — null for ordinary uploads. */
  ai: { provider: string; model: string; prompt: string } | null
  /** AI drafts: false until "Add to Media" keeps them (reaped if left unkept). Uploads: true. */
  kept: boolean
  /** Per-locale editorial overrides (metadata.i18n) — null when none exist. */
  i18n: Record<string, { title?: string; caption?: string; altText?: string }> | null
  /** Locale → variant asset id (asset-level localization) — null when none. */
  localeAssets: Record<string, string> | null
  /** Parent asset id when this asset is a locale-variant upload — null otherwise. */
  variantOf: string | null
}

/**
 * Maps a raw mediaAssets database row to a typed MediaListItem DTO, pulling
 * variantsStatus and variants out of the JSONB metadata column.
 * @param row - Raw database row from the mediaAssets table
 * @returns A normalised MediaListItem with ISO-string dates and null defaults
 */
export function buildMediaListItem(row: Record<string, any>): MediaListItem {
  const meta = (row.metadata ?? {}) as Record<string, any>
  return {
    id: row.id,
    folderId: row.folderId ?? null,
    filename: row.filename,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width ?? null,
    height: row.height ?? null,
    altText: row.altText ?? null,
    tags: row.tags ?? [],
    storagePath: row.storagePath,
    thumbnailPath: row.thumbnailPath ?? null,
    // Backend that holds the files; legacy rows (pre-adapters) are local
    storage: typeof meta.storage === 'string' && meta.storage ? meta.storage : null,
    variantsStatus: (meta.variantsStatus ?? 'complete') as VariantsStatus,
    variants: (meta.variants ?? {}) as Record<string, VariantMeta>,
    title: typeof meta.title === 'string' && meta.title ? meta.title : null,
    caption: typeof meta.caption === 'string' && meta.caption ? meta.caption : null,
    i18n: meta.i18n && typeof meta.i18n === 'object' ? meta.i18n : null,
    localeAssets: meta.localeAssets && typeof meta.localeAssets === 'object' && Object.keys(meta.localeAssets).length > 0
      ? meta.localeAssets : null,
    variantOf: typeof meta.variantOf === 'string' && meta.variantOf ? meta.variantOf : null,
    ai: meta.ai && typeof meta.ai === 'object'
      ? { provider: String(meta.ai.provider ?? ''), model: String(meta.ai.model ?? ''), prompt: String(meta.ai.prompt ?? '') }
      : null,
    // Only AI drafts are ever unkept; everything else (uploads) is implicitly kept.
    kept: meta.kept !== false,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt ?? ''),
    createdBy: row.createdBy ?? null,
  }
}

/**
 * Overlays an asset's per-locale editorial overrides (title/caption/altText)
 * with fallback to the defaults; the i18n map itself never leaks.
 */
export function localizeAssetItem<T extends { title: string | null; caption: string | null; altText: string | null; i18n: Record<string, { title?: string; caption?: string; altText?: string }> | null }>(
  item: T,
  locale: string | null | undefined,
): T {
  const { i18n, ...rest } = item
  if (!locale || !i18n?.[locale]) return { ...rest, i18n: null } as T
  const section = i18n[locale]
  return {
    ...rest,
    i18n: null,
    title: section.title ?? item.title,
    caption: section.caption ?? item.caption,
    altText: section.altText ?? item.altText,
  } as T
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Registers GET /api/v1/media/asset/:id — a single asset as a MediaListItem
 * (incl. AI provenance). Used by the editor to prefill Gen AI with the prompt
 * behind a field's current image.
 */
export const mediaAssetDetailRoute = (app: Elysia) =>
  app.get('/api/v1/media/asset/:id', async (ctx: any) => {
    const { db, workspaceId, params, query, memberId, workspaceProjects } = ctx
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(
        eq(mediaAssets.id, params.id),
        eq(mediaAssets.workspaceId, workspaceId),
        ))
      .limit(1)
    const row = (rows as any[])[0]
    if (!row) throw new RequestError('NOT_FOUND', 'Asset not found', 404)
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const locale = resolveLocaleParam(query?.locale, projectLocalization(project), Boolean(memberId))
    let item = buildMediaListItem(row)
    // Asset-level localization: a concrete locale with a variant serves the
    // variant asset (different file, different URLs), tagged localizedFrom.
    if (locale && locale !== 'all' && item.localeAssets?.[locale]) {
      const variantRows = await db
        .select()
        .from(mediaAssets)
        .where(and(
          eq(mediaAssets.id, item.localeAssets[locale]),
          eq(mediaAssets.workspaceId, workspaceId),
          ))
        .limit(1)
      const variantRow = (variantRows as any[])[0]
      if (variantRow) {
        item = { ...buildMediaListItem(variantRow), localizedFrom: params.id } as any
      }
    }
    // locale=all (admin) keeps the raw i18n map for per-locale editing
    return { data: locale === 'all' ? item : localizeAssetItem(item, locale) }
  })

/**
 * Registers GET /api/v1/media.
 * Returns a paginated list of media assets with a total count in the meta
 * envelope. Supports ?folderId, ?mimeType (prefix match), and ?q (ILIKE
 * search across filename, originalName, altText, and tags).
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with the media list route registered
 */
export const mediaListRoute = (app: Elysia) =>
  app.get('/api/v1/media', async (ctx: any) => {
    const { query, db, workspaceId, permissions } = ctx

    const params = parseListParams(query)

    // This route carried NO media permission check: it is mounted under the
    // 'authenticated' media policy, so any key reached it - including one
    // holding only objects:read. The rows carry `id` and `storagePath`, which
    // is exactly what the PUBLIC serve and transform routes need, so listing
    // was effectively a read of every asset's bytes. An explicit folderId is
    // checked here too, so a scoped key naming a folder it was not given is
    // told so instead of silently receiving nothing.
    assertMediaPermission(permissions, 'read', params.folderId ?? undefined)

    // Build WHERE conditions
    const conditions: any[] = [
      eq(mediaAssets.workspaceId, workspaceId),
      ]

    // A key scoped to folders sees only those folders. Filtering, not
    // refusing: a list that 403s because one asset is out of scope makes the
    // scope unusable, and an unfiltered list makes it a lie. The unfiled root
    // is not on any allowedFolders list, so a scoped key does not see it -
    // the same stance assertMediaPermission takes for a single asset.
    const folderScope = folderScopeCondition(permissions)
    if (folderScope) conditions.push(folderScope)

    // UNKEPT AI drafts (metadata.kept === false) are NEVER shown in the library — they
    // live only in the Gen AI chat until "Add to media" keeps them (or the reaper sweeps
    // them). This keeps the gallery/picker free of assets on a hidden expiry timer.
    conditions.push(sql`(CASE WHEN jsonb_typeof(${mediaAssets.metadata}) = 'string'
      THEN (${mediaAssets.metadata} #>> '{}')::jsonb ELSE ${mediaAssets.metadata} END)->>'kept' IS DISTINCT FROM 'false'`)

    // Locale-variant uploads live under their parent asset, not in the gallery.
    // metadata may be double-encoded jsonb (string) — normalize before reading.
    if (query.includeVariants !== 'true') {
      conditions.push(sql`(CASE WHEN jsonb_typeof(${mediaAssets.metadata}) = 'string'
        THEN (${mediaAssets.metadata} #>> '{}')::jsonb ELSE ${mediaAssets.metadata} END)->>'variantOf' IS NULL`)
    }

    if (params.folderId) {
      conditions.push(eq(mediaAssets.folderId, params.folderId))
    }

    if (params.missingAlt) {
      conditions.push(sql`(${mediaAssets.altText} IS NULL OR ${mediaAssets.altText} = '')`)
    }

    if (params.mimeType) {
      // e.g. 'image' matches 'image/jpeg', 'image/png', etc.
      conditions.push(like(mediaAssets.mimeType, `${params.mimeType}%`))
    }

    if (params.category) {
      const cond = categoryCondition(params.category)
      if (cond) conditions.push(cond)
    }

    if (params.q) {
      const pattern = `%${params.q}%`
      conditions.push(
        or(
          ilike(mediaAssets.filename, pattern),
          ilike(mediaAssets.originalName, pattern),
          ilike(mediaAssets.altText, pattern),
          // search tags array via ILIKE on text cast
          sql`array_to_string(${mediaAssets.tags}, ' ') ILIKE ${pattern}`,
        ),
      )
    }

    const where = and(...conditions)

    // Count total matching rows
    const [{ total }] = await db
      .select({ total: count() })
      .from(mediaAssets)
      .where(where)

    // Fetch page
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(where)
      .orderBy(sql`${mediaAssets.createdAt} DESC`)
      .limit(params.limit)
      .offset(params.offset)

    return {
      data: rows.map(buildMediaListItem),
      meta: { total: Number(total), limit: params.limit, offset: params.offset },
    }
  })
