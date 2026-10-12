/**
 * File Name: update.ts
 * Purpose: PATCH /api/v1/media/asset/:id — edits an asset's editorial fields:
 *          alt text (column) plus title and caption (metadata jsonb). System
 *          keys in metadata (variants, ai provenance) are never touched.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: admin permission or media:write, same as upload.
 */
import { Elysia, t } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { mediaAssets } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { canWriteLocale } from '../../lib/field-access'
import { assertMediaPermission } from '../../lib/permissions'
import { buildMediaListItem, localizeAssetItem } from './list'
export { localizeAssetItem }
import { resolveLocaleParam, projectLocalization } from '../../services/i18n'

export interface AssetPatch {
  altText?: string | null
  metadata: Record<string, unknown>
}

/**
 * Builds the column/metadata patch from a client body. Only altText, title,
 * and caption are editable; empty strings clear a value; everything else in
 * metadata (variants, ai, …) is preserved as-is.
 */
export function buildAssetPatch(
  currentMetadata: Record<string, unknown> | null | undefined,
  body: { altText?: string | null; title?: string | null; caption?: string | null },
  locale?: string | null,
): AssetPatch {
  const metadata: Record<string, unknown> = { ...(currentMetadata ?? {}) }

  // Locale-scoped edit: title/caption/altText land under metadata.i18n[locale];
  // the default-locale values (metadata.title/caption + altText column) stay put.
  if (locale) {
    const i18n = { ...((metadata.i18n as Record<string, Record<string, unknown>>) ?? {}) }
    const section = { ...(i18n[locale] ?? {}) }
    for (const key of ['title', 'caption', 'altText'] as const) {
      if (key in body) {
        const v = body[key]
        if (v === null || v === undefined || String(v).trim() === '') delete section[key]
        else section[key] = String(v).trim()
      }
    }
    if (Object.keys(section).length === 0) delete i18n[locale]
    else i18n[locale] = section
    if (Object.keys(i18n).length === 0) delete metadata.i18n
    else metadata.i18n = i18n
    return { metadata }
  }

  for (const key of ['title', 'caption'] as const) {
    if (key in body) {
      const v = body[key]
      if (v === null || v === undefined || String(v).trim() === '') delete metadata[key]
      else metadata[key] = String(v).trim()
    }
  }

  const patch: AssetPatch = { metadata }
  if ('altText' in body) {
    const v = body.altText
    patch.altText = v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()
  }
  return patch
}

const bodySchema = t.Object({
  altText: t.Optional(t.Union([t.String(), t.Null()])),
  title: t.Optional(t.Union([t.String(), t.Null()])),
  caption: t.Optional(t.Union([t.String(), t.Null()])),
  locale: t.Optional(t.String()),
})

/**
 * Registers the asset edit endpoint. Mounted after authMiddleware.
 */
export const mediaUpdateRoute = (app: Elysia) =>
  app.patch('/api/v1/media/asset/:id', async (ctx: any) => {
    const { db, workspaceId, permissions, params, body } = ctx

    assertMediaPermission(permissions, 'write')

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
    // The folder is only known once the row is loaded, so the scope check
    // follows it - the order delete.ts already uses.
    assertMediaPermission(permissions, 'write', row.folderId ?? null)

    const project = (ctx.workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const locale = resolveLocaleParam((body as any).locale, projectLocalization(project), true)
    const targetLocale = locale === 'all' ? null : locale
    if (!canWriteLocale(ctx, targetLocale, projectLocalization(project)?.defaultLocale)) {
      throw new RequestError('FORBIDDEN',
        targetLocale ? `Your role cannot edit ${targetLocale} content` : 'Your role can only edit specific languages - base content is locked', 403)
    }
    const patch = buildAssetPatch(row.metadata, body, targetLocale)
    await db
      .update(mediaAssets)
      .set({ metadata: patch.metadata, ...('altText' in patch ? { altText: patch.altText } : {}) })
      .where(eq(mediaAssets.id, row.id))

    return {
      data: buildMediaListItem({
        ...row,
        metadata: patch.metadata,
        altText: 'altText' in patch ? patch.altText : row.altText,
      }),
    }
  }, { body: bodySchema })
  // Mark an AI-generated draft as KEPT (metadata.kept = true) — "Add to Media" in the
  // Gen AI chat. Idempotent; only touches the `kept` key. Once kept, the reaper leaves it.
  .post('/api/v1/media/asset/:id/keep', async (ctx: any) => {
    const { db, workspaceId, permissions, params } = ctx
    assertMediaPermission(permissions, 'write')
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
    assertMediaPermission(permissions, 'write', row.folderId ?? null)
    const metadata = { ...((row.metadata ?? {}) as Record<string, unknown>), kept: true }
    await db.update(mediaAssets).set({ metadata }).where(eq(mediaAssets.id, row.id))
    return { data: buildMediaListItem({ ...row, metadata }) }
  })
