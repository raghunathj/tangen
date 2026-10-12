/**
 * File Name: site.ts
 * Purpose: The routes a site calls with its site key (an API key granted
 *          "Site users: sessions"): register, sign in with a password, a
 *          one-time code by email or SMS, or an SSO provider; refresh and
 *          sign out; read and update the signed-in user; guest sessions;
 *          password reset. Handlers are plain functions over (ctx, req) so
 *          they are tested without a server.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Mounted at /api/v1/ext/auth/... by the platform's
 *          key/public mount. The SSO callback is the one public route: the
 *          provider redirects the browser there and no header can ride
 *          along; the state it carries was issued behind the key.
 */
import type { ExtensionAdminRoute, ExtensionServerCtx, SiteUser } from '@tangen/cms'
import { and, eq } from 'drizzle-orm'
import { authIdentities, authSsoAccounts, authUsers } from '../tables'
import { normalizeEmail, normalizePhone, type OtpDelivery } from '../contract'
import { dbOf, fireAndForget, hookCtx, hooksOf, optionsOf, profileFieldsOf } from '../context'
import { RequestError, forbidden, invalid, unauthorized } from '../errors'
import { verifySiteToken } from '../jwt'
import { findSessionByRefreshToken, issueTokenPair, revokeSession, revokeUserSessions, sessionIsActive } from '../sessions'
import { OTP_TTL_SECONDS, RESET_TTL_SECONDS, SSO_STATE_TTL_SECONDS, consumeChallenge, generateOtpCode, generateToken, issueChallenge } from '../challenges'
import { enforceRateLimit } from '../rate-limit'
import { readProfileValues, validateProfileFields, writeProfileValues } from '../profile'
import { addIdentity, assertActive, createUser, hashPassword, loadUserByEmail, loadUserById, loadUserByPhone, publicUser, siteUserOf, touchLastLogin, verifyPassword, type UserRow } from '../users'
import { deliverOtp, deliverPasswordReset } from '../delivery'
import { authorizeUrl, exchangeCode, findProvider, providerIdOf } from '../sso'
import { encryptTokenOrNull } from '../token-crypto'

export type Req = Parameters<ExtensionAdminRoute['handler']>[0]

const body = (req: Req) => ((req.body ?? {}) as Record<string, unknown>)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function requireSiteKey(req: Req): void {
  if (!req.keyCan?.('sessions')) throw forbidden('This API key cannot sign users in: grant it "Site users: sessions"')
}

