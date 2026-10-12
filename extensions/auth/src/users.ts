/**
 * File Name: users.ts
 * Purpose: The user rows: loading by id, email or phone; creating an account
 *          with its first identity; the shapes the routes answer with; the
 *          password hashing the hooks may replace.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { ExtensionServerCtx, SiteUser } from '@tangen/cms'
import { authIdentities, authUsers } from './tables'
import { dbOf, hooksOf } from './context'
import { RequestError } from './errors'

export type UserRow = typeof authUsers.$inferSelect

export const newUserId = () => `au_${randomBytes(8).toString('hex')}`
export const newIdentityId = () => `aid_${randomBytes(8).toString('hex')}`

const iso = (d: Date | string | null | undefined): string | null => (d instanceof Date ? d.toISOString() : d ? String(d) : null)

/** The SiteUser a row is, as core and the hooks see it. */
export function siteUserOf(row: UserRow, workspaceId: string, extra: Record<string, unknown> = {}): SiteUser {
  return {
    id: String(row.id),
    workspaceId,
    email: row.email ?? null,
    phone: row.phone ?? null,
    name: row.name ?? null,
    role: row.role ?? 'user',
    status: row.status === 'blocked' ? 'blocked' : 'active',
    isAnonymous: !!row.isAnonymous,
    createdAt: iso(row.createdAt) ?? '',
    lastLoginAt: iso(row.lastLoginAt),
    ...extra,
  }
}

/** What a sign-in answers with: never the hash, never the internals. */
export function publicUser(row: UserRow) {
  return { id: row.id, email: row.email ?? null, phone: row.phone ?? null, name: row.name ?? null, role: row.role, isAnonymous: !!row.isAnonymous }
}

/** The admin's view of a user. */
export function adminUser(row: UserRow) {
  return {
    id: row.id, email: row.email ?? null, phone: row.phone ?? null, name: row.name ?? null, role: row.role, status: row.status,
    isAnonymous: !!row.isAnonymous, createdAt: iso(row.createdAt), lastLoginAt: iso(row.lastLoginAt),
  }
}

export async function loadUserById(ctx: ExtensionServerCtx, id: string): Promise<UserRow | undefined> {
  const [row] = await dbOf(ctx).select().from(authUsers).where(and(eq(authUsers.id, id), eq(authUsers.workspaceId, ctx.workspaceId))).limit(1)
  return row
}

export async function loadUserByEmail(ctx: ExtensionServerCtx, email: string): Promise<UserRow | undefined> {
  const [row] = await dbOf(ctx).select().from(authUsers).where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.email, email))).limit(1)
  return row
}

export async function loadUserByPhone(ctx: ExtensionServerCtx, phone: string): Promise<UserRow | undefined> {
  const [row] = await dbOf(ctx).select().from(authUsers).where(and(eq(authUsers.workspaceId, ctx.workspaceId), eq(authUsers.phone, phone))).limit(1)
  return row
}

export async function hashPassword(ctx: ExtensionServerCtx, password: string): Promise<string> {
  const custom = hooksOf(ctx).hashPassword
  return custom ? custom(password) : Bun.password.hash(password, { algorithm: 'argon2id' })
}

export async function verifyPassword(ctx: ExtensionServerCtx, password: string, hash: string): Promise<boolean> {
  const custom = hooksOf(ctx).verifyPassword
  return custom ? custom(password, hash) : Bun.password.verify(password, hash)
}

/** A unique-index violation, as postgres-js raises it or as drizzle wraps it (`cause`). */
export function isDuplicateError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505' || /duplicate key/i.test(e?.message ?? '') || /duplicate key/i.test(e?.cause?.message ?? '')
}
const isDuplicate = isDuplicateError

/** Inserts a user and, when given, its first identity; a duplicate email or phone is a 409. */
export async function createUser(ctx: ExtensionServerCtx, input: {
  email?: string | null; phone?: string | null; name?: string | null; passwordHash?: string | null; role?: string; isAnonymous?: boolean
  identity?: { provider: string; providerUserId: string }
}): Promise<UserRow> {
  const db = dbOf(ctx)
  const id = newUserId()
  const values = {
    id, workspaceId: ctx.workspaceId,
    email: input.email ?? null, phone: input.phone ?? null, name: input.name ?? null,
    passwordHash: input.passwordHash ?? null, role: input.role ?? 'user', isAnonymous: input.isAnonymous ?? false,
  }
  try {
    await db.insert(authUsers).values(values)
    if (input.identity) await addIdentity(ctx, id, input.identity.provider, input.identity.providerUserId)
  } catch (err) {
    if (isDuplicate(err)) throw new RequestError('CONFLICT', input.phone && !input.email ? 'An account with this phone number already exists' : 'An account with this email already exists', 409)
    throw err
  }
  const now = new Date()
  return { ...values, status: 'active', createdAt: now, lastLoginAt: null } as UserRow
}

export async function addIdentity(ctx: ExtensionServerCtx, userId: string, provider: string, providerUserId: string): Promise<void> {
  await dbOf(ctx).insert(authIdentities).values({ id: newIdentityId(), userId, workspaceId: ctx.workspaceId, provider, providerUserId }).onConflictDoNothing()
}

export async function identityProvidersOf(ctx: ExtensionServerCtx, userId: string): Promise<string[]> {
  const rows = await dbOf(ctx).select({ provider: authIdentities.provider }).from(authIdentities).where(and(eq(authIdentities.userId, userId), eq(authIdentities.workspaceId, ctx.workspaceId)))
  return rows.map((r: { provider: string }) => r.provider)
}

export async function touchLastLogin(ctx: ExtensionServerCtx, userId: string): Promise<void> {
  await dbOf(ctx).update(authUsers).set({ lastLoginAt: new Date() }).where(and(eq(authUsers.id, userId), eq(authUsers.workspaceId, ctx.workspaceId)))
}

export function assertActive(row: UserRow | undefined): UserRow {
  if (!row) throw new RequestError('UNAUTHORIZED', 'User not found', 401)
  if (row.status === 'blocked') throw new RequestError('FORBIDDEN', 'This account has been blocked', 403)
  return row
}
