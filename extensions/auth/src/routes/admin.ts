/**
 * File Name: admin.ts
 * Purpose: The member routes behind the admin pages: the user list with its
 *          filters, one user with profile, identities and sessions, create,
 *          edit, block and unblock, revoke a session, the sign-in methods
 *          overview, and the dashboard widget's numbers.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import type { ExtensionAdminRoute, ExtensionServerCtx } from '@tangen/cms'
import { authIdentities, authSessions, authUsers } from '../tables'
import { normalizeEmail, normalizePhone, type ProfileFieldDef, type SignInMethods } from '../contract'
import { dbOf, optionsOf, profileFieldsOf, rolesOf, rowsOf } from '../context'
import { RequestError, invalid } from '../errors'
import { revokeSession, revokeUserSessions, DEFAULT_ACCESS_TTL, DEFAULT_REFRESH_TTL } from '../sessions'
import { readProfileValues, safeCol, validateProfileFields, writeProfileValues } from '../profile'
import { adminUser, createUser, hashPassword, identityProvidersOf, isDuplicateError, loadUserById, type UserRow } from '../users'
import { providerConfigured, providerIdOf, providersOf } from '../sso'
import type { Req } from './site'
import { callbackUrl, requestOrigin } from './site'

const body = (req: Req) => ((req.body ?? {}) as Record<string, unknown>)

function sessionShape(s: typeof authSessions.$inferSelect) {
  const now = new Date()
  return {
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    revokedAt: s.revokedAt?.toISOString() ?? null,
    isActive: s.revokedAt === null && s.expiresAt > now,
  }
}

const publicField = (f: ProfileFieldDef) => ({ name: f.name, label: f.label, fieldType: f.fieldType, config: f.config, required: f.required, adminEditable: f.adminEditable })

export async function listUsers(ctx: ExtensionServerCtx, req: Req) {
  const db = dbOf(ctx)
  const q = req.query ?? {}
  const status = q.status ?? 'all'
  const search = (q.search ?? '').trim()
  const role = (q.role ?? '').trim()
  const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '', 10) || 25))
  const offset = Math.max(0, parseInt(q.offset ?? '', 10) || 0)
  let fieldFilters: Array<{ fieldName: string; operator: string; value: unknown }> = []
  try { if (q.fieldFilters) fieldFilters = JSON.parse(q.fieldFilters) } catch { /* ignore */ }
  const fields = profileFieldsOf(ctx)
  const listFields = fields.filter((f) => f.config?.admin?.showInList)

  const conditions: unknown[] = [eq(authUsers.workspaceId, ctx.workspaceId)]
  if (status === 'active' || status === 'blocked') conditions.push(eq(authUsers.status, status))
  if (status === 'anonymous') conditions.push(eq(authUsers.isAnonymous, true))
  if (role) conditions.push(eq(authUsers.role, role))
  if (search) {
    const clauses: unknown[] = [ilike(authUsers.name, `%${search}%`), ilike(authUsers.email, `%${search}%`), ilike(authUsers.phone, `%${search}%`)]
    for (const f of fields) {
      if (f.config?.admin?.searchable && (f.fieldType === 'text' || f.fieldType === 'textarea' || f.fieldType === 'phone' || f.fieldType === 'email')) {
        clauses.push(sql`${sql.raw(`"${safeCol(f.name)}"`)} ILIKE ${'%' + search + '%'}`)
      }
    }
    conditions.push(or(...(clauses as never[])))
  }
  if (q.createdFrom) conditions.push(gte(authUsers.createdAt, new Date(q.createdFrom)))
  if (q.createdTo) conditions.push(lte(authUsers.createdAt, new Date(q.createdTo)))
  for (const filter of fieldFilters) {
    const def = fields.find((f) => f.name === filter.fieldName)
    if (!def) continue
    const col = sql.raw(`"${safeCol(filter.fieldName)}"`)
    const v = filter.value
    switch (filter.operator) {
      case 'contains': conditions.push(sql`${col} ILIKE ${'%' + String(v) + '%'}`); break
      case 'ncontains': conditions.push(sql`${col} NOT ILIKE ${'%' + String(v) + '%'}`); break
      case 'eq': conditions.push(sql`${col} = ${v}`); break
      case 'ne': conditions.push(sql`${col} != ${v}`); break
      case 'gt': conditions.push(sql`${col} > ${v}`); break
      case 'gte': conditions.push(sql`${col} >= ${v}`); break
      case 'lt': conditions.push(sql`${col} < ${v}`); break
      case 'lte': conditions.push(sql`${col} <= ${v}`); break
      case 'in': {
        if (!Array.isArray(v)) break
        const allowed = def.fieldType === 'select' && def.config?.options ? new Set(def.config.options.map((o) => o.value)) : null
        const vals = (v as string[]).filter((x) => !allowed || allowed.has(x))
        if (vals.length) conditions.push(sql`${col} IN (${sql.join(vals.map((x) => sql`${x}`), sql`, `)})`)
        break
      }
      case 'between': case 'range': {
        const { from, to } = (v ?? {}) as { from?: unknown; to?: unknown }
        if (from != null && from !== '') conditions.push(sql`${col} >= ${filter.operator === 'range' ? new Date(String(from)) : from}`)
        if (to != null && to !== '') conditions.push(sql`${col} <= ${filter.operator === 'range' ? new Date(String(to)) : to}`)
        break
      }
    }
  }
  const where = and(...(conditions as never[]))
  const [{ total }] = await db.select({ total: count() }).from(authUsers).where(where)
  const rows: UserRow[] = await db.select().from(authUsers).where(where).orderBy(desc(authUsers.createdAt)).limit(limit).offset(offset)
  const profileByUser: Record<string, Record<string, unknown>> = {}
  if (listFields.length > 0 && rows.length > 0) {
    const cols = sql.join(listFields.map((f) => sql.raw(`"${safeCol(f.name)}"`)), sql`, `)
    const ids = sql.join(rows.map((r) => sql`${r.id}`), sql`, `)
    const raw = rowsOf(await db.execute(sql`SELECT id, ${cols} FROM auth_users WHERE id IN (${ids}) AND workspace_id = ${ctx.workspaceId}`))
    for (const r of raw) profileByUser[String(r.id)] = r
  }
  return {
    data: rows.map((u) => ({ ...adminUser(u), ...(profileByUser[u.id] ? Object.fromEntries(listFields.map((f) => [f.name, profileByUser[u.id]![f.name]])) : {}) })),
    meta: { total: Number(total), limit, offset },
    profileFields: fields.map(publicField),
    roles: rolesOf(ctx),
  }
}