export function bearerOf(req: Req): string | null {
  const h = req.headers?.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

/** The signed-in user behind the Bearer token: verified, this workspace, live session, not blocked. */
export async function currentUser(ctx: ExtensionServerCtx, req: Req): Promise<{ row: UserRow; payload: Record<string, unknown> }> {
  const token = bearerOf(req)
  if (!token) throw unauthorized('Authorization header required')
  const payload = await verifySiteToken(ctx, token)
  if (!payload) throw unauthorized('Invalid or expired token')
  if (payload.workspaceId !== ctx.workspaceId) throw unauthorized('Token does not match workspace')
  const sessionId = payload.sessionId
  if (typeof sessionId === 'string' && sessionId && !(await sessionIsActive(ctx, sessionId))) throw unauthorized('Session has been revoked')
  const row = assertActive(await loadUserById(ctx, String(payload.sub)))
  return { row, payload }
}

function requirePassword(v: unknown): string {
  const password = typeof v === 'string' ? v : ''
  if (!password) throw invalid('password is required', { password: 'password is required' })
  if (password.length < 8) throw invalid('password must be at least 8 characters', { password: 'password must be at least 8 characters' })
  return password
}

function requireEmail(v: unknown): string {
  if (!str(v)) throw invalid('email is required', { email: 'email is required' })
  const email = normalizeEmail(v)
  if (!email) throw invalid('email is invalid', { email: 'email is invalid' })
  return email
}

async function signedIn(ctx: ExtensionServerCtx, row: UserRow, provider: string) {
  const user = siteUserOf(row, ctx.workspaceId)
  const pair = await issueTokenPair(ctx, user)
  await touchLastLogin(ctx, row.id).catch(() => {})
  fireAndForget(ctx, 'onAfterLogin', () => hooksOf(ctx).onAfterLogin?.(user, hookCtx(ctx)))
  ctx.emit?.('user.signed_in', { userId: row.id, email: row.email, phone: row.phone, name: row.name, provider })
  return { data: { ...pair, user: publicUser(row) } }
}

// ─── Password ────────────────────────────────────────────────────────────────

export async function register(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  if (optionsOf(ctx).allowRegistration === false) throw forbidden('Registration is not allowed for this workspace')
  const b = body(req)
  const email = requireEmail(b.email)
  const password = requirePassword(b.password)
  const name = str(b.name) || null
  await hooksOf(ctx).onBeforeRegister?.({ email, ...(name ? { name } : {}) }, hookCtx(ctx))
  const row = await createUser(ctx, { email, name, passwordHash: await hashPassword(ctx, password), identity: { provider: 'password', providerUserId: email } })
  const user: SiteUser = siteUserOf(row, ctx.workspaceId)
  fireAndForget(ctx, 'onAfterRegister', () => hooksOf(ctx).onAfterRegister?.(user, hookCtx(ctx)))
  ctx.emit?.('user.registered', { userId: row.id, email, name, provider: 'password' })
  return Response.json({ data: { id: row.id, email, name } }, { status: 201 })
}

export async function login(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const b = body(req)
  const email = requireEmail(b.email)
  const password = typeof b.password === 'string' ? b.password : ''
  if (!password) throw invalid('password is required', { password: 'password is required' })
  enforceRateLimit(ctx.workspaceId, `login:${email}`, 5, 60)
  const row = await loadUserByEmail(ctx, email)
  if (!row?.passwordHash) throw unauthorized('Invalid email or password')
  if (row.status === 'blocked') throw forbidden('This account has been blocked')
  if (!(await verifyPassword(ctx, password, row.passwordHash))) throw unauthorized('Invalid email or password')
  await hooksOf(ctx).onBeforeLogin?.({ email }, hookCtx(ctx))
  return signedIn(ctx, row, 'password')
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function refresh(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const raw = str(body(req).refreshToken)
  if (!raw) throw invalid('refreshToken is required', { refreshToken: 'refreshToken is required' })
  const session = await findSessionByRefreshToken(ctx, raw)
  if (!session) throw unauthorized('Invalid or expired refresh token')
  if (session.revokedAt) throw unauthorized('Refresh token has been revoked')
  if (new Date(session.expiresAt) < new Date()) throw unauthorized('Refresh token has expired')
  const row = assertActive(await loadUserById(ctx, session.userId))
  await revokeSession(ctx, session.id)
  const pair = await issueTokenPair(ctx, siteUserOf(row, ctx.workspaceId))
  return { data: pair }
}

export async function logout(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const token = bearerOf(req)
  if (!token) throw unauthorized('Authorization header required')
  const payload = await verifySiteToken(ctx, token)
  if (!payload || payload.workspaceId !== ctx.workspaceId) throw unauthorized('Invalid or expired token')
  const raw = str(body(req).refreshToken)
  if (raw) {
    const session = await findSessionByRefreshToken(ctx, raw)
    if (session) await revokeSession(ctx, session.id)
  } else {
    await revokeUserSessions(ctx, String(payload.sub))
  }
  return new Response(null, { status: 204 })
}

export async function me(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const { row } = await currentUser(ctx, req)
  const fields = profileFieldsOf(ctx)
  const profile = fields.length ? await readProfileValues(dbOf(ctx), row.id, ctx.workspaceId, fields) : {}
  const providers = (await dbOf(ctx).select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, row.id))).map((r: { provider: string }) => r.provider)
  return { data: { ...publicUser(row), status: row.status, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, lastLoginAt: row.lastLoginAt instanceof Date ? row.lastLoginAt.toISOString() : row.lastLoginAt ?? null, providers, ...profile } }
}

export async function updateMe(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const { row } = await currentUser(ctx, req)
  const incoming = body(req)
  const fields = profileFieldsOf(ctx)
  const errors = validateProfileFields(fields, incoming)
  if (errors.length > 0) throw invalid('Validation failed', Object.fromEntries(errors.map((e) => [e.field, e.message])))
  if (typeof incoming.name === 'string') {
    await dbOf(ctx).update(authUsers).set({ name: incoming.name.trim() || null }).where(and(eq(authUsers.id, row.id), eq(authUsers.workspaceId, ctx.workspaceId)))
  }
  await writeProfileValues(dbOf(ctx), row.id, ctx.workspaceId, fields, incoming)
  const profile = await readProfileValues(dbOf(ctx), row.id, ctx.workspaceId, fields)
  return { data: { ...(typeof incoming.name === 'string' ? { name: incoming.name.trim() || null } : {}), ...profile } }
}

