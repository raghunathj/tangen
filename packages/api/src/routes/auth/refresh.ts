/**
 * File Name: refresh.ts
 * Purpose: Token-refresh route that validates the HTTP-only refresh-token cookie and
 *          returns a new short-lived JWT access token without requiring re-authentication.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM, @tangen/db (members, refreshTokens);
 *                     re-uses buildAccessToken and buildLoginResponse from login.ts
 */
import { Elysia } from 'elysia'
import { eq, and, isNull } from 'drizzle-orm'
import { createHash } from 'node:crypto'

import { members, refreshTokens } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { resolveJwtSecret } from '../../lib/jwt-secret'
import { buildAccessToken, buildLoginResponse, ACCESS_TOKEN_TTL } from './login'
import { memberHasActiveGrant } from '../../middleware/auth'
import { readRefreshToken } from '../../lib/refresh-cookie'

/**
 * Elysia plugin that registers POST /api/auth/refresh; exchanges a valid HTTP-only refresh-token cookie for a new access token.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the refresh route registered
 */
export const refreshRoute = (app: Elysia) =>
  app.post('/api/auth/refresh', async (ctx: any) => {
    const { request, db } = ctx
    const cookieHeader = request.headers.get('cookie') ?? ''
    const rawToken = readRefreshToken(cookieHeader)

    if (!rawToken) {
      throw new RequestError('UNAUTHORIZED', 'No refresh token', 401)
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const now = new Date()

    const [rt] = await db
      .select()
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
      ))
      .limit(1)

    if (!rt || rt.expiresAt < now) {
      throw new RequestError('UNAUTHORIZED', 'Refresh token invalid or expired', 401)
    }

    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.id, rt.memberId))
      .limit(1)

    if (!member) {
      throw new RequestError('UNAUTHORIZED', 'Member not found', 401)
    }
    if (member.status === 'suspended') {
      throw new RequestError('FORBIDDEN', 'This account is suspended', 403)
    }

    const secretRaw = resolveJwtSecret()
    const hasGrants = await memberHasActiveGrant(db, member.workspaceId, member.id)
    const accessToken = await buildAccessToken(
      { sub: member.id, workspaceId: member.workspaceId, role: member.role, email: member.email, hasGrants },
      secretRaw,
    )

    // Same expiry contract as login (finding #11): a client refreshing on a
    // schedule needs the deadline from the same response that moved it.
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL * 1000).toISOString(),
      member: buildLoginResponse(member),
    }
  })
