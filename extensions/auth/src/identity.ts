/**
 * File Name: identity.ts
 * Purpose: The extension as a site identity provider on the kernel's seam:
 *          it verifies a site token (signature, workspace, live session),
 *          answers the user directory (profile read and write), names the
 *          roles, and signs tokens for site code that asks. Core's
 *          `requireAuth`, `auth: 'user'` custom routes and the realtime
 *          ticket ask nothing else.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq } from 'drizzle-orm'
import { RouteError, SiteIdentityError, type ExtensionServerCtx, type SiteIdentityProvider, type SiteUser } from '@tangen/cms'
import { authUsers } from './tables'
import { dbOf, profileFieldsOf, rolesOf } from './context'
import { signSiteToken, verifySiteToken } from './jwt'
import { sessionIsActive } from './sessions'
import { readProfileValues, validateProfileFields, writeProfileValues } from './profile'
import { loadUserById, siteUserOf } from './users'

export const SITE_IDENTITY_ID = 'tangen'

/** The user a verified token describes, without touching the database. */
export function siteUserFromClaims(payload: Record<string, unknown>, workspaceId: string): SiteUser {
  return {
    id: String(payload.sub),
    workspaceId,
    email: (payload.email as string | null | undefined) ?? null,
    name: null,
    role: (payload.role as string | undefined) ?? 'user',
    status: 'active',
    isAnonymous: (payload.isAnonymous as boolean | undefined) ?? false,
    createdAt: '',
    lastLoginAt: null,
    profileMeta: (payload.profileMeta as Record<string, unknown> | null | undefined) ?? {},
  }
}

export function siteIdentityOf(ctx: ExtensionServerCtx): SiteIdentityProvider {
  const { workspaceId } = ctx
  return {
    id: SITE_IDENTITY_ID,
    roles: rolesOf(ctx),

    async authenticate({ token }) {
      if (!token) return null
      const payload = await verifySiteToken(ctx, token)
      if (!payload) throw new SiteIdentityError('invalid_token')
      if (payload.workspaceId !== workspaceId) throw new SiteIdentityError('wrong_workspace')
      const sub = typeof payload.sub === 'string' ? payload.sub : ''
      if (!sub) throw new SiteIdentityError('invalid_token')
      const sessionId = payload.sessionId
      if (typeof sessionId === 'string' && sessionId && !(await sessionIsActive(ctx, sessionId))) throw new SiteIdentityError('revoked')
      return siteUserFromClaims(payload, workspaceId)
    },

    sign: (payload, ttl) => signSiteToken(ctx, payload, ttl),

    users: {
      async get(userId) {
        const row = await loadUserById(ctx, userId)
        const fields = profileFieldsOf(ctx)
        const profileMeta = fields.length ? await readProfileValues(dbOf(ctx), userId, workspaceId, fields) : {}
        if (!row) {
          // The route contract read `{ name, profileMeta }` for any id, present or not; keep the shape and let the caller decide.
          return { id: userId, workspaceId, email: null, name: null, role: 'user', status: 'active', isAnonymous: false, createdAt: '', lastLoginAt: null, profileMeta, missing: true }
        }
        return siteUserOf(row, workspaceId, { profileMeta })
      },

      async update(userId, data) {
        const { name, profileMeta = {} } = data
        const fields = profileFieldsOf(ctx)
        if (Object.keys(profileMeta).length > 0 && fields.length > 0) {
          const errors = validateProfileFields(fields, profileMeta)
          if (errors.length > 0) {
            throw new RouteError(422, 'Validation failed', { fieldErrors: Object.fromEntries(errors.map((e) => [e.field, e.message])) })
          }
          await writeProfileValues(dbOf(ctx), userId, workspaceId, fields, profileMeta)
        }
        if (name !== undefined) {
          await dbOf(ctx).update(authUsers).set({ name: name?.trim() || null }).where(and(eq(authUsers.id, userId), eq(authUsers.workspaceId, workspaceId)))
        }
      },
    },
  }
}