// ─── One-time codes ──────────────────────────────────────────────────────────

function otpTarget(ctx: ExtensionServerCtx, b: Record<string, unknown>): { channel: 'email' | 'sms'; to: string } {
  const channels = optionsOf(ctx).otp?.channels ?? ['email']
  if (str(b.phone)) {
    if (!channels.includes('sms')) throw invalid('Codes by SMS are not enabled for this workspace', { phone: 'not enabled' })
    const phone = normalizePhone(b.phone)
    if (!phone) throw invalid('phone must be in international format, e.g. +14155552671', { phone: 'phone is invalid' })
    return { channel: 'sms', to: phone }
  }
  if (!channels.includes('email')) throw invalid('Codes by email are not enabled for this workspace', { email: 'not enabled' })
  return { channel: 'email', to: requireEmail(b.email) }
}

export async function otpSend(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const target = otpTarget(ctx, body(req))
  enforceRateLimit(ctx.workspaceId, `otp-send:${target.to}`, 3, 60)
  const ttlSeconds = optionsOf(ctx).otp?.ttlSeconds ?? OTP_TTL_SECONDS
  const code = generateOtpCode()
  await issueChallenge(ctx, { kind: 'otp', subject: target.to, secret: code, ttlSeconds, payload: { channel: target.channel } })
  const delivery: OtpDelivery = { channel: target.channel, to: target.to, code, ttlSeconds }
  await deliverOtp(ctx, delivery)
  return { data: { message: target.channel === 'sms' ? 'If the number is valid, a code has been sent.' : 'If an account exists, a code has been sent.', channel: target.channel, expiresIn: ttlSeconds } }
}

export async function otpVerify(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const b = body(req)
  const target = otpTarget(ctx, b)
  const code = str(b.code)
  if (!code) throw invalid('code is required', { code: 'code is required' })
  enforceRateLimit(ctx.workspaceId, `otp-verify:${target.to}`, 10, 60)
  const result = await consumeChallenge(ctx, { kind: 'otp', subject: target.to, secret: code })
  if (!result.ok) {
    if (result.reason === 'expired') throw unauthorized('The code has expired')
    if (result.reason === 'too_many_attempts') throw unauthorized('Too many wrong codes, request a new one')
    throw unauthorized('Invalid or expired code')
  }
  let row = target.channel === 'sms' ? await loadUserByPhone(ctx, target.to) : await loadUserByEmail(ctx, target.to)
  if (!row) {
    if (optionsOf(ctx).otp?.allowSignup === false) throw unauthorized('No account for this address')
    row = await createUser(ctx, {
      email: target.channel === 'email' ? target.to : null,
      phone: target.channel === 'sms' ? target.to : null,
      identity: { provider: 'otp', providerUserId: target.to },
    })
    ctx.emit?.('user.registered', { userId: row.id, email: row.email, phone: row.phone, name: null, provider: 'otp' })
  } else {
    if (row.status === 'blocked') throw forbidden('This account has been blocked')
    await addIdentity(ctx, row.id, 'otp', target.to)
  }
  return signedIn(ctx, row, 'otp')
}

// ─── Guests ──────────────────────────────────────────────────────────────────

export async function anonymous(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  if (!optionsOf(ctx).allowAnonymous) throw forbidden('Anonymous sessions are not enabled for this workspace')
  const row = await createUser(ctx, { isAnonymous: true })
  const pair = await issueTokenPair(ctx, siteUserOf(row, ctx.workspaceId))
  return { data: { ...pair, user: publicUser(row) } }
}