export async function createUserRoute(ctx: ExtensionServerCtx, req: Req) {
  const b = body(req)
  const email = typeof b.email === 'string' && b.email.trim() ? normalizeEmail(b.email) : null
  const phone = typeof b.phone === 'string' && b.phone.trim() ? normalizePhone(b.phone) : null
  if (typeof b.email === 'string' && b.email.trim() && !email) throw invalid('email is invalid', { email: 'email is invalid' })
  if (typeof b.phone === 'string' && b.phone.trim() && !phone) throw invalid('phone must be in international format', { phone: 'phone is invalid' })
  if (!email && !phone) throw invalid('an email or a phone number is required', { email: 'required' })
  const name = typeof b.name === 'string' ? b.name.trim() || null : null
  const password = typeof b.password === 'string' ? b.password : ''
  if (password && password.length < 8) throw invalid('password must be at least 8 characters', { password: 'password must be at least 8 characters' })
  if (password && !email) throw invalid('a password needs an email to sign in with', { password: 'needs an email' })
  const role = typeof b.role === 'string' && b.role ? b.role : 'user'
  const roles = rolesOf(ctx)
  if (!roles.includes(role)) throw invalid(`role must be one of: ${roles.join(', ')}`, { role: 'invalid' })
  const profileMeta = (b.profileMeta as Record<string, unknown> | undefined) ?? {}
  const fields = profileFieldsOf(ctx)
  const errors = validateProfileFields(fields, profileMeta)
  if (errors.length > 0) throw invalid('Profile field validation failed', Object.fromEntries(errors.map((e) => [e.field, e.message])))
  const row = await createUser(ctx, {
    email, phone, name, role,
    passwordHash: password ? await hashPassword(ctx, password) : null,
    identity: password && email ? { provider: 'password', providerUserId: email } : undefined,
  })
  if (Object.keys(profileMeta).length > 0) await writeProfileValues(dbOf(ctx), row.id, ctx.workspaceId, fields.filter((f) => f.adminEditable !== false), profileMeta)
  return Response.json({ data: adminUser(row) }, { status: 201 })
}

