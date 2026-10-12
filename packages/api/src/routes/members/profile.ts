/**
 * File Name: profile.ts
 * Purpose: Self-service member profile — a member editing ONLY their own record:
 *          GET /api/v1/me/profile, PATCH /api/v1/me/profile (name/email/
 *          designation/avatar), POST /api/v1/me/password (verify current →
 *          set new). All keyed off ctx.memberId (the JWT), so there is no id
 *          param and a member can never touch anyone else's data.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { and, eq, ne } from 'drizzle-orm'
import { members } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { verifyPassword } from '../auth/login'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PROFILE_COLS = {
  id: members.id, name: members.name, email: members.email,
  role: members.role, designation: members.designation, avatar: members.avatar,
}

export interface ProfilePatch { name?: string | null; email?: string; designation?: string | null; avatar?: string | null }

/** Validate + normalize a PATCH body (throws 422 on a bad email). */
export function buildProfilePatch(body: unknown): ProfilePatch {
  const b = (body ?? {}) as Record<string, unknown>
  const out: ProfilePatch = {}
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if ('name' in b) out.name = str(b.name) || null
  if ('designation' in b) out.designation = str(b.designation) || null
  if ('avatar' in b) out.avatar = str(b.avatar) || null
  if ('email' in b) {
    const email = str(b.email).toLowerCase()
    if (!email || !EMAIL_RE.test(email)) {
      throw new RequestError('VALIDATION_ERROR', 'Enter a valid email', 422, { email: 'Enter a valid email' })
    }
    out.email = email
  }
  return out
}

export const meProfileRoute = (app: Elysia) =>
  app
    .get('/api/v1/me/profile', async (ctx: any) => {
      const { db, memberId } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member session required', 403)
      const [row] = await db.select(PROFILE_COLS).from(members).where(eq(members.id, memberId)).limit(1)
      if (!row) throw new RequestError('NOT_FOUND', 'Member not found', 404)
      return { data: row }
    })

    .patch('/api/v1/me/profile', async (ctx: any) => {
      const { db, memberId, workspaceId, body } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member session required', 403)
      const patch = buildProfilePatch(body)
      if (Object.keys(patch).length === 0) throw new RequestError('VALIDATION_ERROR', 'Nothing to update', 422)
      if (patch.email) {
        const [clash] = await db.select({ id: members.id }).from(members)
          .where(and(eq(members.workspaceId, workspaceId), eq(members.email, patch.email), ne(members.id, memberId)))
          .limit(1)
        if (clash) throw new RequestError('CONFLICT', 'That email is already in use', 409, { email: 'Already in use' })
      }
      await db.update(members).set(patch).where(eq(members.id, memberId))
      const [row] = await db.select(PROFILE_COLS).from(members).where(eq(members.id, memberId)).limit(1)
      return { data: row }
    })

    .post('/api/v1/me/password', async (ctx: any) => {
      const { db, memberId, body } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Member session required', 403)
      const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
      if (newPassword.length < 8) {
        throw new RequestError('VALIDATION_ERROR', 'New password must be at least 8 characters', 422, { newPassword: 'At least 8 characters' })
      }
      const [row] = await db.select({ passwordHash: members.passwordHash }).from(members).where(eq(members.id, memberId)).limit(1)
      if (!row) throw new RequestError('NOT_FOUND', 'Member not found', 404)
      if (!(await verifyPassword(currentPassword, row.passwordHash))) {
        throw new RequestError('VALIDATION_ERROR', 'Current password is incorrect', 422, { currentPassword: 'Incorrect' })
      }
      const passwordHash = await Bun.password.hash(newPassword, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 })
      await db.update(members).set({ passwordHash }).where(eq(members.id, memberId))
      return { data: { ok: true } }
    })