export async function anonymousConvert(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const { row, payload } = await currentUser(ctx, req)
  if (!row.isAnonymous) throw forbidden('Account is already registered')
  const b = body(req)
  const email = requireEmail(b.email)
  const password = requirePassword(b.password)
  const name = str(b.name) || null
  if (await loadUserByEmail(ctx, email)) throw new RequestError('CONFLICT', 'An account with this email already exists', 409)
  await dbOf(ctx).update(authUsers).set({ email, name, passwordHash: await hashPassword(ctx, password), isAnonymous: false })
    .where(and(eq(authUsers.id, row.id), eq(authUsers.workspaceId, ctx.workspaceId)))
  await addIdentity(ctx, row.id, 'password', email)
  if (typeof payload.sessionId === 'string' && payload.sessionId) await revokeSession(ctx, payload.sessionId)
  const converted: UserRow = { ...row, email, name, isAnonymous: false }
  const pair = await issueTokenPair(ctx, siteUserOf(converted, ctx.workspaceId))
  ctx.emit?.('user.registered', { userId: row.id, email, name, provider: 'password', converted: true })
  return { data: { ...pair, user: publicUser(converted) } }
}

// ─── Password reset ──────────────────────────────────────────────────────────

export async function passwordResetRequest(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const email = requireEmail(body(req).email)
  enforceRateLimit(ctx.workspaceId, `pw-reset:${email}`, 3, 60)
  const row = await loadUserByEmail(ctx, email)
  if (row) {
    const token = generateToken(32)
    await issueChallenge(ctx, { kind: 'password_reset', subject: row.id, secret: token, ttlSeconds: RESET_TTL_SECONDS, payload: { userId: row.id } })
    await deliverPasswordReset(ctx, email, token)
  }
  return { data: { message: 'If an account exists with this email, a password reset link has been sent.' } }
}

export async function passwordResetConfirm(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const b = body(req)
  const token = str(b.token)
  if (!token) throw invalid('token is required', { token: 'token is required' })
  const password = requirePassword(b.password)
  const result = await consumeChallenge(ctx, { kind: 'password_reset', secret: token })
  const userId = result.ok ? String(result.payload?.userId ?? '') : ''
  if (!userId) throw unauthorized('Invalid or expired password reset token')
  await dbOf(ctx).update(authUsers).set({ passwordHash: await hashPassword(ctx, password) })
    .where(and(eq(authUsers.id, userId), eq(authUsers.workspaceId, ctx.workspaceId)))
  await revokeUserSessions(ctx, userId)
  return { data: { message: 'Password has been reset. Sign in with the new password.' } }
}

// ─── SSO ─────────────────────────────────────────────────────────────────────

/** The API's own origin as the browser reached it (a trusted proxy's headers honoured). */
export function requestOrigin(req: Req): string {
  const url = new URL(req.url ?? 'http://localhost')
  const proto = req.headers?.['x-forwarded-proto']?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  const host = req.headers?.['x-forwarded-host']?.split(',')[0]?.trim() || url.host
  return `${proto}://${host}`
}

export function callbackUrl(origin: string, workspaceId: string, providerId: string): string {
  return `${origin}/api/v1/ext/auth/sso/${providerId}/callback?workspace=${encodeURIComponent(workspaceId)}`
}

export async function ssoStart(ctx: ExtensionServerCtx, req: Req) {
  requireSiteKey(req)
  const id = String(req.params.provider ?? '')
  const cfg = findProvider(ctx, id)
  if (!cfg) throw new RequestError('NOT_FOUND', `SSO provider "${id}" is not configured for this workspace`, 404)
  const state = generateToken(16)
  const returnTo = str(req.query?.returnTo) || null
  await issueChallenge(ctx, { kind: 'sso_state', subject: state, secret: state, ttlSeconds: SSO_STATE_TTL_SECONDS, payload: { provider: providerIdOf(cfg), returnTo } })
  const location = await authorizeUrl(ctx, cfg, { redirectUri: callbackUrl(requestOrigin(req), ctx.workspaceId, providerIdOf(cfg)), state })
  if (str(req.query?.mode) === 'json') return { data: { url: location, state } }
  return new Response(null, { status: 302, headers: { Location: location } })
}