export async function getUser(ctx: ExtensionServerCtx, req: Req) {
  const row = await loadUserById(ctx, String(req.params.id))
  if (!row) throw new RequestError('NOT_FOUND', 'User not found', 404)
  const fields = profileFieldsOf(ctx)
  const [profileMeta, providers] = await Promise.all([readProfileValues(dbOf(ctx), row.id, ctx.workspaceId, fields), identityProvidersOf(ctx, row.id)])
  return { data: { ...adminUser(row), providers, profileMeta, profileFields: fields.map(publicField) }, roles: rolesOf(ctx) }
}

export async function patchUser(ctx: ExtensionServerCtx, req: Req) {
  const row = await loadUserById(ctx, String(req.params.id))
  if (!row) throw new RequestError('NOT_FOUND', 'User not found', 404)
  const b = body(req)
  const set: Partial<UserRow> = {}
  if ('name' in b) set.name = typeof b.name === 'string' ? b.name.trim() || null : null
  if (typeof b.role === 'string') {
    if (!rolesOf(ctx).includes(b.role)) throw invalid(`role must be one of: ${rolesOf(ctx).join(', ')}`, { role: 'invalid' })
    set.role = b.role
  }
  if (typeof b.email === 'string') {
    const email = b.email.trim() ? normalizeEmail(b.email) : null
    if (b.email.trim() && !email) throw invalid('email is invalid', { email: 'email is invalid' })
    set.email = email
  }
  if (typeof b.phone === 'string') {
    const phone = b.phone.trim() ? normalizePhone(b.phone) : null
    if (b.phone.trim() && !phone) throw invalid('phone must be in international format', { phone: 'phone is invalid' })
    set.phone = phone
  }
  if (typeof b.password === 'string' && b.password) {
    if (b.password.length < 8) throw invalid('password must be at least 8 characters', { password: 'password must be at least 8 characters' })
    set.passwordHash = await hashPassword(ctx, b.password)
  }
  const profileMeta = b.profileMeta as Record<string, unknown> | undefined
  const fields = profileFieldsOf(ctx)
  if (profileMeta) {
    const editable = fields.filter((f) => f.adminEditable !== false)
    const errors = validateProfileFields(editable, profileMeta)
    if (errors.length > 0) throw invalid('Validation failed', Object.fromEntries(errors.map((e) => [e.field, e.message])))
  }
  try {
    if (Object.keys(set).length) await dbOf(ctx).update(authUsers).set(set).where(and(eq(authUsers.id, row.id), eq(authUsers.workspaceId, ctx.workspaceId)))
  } catch (err) {
    if (isDuplicateError(err)) throw new RequestError('CONFLICT', 'Another account already uses that email or phone', 409)
    throw err
  }
  if (profileMeta) await writeProfileValues(dbOf(ctx), row.id, ctx.workspaceId, fields.filter((f) => f.adminEditable !== false), profileMeta)
  if (set.passwordHash) await revokeUserSessions(ctx, row.id)
  return getUser(ctx, req)
}

