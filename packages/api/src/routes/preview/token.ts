/**
 * File Name: token.ts
 * Purpose: Elysia route plugin for POST /api/v1/preview/token, issuing short-lived Redis-backed
 *          preview tokens that grant unauthenticated read access to draft content objects.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Tokens are stored in Redis with TTL (default 1 h, max 24 h, min 1 min);
 *                     token scope can optionally be restricted to a single objectId.
 */
import { randomBytes } from 'node:crypto'
import { Elysia } from 'elysia'
import { redisDisabled } from '../../plugins/redis'
import { makePreviewTokenStore } from '../../services/preview-token-store'
import { assertObjectPermission } from '../../lib/permissions'
import { fieldAccessContext } from '../../lib/field-access'
import { RequestError } from '../../lib/errors'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TTL = 3600      // 1 hour
const MAX_TTL     = 86400     // 24 hours
const MIN_TTL     = 60        // 1 minute

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random preview token string prefixed with "prev_".
 * @returns A unique preview token string
 */
export function generatePreviewToken(): string {
  return `prev_${randomBytes(16).toString('hex')}`
}

/**
 * Returns the namespaced Redis key for storing a preview token.
 * @param token - Preview token string
 * @returns Redis key string
 */
export function previewTokenKey(token: string): string {
  return `tangen:preview:${token}`
}

/**
 * The minter's field-level read access, carried with the token.
 *
 * Without it the read path returned every column of the object it named, so a
 * token minted by a low-privileged member showed fields that `admin.access`
 * masks for that member - `routes/objects/export.ts` is stricter on the same
 * draft data. A token delegates its minter's view; it cannot widen it.
 *
 * FieldAccessContext is plain data (role, the admin flag, the actor's field
 * grants), so it stores and reads back as JSON. The computed field list cannot
 * be stored instead: the TYPE is not known at mint time - it arrives as
 * `?type=` on the read - and `restrictedReadFields` needs the type definition.
 */
export interface PreviewTokenMinter {
  memberRole: string | null
  isAdmin: boolean
  fieldGrants?: unknown
}

export interface PreviewTokenPayload {
  /** The one object this token unlocks. Never null: see buildPreviewTokenPayload. */
  objectId: string
  expiresInSeconds: number
}

/**
 * Validates and normalises the preview token request body, clamping TTL within allowed bounds.
 * @param body - Raw request body
 * @returns Validated PreviewTokenPayload containing objectId scope and effective TTL in seconds
 */
export function buildPreviewTokenPayload(body: unknown): PreviewTokenPayload {
  if (!body || typeof body !== 'object') {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object')
  }
  const b = body as Record<string, unknown>

  // A preview token used to default to objectId null, which
  // validatePreviewAccess treated as "unrestricted" - every draft of every
  // type in the workspace. Nothing ever asked for that: the only caller,
  // packages/admin/lib/preview.ts `mintPreviewToken(objectId, ...)`, always
  // names one object, and says so in its own comment.
  const objectId = typeof b.objectId === 'string' ? b.objectId.trim() : ''
  if (!objectId) {
    throw new RequestError('VALIDATION_ERROR', 'objectId is required: a preview token is scoped to one object')
  }

  const rawTtl = b.expiresInSeconds
  if (rawTtl !== undefined && (typeof rawTtl !== 'number' || !Number.isFinite(rawTtl))) {
    throw new RequestError('VALIDATION_ERROR', 'expiresInSeconds must be a number')
  }
  const expiresInSeconds = rawTtl === undefined
    ? DEFAULT_TTL
    : Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(rawTtl as number)))

  return { objectId, expiresInSeconds }
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin providing POST /api/v1/preview/token to issue scoped, time-limited preview tokens.
 * @returns Elysia plugin function
 */
export const previewTokenRoute = (app: Elysia) =>
  app.post('/api/v1/preview/token', async (ctx: any) => {
    const { body, redis, db, workspaceId } = ctx
    const store = makePreviewTokenStore({ redis, db, redisDisabled: redisDisabled() })

    // Reading a draft is what this token delegates, so minting one needs that
    // permission. Before this there was NO check beyond `authenticated`, so a
    // key scoped to one unrelated type - or a site key - could mint one.
    assertObjectPermission(ctx.permissions, 'read_draft')

    const payload = buildPreviewTokenPayload(body)
    const token = generatePreviewToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + payload.expiresInSeconds * 1000)

    const stored = {
      token,
      workspaceId,
      objectId: payload.objectId,
      expiresAt: expiresAt.toISOString(),
      // Whose view this token delegates. The read path masks with it.
      minter: fieldAccessContext(ctx) satisfies PreviewTokenMinter,
    }

    await store.put(previewTokenKey(token), JSON.stringify(stored), payload.expiresInSeconds)

    return {
      data: {
        token,
        expiresAt: expiresAt.toISOString(),
      },
    }
  })