export async function ssoCallback(ctx: ExtensionServerCtx, req: Req) {
  const state = str(req.query?.state)
  const code = str(req.query?.code)
  if (!state) throw new RequestError('VALIDATION_ERROR', 'state parameter is required', 400)
  if (!code) throw new RequestError('VALIDATION_ERROR', 'code parameter is required', 400)
  const consumed = await consumeChallenge(ctx, { kind: 'sso_state', subject: state, secret: state })
  if (!consumed.ok) throw unauthorized('Invalid or expired OAuth state')
  const providerId = String(consumed.payload?.provider ?? req.params.provider ?? '')
  const cfg = findProvider(ctx, providerId)
  if (!cfg || providerId !== String(req.params.provider ?? providerId)) throw new RequestError('NOT_FOUND', 'SSO provider is not configured', 404)
  const profile = await exchangeCode(ctx, cfg, { code, redirectUri: callbackUrl(requestOrigin(req), ctx.workspaceId, providerId) })

  const db = dbOf(ctx)
  const [account] = await db.select().from(authSsoAccounts)
    .where(and(eq(authSsoAccounts.workspaceId, ctx.workspaceId), eq(authSsoAccounts.provider, providerId), eq(authSsoAccounts.providerUserId, profile.subject))).limit(1)
  let row: UserRow | undefined
  let registered = false
  if (account) {
    row = assertActive(await loadUserById(ctx, account.userId))
  } else {
    // A verified email that already has an account links the provider to it; otherwise a new account.
    const existing = profile.email && profile.emailVerified ? await loadUserByEmail(ctx, profile.email) : undefined
    if (existing) {
      row = assertActive(existing)
    } else {
      row = await createUser(ctx, { email: profile.email && profile.emailVerified ? profile.email : null, name: profile.name })
      registered = true
    }
    await db.insert(authSsoAccounts).values({
      id: `sso_${generateToken(8)}`, userId: row.id, workspaceId: ctx.workspaceId, provider: providerId, providerUserId: profile.subject,
      accessToken: await encryptTokenOrNull(ctx, profile.accessToken), refreshToken: await encryptTokenOrNull(ctx, profile.refreshToken), expiresAt: profile.expiresAt,
    }).onConflictDoNothing()
  }
  await addIdentity(ctx, row.id, providerId, profile.subject)
  if (registered) ctx.emit?.('user.registered', { userId: row.id, email: row.email, name: row.name, provider: providerId })
  const answer = await signedIn(ctx, row, providerId)

  const redirectTo = (consumed.payload?.returnTo as string | null) ?? optionsOf(ctx).ssoRedirectUrl ?? null
  if (redirectTo) {
    const dest = new URL(redirectTo)
    dest.searchParams.set('accessToken', answer.data.accessToken)
    dest.searchParams.set('refreshToken', answer.data.refreshToken)
    return new Response(null, { status: 302, headers: { Location: dest.toString() } })
  }
  return answer
}

// ─── The mount ───────────────────────────────────────────────────────────────

export const siteRoutes: ExtensionAdminRoute[] = [
  { method: 'POST', path: 'register', auth: 'key', handler: (req, ctx) => register(ctx, req) },
  { method: 'POST', path: 'login', auth: 'key', handler: (req, ctx) => login(ctx, req) },
  { method: 'POST', path: 'refresh', auth: 'key', handler: (req, ctx) => refresh(ctx, req) },
  { method: 'POST', path: 'logout', auth: 'key', handler: (req, ctx) => logout(ctx, req) },
  { method: 'GET', path: 'me', auth: 'key', handler: (req, ctx) => me(ctx, req) },
  { method: 'PATCH', path: 'me', auth: 'key', handler: (req, ctx) => updateMe(ctx, req) },
  { method: 'POST', path: 'otp/send', auth: 'key', handler: (req, ctx) => otpSend(ctx, req) },
  { method: 'POST', path: 'otp/verify', auth: 'key', handler: (req, ctx) => otpVerify(ctx, req) },
  { method: 'POST', path: 'anonymous', auth: 'key', handler: (req, ctx) => anonymous(ctx, req) },
  { method: 'POST', path: 'anonymous/convert', auth: 'key', handler: (req, ctx) => anonymousConvert(ctx, req) },
  { method: 'POST', path: 'password-reset/request', auth: 'key', handler: (req, ctx) => passwordResetRequest(ctx, req) },
  { method: 'POST', path: 'password-reset/confirm', auth: 'key', handler: (req, ctx) => passwordResetConfirm(ctx, req) },
  { method: 'GET', path: 'sso/:provider', auth: 'key', handler: (req, ctx) => ssoStart(ctx, req) },
  { method: 'GET', path: 'sso/:provider/callback', auth: 'public', authority: {}, handler: (req, ctx) => ssoCallback(ctx, req) },
]