export async function listSessions(ctx: ExtensionServerCtx, req: Req) {
  const rows: Array<typeof authSessions.$inferSelect> = await dbOf(ctx).select().from(authSessions)
    .where(and(eq(authSessions.userId, String(req.params.id)), eq(authSessions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(authSessions.createdAt)).limit(50)
  return { data: rows.map(sessionShape) }
}

export async function revokeSessionRoute(ctx: ExtensionServerCtx, req: Req) {
  await revokeSession(ctx, String(req.params.sessionId))
  return new Response(null, { status: 204 })
}

export async function blockUser(ctx: ExtensionServerCtx, req: Req) {
  const id = String(req.params.id)
  await dbOf(ctx).update(authUsers).set({ status: 'blocked' }).where(and(eq(authUsers.id, id), eq(authUsers.workspaceId, ctx.workspaceId)))
  await revokeUserSessions(ctx, id)
  return { data: { id, status: 'blocked' } }
}

export async function unblockUser(ctx: ExtensionServerCtx, req: Req) {
  const id = String(req.params.id)
  await dbOf(ctx).update(authUsers).set({ status: 'active' }).where(and(eq(authUsers.id, id), eq(authUsers.workspaceId, ctx.workspaceId)))
  return { data: { id, status: 'active' } }
}

export async function signOutEverywhere(ctx: ExtensionServerCtx, req: Req) {
  await revokeUserSessions(ctx, String(req.params.id))
  return new Response(null, { status: 204 })
}

/** What sign-in looks like for this workspace, as the admin's Sign-in methods page shows it. */
export function signInMethods(ctx: ExtensionServerCtx, req?: Req): SignInMethods & { callbackUrls: Record<string, string> } {
  const o = optionsOf(ctx)
  const providers = providersOf(ctx)
  const origin = req?.url ? requestOrigin(req) : ''
  return {
    password: { enabled: true, registration: o.allowRegistration !== false },
    otp: { channels: o.otp?.channels ?? ['email'], smsConfigured: Boolean(o.sms?.send || o.hooks?.onOtpSend), delivery: o.hooks?.onOtpSend ? 'hook' : 'mailer' },
    sso: providers.map((p) => ({ id: providerIdOf(p), name: p.name, label: p.label ?? (p.name === 'google' ? 'Google' : p.name === 'github' ? 'GitHub' : providerIdOf(p)), configured: providerConfigured(ctx, p) })),
    anonymous: o.allowAnonymous === true,
    roles: [...rolesOf(ctx)],
    profileFields: profileFieldsOf(ctx),
    token: { accessTtl: o.token?.accessTtl ?? DEFAULT_ACCESS_TTL, refreshTtl: o.token?.refreshTtl ?? DEFAULT_REFRESH_TTL },
    ssoRedirectUrl: o.ssoRedirectUrl ?? null,
    callbackUrls: Object.fromEntries(providers.map((p) => [providerIdOf(p), origin ? callbackUrl(origin, ctx.workspaceId, providerIdOf(p)) : `/api/v1/ext/auth/sso/${providerIdOf(p)}/callback?workspace=${ctx.workspaceId}`])),
  }
}

export async function widgetData(ctx: ExtensionServerCtx) {
  const db = dbOf(ctx)
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [all] = await db.select({ n: count() }).from(authUsers).where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.isAnonymous, false)))
  const [week] = await db.select({ n: count() }).from(authUsers).where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.isAnonymous, false), gte(authUsers.lastLoginAt, weekStart)))
  const [joined] = await db.select({ n: count() }).from(authUsers).where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.isAnonymous, false), gte(authUsers.createdAt, weekStart)))
  const [blocked] = await db.select({ n: count() }).from(authUsers).where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.status, 'blocked')))
  return {
    stats: [
      { label: 'Users', value: Number(all?.n ?? 0), href: '/extensions/auth' },
      { label: 'Signed in this week', value: Number(week?.n ?? 0), href: '/extensions/auth' },
      { label: 'Joined this week', value: Number(joined?.n ?? 0), tone: Number(joined?.n ?? 0) > 0 ? 'success' : 'neutral', href: '/extensions/auth' },
      { label: 'Blocked', value: Number(blocked?.n ?? 0), tone: Number(blocked?.n ?? 0) > 0 ? 'warning' : 'neutral', href: '/extensions/auth?status=blocked' },
    ],
  }
}

export const adminRoutes: ExtensionAdminRoute[] = [
  { method: 'GET', path: 'users', capability: 'auth:read', handler: (req, ctx) => listUsers(ctx, req) },
  { method: 'POST', path: 'users', capability: 'auth:manage', handler: (req, ctx) => createUserRoute(ctx, req) },
  { method: 'GET', path: 'users/:id', capability: 'auth:read', handler: (req, ctx) => getUser(ctx, req) },
  { method: 'PATCH', path: 'users/:id', capability: 'auth:manage', handler: (req, ctx) => patchUser(ctx, req) },
  { method: 'GET', path: 'users/:id/sessions', capability: 'auth:read', handler: (req, ctx) => listSessions(ctx, req) },
  { method: 'DELETE', path: 'users/:id/sessions', capability: 'auth:manage', handler: (req, ctx) => signOutEverywhere(ctx, req) },
  { method: 'DELETE', path: 'users/:id/sessions/:sessionId', capability: 'auth:manage', handler: (req, ctx) => revokeSessionRoute(ctx, req) },
  { method: 'POST', path: 'users/:id/block', capability: 'auth:manage', handler: (req, ctx) => blockUser(ctx, req) },
  { method: 'POST', path: 'users/:id/unblock', capability: 'auth:manage', handler: (req, ctx) => unblockUser(ctx, req) },
  { method: 'GET', path: 'methods', capability: 'auth:read', handler: (req, ctx) => ({ data: signInMethods(ctx, req) }) },
  { method: 'GET', path: 'widget-data', capability: 'auth:read', handler: (_req, ctx) => widgetData(ctx) },
]
