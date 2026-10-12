/**
 * File Name: object.ts
 * Purpose: Elysia route plugin for GET /api/v1/preview/object/:id, serving draft object data
 *          to preview frontends authenticated via a short-lived preview token.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires Redis for token lookup via previewTokenKey; validates token scope
 *                     and expands media fields (at every depth - blocks included) before returning the object payload.
 */
import { eq, and } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { redisDisabled } from '../../plugins/redis'
import { makePreviewTokenStore } from '../../services/preview-token-store'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { getSchema } from '../../services/schema-cache'
import { expandMediaDeep } from '../../services/media-loader'
import { resolveLinksDeep } from '../../services/link-loader'
import { fetchI18nRows, localizeRow } from '../../services/i18n'
import { previewTokenKey, type PreviewTokenMinter } from './token'
import { restrictedReadFields } from '../../lib/field-access'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredPreviewToken {
  token: string
  workspaceId: string
  objectId: string | null
  expiresAt: string
  /** Whose field-level view this token delegates. Null only on a token minted before it was recorded. */
  minter: PreviewTokenMinter | null
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parses and validates a JSON-encoded preview token string from Redis storage.
 * @param raw - Raw JSON string retrieved from Redis
 * @returns Typed StoredPreviewToken object
 */
export function parseStoredPreviewToken(raw: string): StoredPreviewToken {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RequestError('UNAUTHORIZED', 'Invalid preview token', 401)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestError('UNAUTHORIZED', 'Invalid preview token', 401)
  }
  const p = parsed as Record<string, unknown>
  if (typeof p.token !== 'string' || typeof p.workspaceId !== 'string') {
    throw new RequestError('UNAUTHORIZED', 'Invalid preview token', 401)
  }
  const m = p.minter as Record<string, unknown> | undefined
  return {
    token: p.token,
    workspaceId: p.workspaceId,
    objectId: typeof p.objectId === 'string' ? p.objectId : null,
    expiresAt: typeof p.expiresAt === 'string' ? p.expiresAt : '',
    minter: m && typeof m === 'object' && typeof m.isAdmin === 'boolean'
      ? {
          memberRole: typeof m.memberRole === 'string' ? m.memberRole : null,
          isAdmin: m.isAdmin,
          ...(m.fieldGrants !== undefined ? { fieldGrants: m.fieldGrants } : {}),
        }
      : null,
  }
}

/**
 * Checks whether a stored preview token grants access to the requested object.
 * @param stored - Decoded preview token data
 * @param requestedObjectId - ID of the object being requested
 * @returns True only when the token names exactly this object
 */
export function validatePreviewAccess(stored: StoredPreviewToken, requestedObjectId: string): boolean {
  // A null scope used to mean "every object". Tokens minted before that was
  // removed are still in Redis for up to 24h, so refusing null here is what
  // actually stops them, rather than only closing the mint.
  if (!stored.objectId) return false
  return stored.objectId === requestedObjectId
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin providing GET /api/v1/preview/object/:id for token-authenticated draft content preview.
 * @returns Elysia plugin function
 */
export const previewObjectRoute = (app: Elysia) =>
  app.get('/api/v1/preview/object/:id', async (ctx: any) => {
    const { params, query, request, db, redis } = ctx
    const { id } = params
    const typeName = query.type as string | undefined

    const rawToken = request.headers.get('X-Tangen-Preview-Token') as string | null
    if (!rawToken) {
      throw new RequestError('UNAUTHORIZED', 'Missing X-Tangen-Preview-Token header', 401)
    }

    const store = makePreviewTokenStore({ redis, db, redisDisabled: redisDisabled() })
    const stored = await store.get(previewTokenKey(rawToken))
    if (!stored) {
      throw new RequestError('UNAUTHORIZED', 'Invalid or expired preview token', 401)
    }

    const tokenData = parseStoredPreviewToken(stored)

    if (!validatePreviewAccess(tokenData, id)) {
      throw new RequestError('FORBIDDEN', 'Preview token does not grant access to this object', 403)
    }

    if (!typeName) {
      throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: type', 422)
    }

    const { workspaceId } = tokenData

    const schema = await getSchema(db, redis)
    const typeDef = schema.types.find((t: any) => t.name === typeName)
    if (!typeDef || typeDef.disabled) {
      throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`, 404)
    }

    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`, 404)
    }

    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .limit(1)

    if (!rows.length) {
      throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
    }

    // A token delegates its minter's view and cannot widen it. Masked here
    // rather than in the select, because the i18n overlay, media expansion
    // and link resolution below all reintroduce field values.
    //
    // A token with no recorded minter is REFUSED rather than served
    // unmasked. It predates this check, and `listAllows` returns true for a
    // null role ("API keys unaffected in v1"), so guessing the most
    // restrictive context would still fail OPEN on exactly the role lists
    // this is about. Tokens live at most 24h and the Admin re-mints on
    // demand; refusing is the same call made when the unrestricted null
    // scope was closed, for the same reason.
    if (!tokenData.minter) {
      throw new RequestError('UNAUTHORIZED',
        'This preview token predates field-level scoping - reload the preview to get a new one', 401)
    }
    const masked = restrictedReadFields(typeDef as never, tokenData.minter as never)

    let result: Record<string, unknown>[] = rows as Record<string, unknown>[]

    // Localized initial render — overlay the <type>_i18n side table for ?locale=<code>, so the
    // first preview frame matches the language the admin's switcher is on (base otherwise).
    const locale = typeof query.locale === 'string' && query.locale.trim() ? query.locale.trim() : null
    if (locale) {
      try {
        const sideRows = await fetchI18nRows(db, typeName, [id], locale)
        const side = (sideRows as any[]).find((r) => r.objectId === id) ?? null
        result = result.map((r) => localizeRow(r, side, typeDef as any))
      } catch { /* no i18n table / not localized - serve base values */ }
    }

    // The Studio canvas reads drafts here. Blocks carry media too (kit.image,
    // any block with a media prop), so expand at every depth - a bare id
    // would reach the renderer as <img src="med_...">.
    const mediaRegistry = ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never
    result = await expandMediaDeep(result, typeDef, mediaRegistry, db, workspaceId, locale ?? undefined)
    // The canvas previews DRAFTS, so links resolve editorially: an unpublished
    // target is exactly what the author is here to see.
    result = await resolveLinksDeep(result, typeDef, mediaRegistry, db, workspaceId, { locale })

    const out = { ...result[0], type: typeName } as Record<string, unknown>
    for (const field of masked) delete out[field]
    return { data: out }
  })
