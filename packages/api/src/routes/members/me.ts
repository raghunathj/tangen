/**
 * File Name: me.ts
 * Purpose: GET /api/v1/me/permissions — the admin UI's single source of truth
 *          for what the current member may do: effective role (env override
 *          applied), resolved permission bundle, capabilities, and status.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: the auth middleware already resolves the effective
 *          role and permission bundle per request — this endpoint mostly
 *          echoes them, adding the member's status from the DB.
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { members } from '@tangen/db'
import type { Capability, MemberPermissions, MemberGrants, SourcedCapability } from '@tangen/types'
import { capabilitySources } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { expandCapabilities } from '../../lib/member-access'
import { resolveMemberPermissions, resolveMemberGrants, activeMemberGrants } from '../../middleware/auth'

export interface MePermissionsResponse {
  memberId: string
  /** Workspace-level role from the JWT. */
  role: string
  /** Role after the env override — what actually applies to this request. */
  effectiveRole: string
  status: 'active' | 'suspended'
  /** Resolved permission bundle ({ admin: true } for owner/admin). */
  permissions: MemberPermissions | { admin: true }
  capabilities: Capability[] | 'all'
  /** The member's own active grants (extras on top of the role), or null. */
  grants: MemberGrants | null
  /** Each effective capability tagged role vs grant; 'all' for owner/admin. */
  capabilitySources: SourcedCapability[] | 'all'
}

/** Shapes the middleware context into the response payload. */
export function buildMePermissions(ctx: {
  memberId: string
  memberRole: string
  jwtRole?: string
  permissions: MemberPermissions | { admin: true }
  status: string
  /** The role's own capabilities (no grants) - for provenance tagging. */
  roleCapabilities?: Capability[]
  /** The member's active grants (already expiry-filtered). */
  grants?: MemberGrants | undefined
}): MePermissionsResponse {
  const p = ctx.permissions as MemberPermissions & { admin?: boolean }
  const grants = ctx.grants ?? null
  return {
    memberId: ctx.memberId,
    role: ctx.jwtRole ?? ctx.memberRole,
    effectiveRole: ctx.memberRole,
    status: (ctx.status === 'suspended' ? 'suspended' : 'active'),
    permissions: ctx.permissions,
    // Expanded with implications (core + installed extension manifests) so
    // capability-gated chrome lights up for holders of a broader grant.
    capabilities: p.admin === true ? 'all' : expandCapabilities(p.capabilities ?? []),
    grants,
    capabilitySources: p.admin === true
      ? 'all'
      : capabilitySources(expandCapabilities(ctx.roleCapabilities ?? []), grants?.capabilities ?? []),
  }
}

export const mePermissionsRoute = (app: Elysia) =>
  app.get('/api/v1/me/permissions', async (ctx: any) => {
    const { db, redis, workspaceId, memberId, memberRole, permissions } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Member session required', 403)

    const [row] = await db
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1)

    // The role's own bundle (no grants) and the member's active grants, so the
    // payload can say which capabilities come from the role vs a grant.
    const roleBundle = await resolveMemberPermissions(db, redis, workspaceId, memberRole) as MemberPermissions & { admin?: boolean }
    const grants = activeMemberGrants(await resolveMemberGrants(db, redis, workspaceId, memberId))

    return {
      data: buildMePermissions({
        memberId,
        memberRole,
        permissions,
        status: row?.status ?? 'active',
        roleCapabilities: roleBundle.admin ? [] : (roleBundle.capabilities ?? []),
        grants,
      }),
    }
  })
