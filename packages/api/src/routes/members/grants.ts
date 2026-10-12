/**
 * File Name: grants.ts
 * Purpose: Admin routes for per-member ADDITIVE grants (extra capabilities and
 *          extension-page access on top of a role) - the server side of the
 *          member Access panel. GET returns a member's role, current grant, and
 *          each effective capability tagged role vs grant; PUT replaces the
 *          member's grant row (the "extras"). Grants live in THIS deployment's
 *          database (environments removed). Gated by manage:members.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The merge/provenance rules are @tangen/types pure
 *          functions; the read/cache live in middleware/auth. Writing a grant
 *          fires invalidateMemberGrants so it applies within the cache window
 *          and across instances (shared redis key + the invalidation seam).
 */
import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { members, memberGrants } from '@tangen/db'
import { capabilitySources, mergeMemberGrants, type MemberPermissions } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { requireOwnerOrCapability, expandCapabilities } from '../../lib/member-access'
import { resolveMemberPermissions, activeMemberGrants, invalidateMemberGrants, type StoredMemberGrant } from '../../middleware/auth'

function assertMemberJwt(memberId: string | undefined): void {
  if (!memberId) throw new RequestError('FORBIDDEN', 'Member session required', 403)
}

/** Normalises a PUT body into a clean grant, or null when it clears everything. */
export function normalizeGrantBody(body: unknown): { capabilities: string[]; extensions: string[]; reason: string | null; expiresAt: string | null } {
  const b = (body ?? {}) as Record<string, unknown>
  const asStrings = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
  const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : null
  let expiresAt: string | null = null
  if (typeof b.expiresAt === 'string' && b.expiresAt) {
    const d = new Date(b.expiresAt)
    if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString()
  }
  return { capabilities: asStrings(b.capabilities), extensions: asStrings(b.extensions), reason, expiresAt }
}

export const memberGrantsRoutes = (app: Elysia) =>
  app
    // The Access panel's read: role, current grant, and sourced capabilities.
    .get('/api/v1/members/:id/access', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, memberRole, params, workspaceProjects } = ctx
      assertMemberJwt(memberId)
      requireOwnerOrCapability({ permissions: ctx.permissions, memberId, memberRole }, 'manage:members')

      const [target] = await db.select({ id: members.id, role: members.role, status: members.status })
        .from(members).where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId))).limit(1)
      if (!target) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      const project = (workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
      const roleBundle = await resolveMemberPermissions(db, redis, workspaceId, target.role, project) as MemberPermissions & { admin?: boolean }

      const [rawRow] = await db.select().from(memberGrants)
        .where(and(eq(memberGrants.workspaceId, workspaceId), eq(memberGrants.memberId, target.id))).limit(1)
      const raw: StoredMemberGrant | null = rawRow ? {
        capabilities: (rawRow.capabilities ?? []) as string[],
        extensions: (rawRow.extensions ?? []) as string[],
        expiresAt: rawRow.expiresAt ? new Date(rawRow.expiresAt).toISOString() : null,
      } : null
      const active = activeMemberGrants(raw)

      const isAdmin = roleBundle.admin === true
      const roleCaps = isAdmin ? [] : expandCapabilities(roleBundle.capabilities ?? [])

      return {
        data: {
          memberId: target.id,
          role: target.role,
          status: target.status,
          /** What the role alone allows (so the UI can lock those rows). */
          roleCapabilities: isAdmin ? 'all' : roleCaps,
          roleExtensions: isAdmin ? 'all' : (roleBundle.extensions ?? 'all'),
          /** The stored grant row (extras), with provenance metadata. */
          grant: rawRow ? {
            capabilities: raw!.capabilities,
            extensions: raw!.extensions,
            grantedBy: rawRow.grantedBy ?? null,
            reason: rawRow.reason ?? null,
            expiresAt: raw!.expiresAt,
            expired: !!raw!.expiresAt && !active,
          } : null,
          /** Every effective capability tagged role vs grant ('all' for owner/admin). */
          capabilities: isAdmin ? 'all' : capabilitySources(roleCaps, active?.capabilities ?? []),
        },
      }
    })

    // Replace a member's grant "extras". Empty capabilities + extensions clears it.
    .put('/api/v1/members/:id/grants', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, memberRole, params, body } = ctx
      assertMemberJwt(memberId)
      requireOwnerOrCapability({ permissions: ctx.permissions, memberId, memberRole }, 'manage:members')

      const [target] = await db.select({ id: members.id })
        .from(members).where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId))).limit(1)
      if (!target) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      const g = normalizeGrantBody(body)
      const now = new Date()
      if (g.capabilities.length === 0 && g.extensions.length === 0) {
        await db.delete(memberGrants).where(and(eq(memberGrants.workspaceId, workspaceId), eq(memberGrants.memberId, target.id)))
      } else {
        await db.insert(memberGrants)
          .values({ workspaceId, memberId: target.id, capabilities: g.capabilities, extensions: g.extensions, grantedBy: memberId, reason: g.reason, expiresAt: g.expiresAt ? new Date(g.expiresAt) : null, updatedAt: now })
          .onConflictDoUpdate({ target: [memberGrants.workspaceId, memberGrants.memberId], set: { capabilities: g.capabilities, extensions: g.extensions, grantedBy: memberId, reason: g.reason, expiresAt: g.expiresAt ? new Date(g.expiresAt) : null, updatedAt: now } })
      }
      invalidateMemberGrants(redis, workspaceId, target.id)
      return { data: { memberId: target.id, capabilities: g.capabilities, extensions: g.extensions, reason: g.reason, expiresAt: g.expiresAt } }
    })
