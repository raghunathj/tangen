/**
 * File Name: jwt.ts
 * Purpose: The site session token: an HS256 JWT with the `tangen:site`
 *          audience, signed with a key that is never the member key. The
 *          key is TANGEN_SITE_JWT_SECRET when the deployment sets one, else
 *          derived from JWT_SECRET (HKDF, fixed domain separator), else -
 *          on a development deployment only - a secret the extension
 *          generates once and keeps in its own store.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Core's member verifiers refuse any token that carries
 *          an audience, so a site token never reads as a member whatever key
 *          signed it (docs/api-keys.md).
 */
import { hkdfSync, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { ExtensionServerCtx } from '@tangen/cms'

export const SITE_TOKEN_AUDIENCE = 'tangen:site'
const SITE_KEY_SALT = 'tangen-site-jwt'
const SITE_KEY_INFO = 'tangen site-auth session key v1'
const STORE_KEY = 'site-jwt-secret'

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }

export function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhdw])$/.exec(ttl)
  if (!match) throw new Error(`Invalid TTL format: "${ttl}". Expected e.g. "30s", "5m", "1h", "7d"`)
  return Number(match[1]) * UNIT_SECONDS[match[2]!]!
}

const keyCache = new Map<string, Uint8Array>()

/** E.9: ctx.secrets only (the narrowed accessor the kernel hands the extension) - the process environment is never a fallback. */
function secret(ctx: ExtensionServerCtx, name: string): string | undefined {
  return ctx.secrets?.get(name)
}

/** The signing key for this workspace's site tokens. */
export async function siteKeyOf(ctx: ExtensionServerCtx): Promise<Uint8Array> {
  const cached = keyCache.get(ctx.workspaceId)
  if (cached) return cached
  let key: Uint8Array
  const explicit = secret(ctx, 'TANGEN_SITE_JWT_SECRET')
  const base = secret(ctx, 'JWT_SECRET')
  if (explicit) key = new TextEncoder().encode(explicit)
  else if (base) key = new Uint8Array(hkdfSync('sha256', base, SITE_KEY_SALT, SITE_KEY_INFO, 32))
  else {
    const role = ctx.deploymentRole?.() ?? 'development'
    if (role !== 'development') {
      throw new Error('Site users: set JWT_SECRET (or TANGEN_SITE_JWT_SECRET) on a staging or production deployment - refusing to sign site sessions with a generated secret.')
    }
    let stored = (await ctx.store.get(STORE_KEY))?.secret as string | undefined
    if (!stored) {
      stored = randomBytes(32).toString('hex')
      await ctx.store.put(STORE_KEY, { secret: stored })
      ctx.log?.('JWT_SECRET is not set - site sessions use a generated development secret kept in the extension store. Set JWT_SECRET before deploying.')
    }
    key = new TextEncoder().encode(stored)
  }
  keyCache.set(ctx.workspaceId, key)
  return key
}

/** Whether site sessions use a key derived from JWT_SECRET rather than a dedicated secret. */
export function siteSecretIsDerived(ctx: ExtensionServerCtx): boolean {
  return !secret(ctx, 'TANGEN_SITE_JWT_SECRET')
}

export async function signSiteToken(ctx: ExtensionServerCtx, payload: Record<string, unknown>, ttl = '7d'): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(SITE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(await siteKeyOf(ctx))
}

export async function verifySiteToken(ctx: ExtensionServerCtx, token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, await siteKeyOf(ctx), { audience: SITE_TOKEN_AUDIENCE })
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

/** Test seam: forget cached keys (a test that changes the secret between cases). */
export function __resetSiteKeys(): void {
  keyCache.clear()
}
