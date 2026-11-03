/**
 * File Name: login.ts
 * Purpose: Authentication login route — validates credentials, issues a short-lived JWT access token,
 *          and persists a long-lived refresh token stored as an HTTP-only cookie.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, jose (JWT signing/verification), Bun.password (Argon2id), @tangen/db (members, refreshTokens)
 */
import { Elysia } from 'elysia'
import { eq, and, SQL } from 'drizzle-orm'
import { SignJWT, jwtVerify } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { members, refreshTokens } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { resolveJwtSecret } from '../../lib/jwt-secret'
import { buildRefreshCookie, isCrossSiteRequest } from '../../lib/refresh-cookie'
import { enforceRateLimit } from '../../services/rate-limiter'
import { memberHasActiveGrant } from '../../middleware/auth'
import { clientIp, getTrustedProxy, socketAddressOf } from '../../lib/client-ip'

export const ACCESS_TOKEN_TTL = 15 * 60  // 15 min (seconds) - the deadline login/refresh report
const REFRESH_TOKEN_TTL_DAYS = 30

/**
 * Compares a plain-text password against a stored hash using Bun's built-in Argon2id verifier.
 * @param plain - The plain-text password submitted by the user
 * @param hash - The Argon2id hash stored in the database
 * @returns true if the password matches, false otherwise
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // A member created without a credential (desired state, a Porter import)
  // carries an unusable marker, not a hash: that is "wrong password", never a 500.
  try { return await Bun.password.verify(plain, hash) } catch { return false }
}

/**
 * An Argon2id hash of nothing anyone knows, verified against when the email
 * does not exist.
 *
 * Without it, a login for an unknown address answered in microseconds while
 * one for a known address paid for an Argon2id verification, and that
 * difference is a user-enumeration oracle: an attacker learns which addresses
 * have accounts here without guessing a single password. Hardening from the
 * security audit of 2026-10-28 (S7) - no boundary is crossed by knowing a
 * member exists, but it is the first step of every credential attack and it
 * costs one hash to remove.
 *
 * Minted once per process, lazily, so a deployment that never sees a failed
 * login never pays for it. The password is random, so nothing can match it.
 */
let decoyHash: Promise<string> | null = null
export function loginDecoyHash(): Promise<string> {
  decoyHash ??= Bun.password.hash(randomBytes(32).toString('hex'), 'argon2id')
  return decoyHash
}

export interface AccessTokenPayload {
  sub: string
  workspaceId: string
  role: string
  email: string
  /** Whether the member holds any per-member grant, so the request hot path can
   *  skip the grant read when false (tasks/plan-per-user-grants.md, tier 2). */
  hasGrants?: boolean
}

/**
 * Signs and returns a short-lived HS256 JWT access token containing workspace, role, and email claims.
 * @param payload - Member identity data to embed as JWT claims
 * @param secret - Raw JWT secret string used to sign the token
 * @returns A signed JWT string valid for ACCESS_TOKEN_TTL seconds (15 minutes)
 */
export async function buildAccessToken(payload: AccessTokenPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  // hasGrants is stamped explicitly (true AND false) so the request hot path can
  // skip the grant read on false; absent only on legacy tokens (which then read).
  return new SignJWT({ workspaceId: payload.workspaceId, role: payload.role, email: payload.email, hasGrants: payload.hasGrants === true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
    .sign(key)
}

/**
 * Verifies a JWT access token signature and returns its decoded payload.
 * @param token - The raw JWT string to verify
 * @param secret - Raw JWT secret string used to verify the signature
 * @returns The decoded token payload cast to AccessTokenPayload
 */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenPayload & { sub: string }> {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key)
  return payload as unknown as AccessTokenPayload & { sub: string }
}

export interface MemberRow {
  id: string
  workspaceId: string
  role: string
  email: string
}

/**
 * Constructs the sanitised public member object included in login and refresh responses.
 * @param member - The member row fetched from the database
 * @returns A plain object with memberId, workspaceId, role, and email
 */
export function buildLoginResponse(member: MemberRow) {
  return {
    memberId: member.id,
    workspaceId: member.workspaceId,
    role: member.role,
    email: member.email,
  }
}

/**
 * Elysia plugin that registers POST /api/auth/login; validates member credentials and issues an access token plus an HTTP-only refresh-token cookie.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the login route registered
 */
export const loginRoute = (app: Elysia) =>
  app.post('/api/auth/login', async (ctx: any) => {
    const { body, db, set, cookie, redis } = ctx
    const { email, password, workspaceId: targetWorkspaceId } = body as {
      email: string
      password: string
      workspaceId?: string
    }

    // Brute-force guard — 5 attempts per email per minute
    if (email) {
      await enforceRateLimit(redis, '_admin', `login:${email.trim().toLowerCase()}`, 5, 60)
    }

    // And a window keyed on the CALLER, because the per-email one bounds
    // guessing ONE account and says nothing about spraying one password
    // across a thousand addresses - which is the attack that works on a
    // member directory. Deliberately generous (60 a minute): a shared office
    // address or a NAT is one IP for many real people, and a limit that locks
    // them out is a worse outcome than the one it prevents. S7 of the
    // security audit.
    //
    // Only when an address can be TRUSTED: `clientIp` answers null unless the
    // operator declared their proxy, and a limit keyed on a header anyone can
    // set is a limit an attacker clears by changing it.
    const caller = clientIp(ctx.request, getTrustedProxy(), socketAddressOf(ctx))
    if (caller) {
      await enforceRateLimit(redis, '_admin', `login-ip:${caller}`, 60, 60)
    }

    if (!email || !password) {
      throw new RequestError('VALIDATION_ERROR', 'email and password are required', 422)
    }

    // When workspaceId is provided, scope the lookup to that specific workspace.
    // Without it, the first member row with that email is used (single-workspace projects).
    const whereClause: SQL = targetWorkspaceId
      ? and(eq(members.email, email), eq(members.workspaceId, targetWorkspaceId))!
      : eq(members.email, email)

    const [member] = await db
      .select()
      .from(members)
      .where(whereClause)
      .limit(1)

    // A miss verifies against the DECOY and then fails anyway, so the response
    // time does not say whether the address exists (S7). Written as two
    // statements rather than a clever expression, because "verify, then
    // discard the answer" is the whole point and has to survive a tidy-up.
    let passwordOk = false
    if (member) {
      passwordOk = await verifyPassword(password, member.passwordHash)
    } else {
      await verifyPassword(password, await loginDecoyHash())
    }
    if (!member || !passwordOk) {
      throw new RequestError('UNAUTHORIZED', 'Invalid email or password', 401)
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

    const rawRefresh = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawRefresh).digest('hex')
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
    const refreshId = `rt_${randomBytes(8).toString('hex')}`

    await db.insert(refreshTokens).values({
      id: refreshId,
      memberId: member.id,
      tokenHash,
      expiresAt,
    })

    await db.update(members).set({ lastLoginAt: new Date() }).where(eq(members.id, member.id))

    // Set refresh token as HTTP-only cookie
    set.headers['Set-Cookie'] = buildRefreshCookie(rawRefresh, REFRESH_TOKEN_TTL_DAYS, { crossSite: isCrossSiteRequest(ctx.request?.headers ?? ctx.headers ?? {}) })

    set.status = 200
    return {
      accessToken,
      // Say WHEN it dies. Without this a long-running script's first warning
      // was a mid-run 401 (finding #11) - the refresh cookie existed all
      // along, but a deadline nobody can see cannot be planned around.
      expiresIn: ACCESS_TOKEN_TTL,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL * 1000).toISOString(),
      member: buildLoginResponse(member),
    }
  })
