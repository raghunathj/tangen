/**
 * File Name: validate.ts
 * Purpose: Elysia route plugin for GET /api/v1/preview/validate, confirming that a preview token
 *          exists in Redis and belongs to the authenticated workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reads token from the `token` query param; relies on Redis via previewTokenKey from token.ts.
 */
import { Elysia } from 'elysia'
import { redisDisabled } from '../../plugins/redis'
import { makePreviewTokenStore } from '../../services/preview-token-store'
import { RequestError } from '../../lib/errors'
import { previewTokenKey } from './token'

// ─── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Extracts and trims the token query parameter, throwing a validation error if it is absent.
 * @param query - Parsed query string object from the request
 * @returns The trimmed token string
 */
export function extractValidateToken(query: Record<string, string>): string {
  const token = query.token?.trim()
  if (!token) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: token', 422)
  }
  return token
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * Elysia plugin providing GET /api/v1/preview/validate to confirm a preview token is active and workspace-scoped.
 * @returns Elysia plugin function
 */
export const previewValidateRoute = (app: Elysia) =>
  app.get('/api/v1/preview/validate', async (ctx: any) => {
    const { query, redis, db, workspaceId } = ctx

    const token = extractValidateToken(query)
    const store = makePreviewTokenStore({ redis, db, redisDisabled: redisDisabled() })
    const stored = await store.get(previewTokenKey(token))

    if (!stored) {
      throw new RequestError('UNAUTHORIZED', 'Invalid or expired preview token', 401)
    }

    // Ensure the token belongs to the authenticated workspace
    const data = JSON.parse(stored) as { workspaceId: string }
    if (data.workspaceId !== workspaceId) {
      throw new RequestError('UNAUTHORIZED', 'Token does not belong to this workspace', 401)
    }

    return { valid: true }
  })
