/**
 * File Name: sessions.ts
 * Purpose: Session issue and revocation: an access JWT plus a refresh token
 *          whose hash is the session row. Revocation is a column; a revoked
 *          session's access token stops verifying on the next request
 *          through the identity provider's session check.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExtensionServerCtx, SiteUser } from '@tangen/cms'
import { authSessions } from './tables'
import { dbOf, hooksOf, optionsOf } from './context'
import { parseTtlToSeconds, signSiteToken } from './jwt'

export const DEFAULT_ACCESS_TTL = '15m'
export const DEFAULT_REFRESH_TTL = '30d'

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

export async function issueTokenPair(ctx: ExtensionServerCtx, user: SiteUser): Promise<TokenPair> {
  const options = optionsOf(ctx)
  const accessTtl = options.token?.accessTtl ?? DEFAULT_ACCESS_TTL
  const refreshTtl = options.token?.refreshTtl ?? DEFAULT_REFRESH_TTL
  const refreshToken = randomBytes(32).toString('hex')
  const sessionId = `as_${randomBytes(8).toString('hex')}`
  await dbOf(ctx).insert(authSessions).values({
    id: sessionId,
    userId: user.id,
    workspaceId: ctx.workspaceId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + parseTtlToSeconds(refreshTtl) * 1000),
  })
  const base: Record<string, unknown> = {
    sub: user.id, sessionId, workspaceId: ctx.workspaceId,
    email: user.email, role: user.role, isAnonymous: user.isAnonymous,
  }
  const extra = hooksOf(ctx).buildTokenPayload ? await hooksOf(ctx).buildTokenPayload!(user, base) : {}
  const accessToken = await signSiteToken(ctx, { ...base, ...extra }, accessTtl)
  return { accessToken, refreshToken, expiresIn: parseTtlToSeconds(accessTtl) }
}

/** Whether a session is still live: present and not revoked. */
export async function sessionIsActive(ctx: ExtensionServerCtx, sessionId: string): Promise<boolean> {
  const [row] = await dbOf(ctx).select({ id: authSessions.id, revokedAt: authSessions.revokedAt }).from(authSessions)
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.workspaceId, ctx.workspaceId))).limit(1)
  return !!row && row.revokedAt === null
}

export async function revokeSession(ctx: ExtensionServerCtx, sessionId: string): Promise<void> {
  await dbOf(ctx).update(authSessions).set({ revokedAt: new Date() })
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.workspaceId, ctx.workspaceId)))
}

export async function revokeUserSessions(ctx: ExtensionServerCtx, userId: string): Promise<void> {
  await dbOf(ctx).update(authSessions).set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), eq(authSessions.workspaceId, ctx.workspaceId), isNull(authSessions.revokedAt)))
}

export async function findSessionByRefreshToken(ctx: ExtensionServerCtx, raw: string) {
  const [row] = await dbOf(ctx).select().from(authSessions)
    .where(and(eq(authSessions.refreshTokenHash, hashRefreshToken(raw)), eq(authSessions.workspaceId, ctx.workspaceId))).limit(1)
  return row as typeof authSessions.$inferSelect | undefined
}
