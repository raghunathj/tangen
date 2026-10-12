/**
 * File Name: manage.ts
 * Purpose: CRUD routes for workspace member management — lists members, invites
 *   new members with a hashed temporary password, updates roles, and removes
 *   members. Exports shared auth-guard helpers used by other member routes.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, Node.js crypto,
 *   Bun.password for bcrypt hashing
 */
import { Elysia } from 'elysia'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { members, roles } from '@tangen/db'
import type { MemberRole } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { memberSuspensionKey, resolveMemberPermissions, invalidateMemberPermissions } from '../../middleware/auth'
import { requireOwnerOrCapability, requireAnyCapability, hasCapability } from '../../lib/member-access'

const VALID_INVITE_ROLES: MemberRole[] = ['admin', 'editor', 'viewer']

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export interface InvitePayload {
  email: string
  name: string | null
  role: MemberRole
  temporaryPassword: string
}

/**
 * Validates and normalises the invite request body.
 * Generates a cryptographically random temporary password when the caller
 * does not supply one.
 * @param body - Raw request body with email, optional name, role, and temporaryPassword
 * @returns A validated InvitePayload ready for database insertion
 */
export function buildInvitePayload(body: unknown): InvitePayload {
  const b = body as Record<string, unknown>
  const email = (b?.email as string | undefined)?.trim()
  const name = (b?.name as string | undefined)?.trim() ?? null
  const role = b?.role as string | undefined
  const suppliedPassword = b?.temporaryPassword as string | undefined

  if (!email) throw new RequestError('VALIDATION_ERROR', 'email is required', 422)
  if (!role) throw new RequestError('VALIDATION_ERROR', 'role is required', 422)
  // Built-in invite roles, or a custom-role slug (existence checked in the
  // route against the workspace's roles table). Never owner/superadmin.
  const slugShaped = /^[a-z0-9][a-z0-9_-]*$/.test(role)
  if (!VALID_INVITE_ROLES.includes(role as MemberRole) && (!slugShaped || role === 'owner' || role === 'superadmin')) {
    throw new RequestError(
      'VALIDATION_ERROR',
      `role must be one of ${VALID_INVITE_ROLES.join(', ')} or a custom role slug`,
      422,
    )
  }

  const temporaryPassword = suppliedPassword ?? randomBytes(12).toString('base64url')

  return { email, name, role: role as MemberRole, temporaryPassword }
}

/**
 * Throws a 403 FORBIDDEN error when the request does not carry a member JWT.
 * @param memberId - Resolved member ID from context, or null for anonymous
 */
export function assertMemberJwt(memberId: string | null): void {
  if (!memberId) {
    throw new RequestError('FORBIDDEN', 'This endpoint requires member authentication', 403)
  }
}

/**
 * Throws a 403 FORBIDDEN error when the caller is not a workspace owner.
 * @param memberRole - Role string resolved from the member's JWT, or null
 */
export function assertOwner(memberRole: string | null): void {
  if (memberRole !== 'owner') {
    throw new RequestError('FORBIDDEN', 'Only workspace owners can perform this action', 403)
  }
}

/**
 * Throws a 400 BAD_REQUEST error when the caller attempts to act on their own
 * account (e.g. changing their own role or deleting themselves).
 * @param callerId - Member ID of the authenticated caller
 * @param targetId - Member ID of the resource being modified
 */
export function assertNotSelf(callerId: string, targetId: string): void {
  if (callerId === targetId) {
    throw new RequestError('BAD_REQUEST', 'You cannot perform this action on your own account', 400)
  }
}

/**
 * Maps a raw members table row to a safe public DTO, omitting passwordHash.
 * @param m - Raw member row from the database
 * @returns Public-safe member object
 */
function toMemberDto(m: any) {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    email: m.email,
    name: m.name,
    role: m.role,
    status: m.status ?? 'active',
    createdAt: m.createdAt,
    lastLoginAt: m.lastLoginAt,
  }
}


/**
 * Validates a member status change. Owners cannot suspend themselves, and the
 * last active owner of a workspace can never be suspended (lockout guard).
 */
export function assertCanChangeStatus(opts: {
  callerId: string
  target: { id: string; role: string; status?: string }
  nextStatus: string
  activeOwnerCount: number
}): void {
  if (!['active', 'suspended'].includes(opts.nextStatus)) {
    throw new RequestError('VALIDATION_ERROR', 'status must be active or suspended', 422)
  }
  if (opts.nextStatus === 'suspended') {
    if (opts.callerId === opts.target.id) {
      throw new RequestError('BAD_REQUEST', 'You cannot suspend your own account', 400)
    }
    if (opts.target.role === 'owner' && opts.activeOwnerCount <= 1) {
      throw new RequestError('BAD_REQUEST', 'Cannot suspend the last active owner', 400)
    }
  }
}

/**
 * Validates a role value being assigned to a member (invite or role change):
 * built-in assignables, or an existing custom-role slug. `owner` may only be
 * granted by an owner; `superadmin` is never assignable through the API.
 */
export async function validateAssignableRole(
  db: any,
  workspaceId: string,
  role: string,
  opts: { callerRole?: string | null; codeRoleSlugs?: string[] } = {},
): Promise<void> {
  if (role === 'superadmin') {
    throw new RequestError('VALIDATION_ERROR', 'superadmin cannot be assigned', 422)
  }
  if (role === 'owner') {
    if (opts.callerRole !== 'owner') {
      throw new RequestError('FORBIDDEN', 'Only workspace owners can grant the owner role', 403)
    }
    return
  }
  if (VALID_INVITE_ROLES.includes(role as MemberRole)) return
  if (opts.codeRoleSlugs?.includes(role)) return
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(role)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid role "${role}"`, 422)
  }
  const [roleRow] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.slug, role)))
    .limit(1)
  if (!roleRow) throw new RequestError('VALIDATION_ERROR', `Unknown role "${role}"`, 422)
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * Registers GET /api/v1/members, POST /api/v1/members/invite,
 * PATCH /api/v1/members/:id, and DELETE /api/v1/members/:id.
 * All routes require member authentication; invite/patch/delete additionally
 * require the owner role. Members cannot act on their own account via
 * patch or delete.
 * @param app - Elysia application instance
 * @returns The mutated Elysia app with member management routes registered
 */
export const memberRoutes = (app: Elysia) =>
  app
    .patch('/api/v1/members/:id/status', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, memberRole, params, body } = ctx
      assertMemberJwt(memberId)
      requireOwnerOrCapability({ permissions: ctx.permissions, memberId, memberRole }, 'manage:members')

      const nextStatus = (body as any)?.status as string
      const [target] = await db
        .select()
        .from(members)
        .where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId)))
        .limit(1)
      if (!target) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      const owners = await db
        .select()
        .from(members)
        .where(and(eq(members.workspaceId, workspaceId), eq(members.role, 'owner'), eq(members.status, 'active')))
      if (target.role === 'owner' && memberRole !== 'owner') {
        throw new RequestError('FORBIDDEN', 'Only owners can suspend or reactivate owners', 403)
      }
      assertCanChangeStatus({
        callerId: memberId,
        target: { id: target.id, role: target.role, status: target.status },
        nextStatus,
        activeOwnerCount: owners.length,
      })

      await db.update(members).set({ status: nextStatus }).where(eq(members.id, target.id))
      invalidateMemberPermissions(target.id)

      // Kill-switch: live requests die immediately, not at JWT expiry
      if (redis) {
        try {
          if (nextStatus === 'suspended') {
            await redis.set(memberSuspensionKey(target.id), '1', 'EX', 60 * 60 * 24 * 31)
          } else {
            await redis.del(memberSuspensionKey(target.id))
          }
        } catch { /* redis outage - login/refresh still enforce */ }
      }

      return { id: target.id, status: nextStatus }
    })

    // Lightweight name directory for ANY member session - pickers and history
    // views (e.g. the review workflow's assignee/actor rendering) need id ->
    // display name without the manage:members grant. Names and emails are not
    // secrets within a workspace team; roles/status/credentials stay behind
    // the managed route below.
    .get('/api/v1/members/directory', async (ctx: any) => {
      const { db, redis, workspaceId, memberId, workspaceProjects } = ctx
      assertMemberJwt(memberId)
      const rows = await db
        .select({ id: members.id, name: members.name, email: members.email, role: members.role })
        .from(members)
        .where(eq(members.workspaceId, workspaceId))

      // ?capability=<cap> keeps only members whose EFFECTIVE role in this env
      // holds the capability (admin roles pass; env overrides + code roles +
      // extension implications respected) - e.g. a review assignee picker
      // listing eligible approvers only.
      const capability = typeof ctx.query?.capability === 'string' && ctx.query.capability ? ctx.query.capability : null
      // ?roles=a,b keeps only members whose EFFECTIVE role is one of them -
      // e.g. a review stage restricted to `legal` offering only legal
      // reviewers as assignees. Filters by ORG STRUCTURE where ?capability
      // filters by permission; both resolve the same env-effective role.
      const roleFilter = typeof ctx.query?.roles === 'string' && ctx.query.roles
        ? ctx.query.roles.split(',').map((r: string) => r.trim()).filter(Boolean)
        : null
      let list = rows as Array<{ id: string; name: string | null; email: string; role: string }>
      if (capability || roleFilter) {
        const project = (workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
        const kept: typeof list = []
        for (const m of list) {
          const effectiveRole = m.role
          if (effectiveRole === 'none') continue
          if (roleFilter && !roleFilter.includes(effectiveRole)) continue
          if (capability) {
            const perms = await resolveMemberPermissions(db, redis, workspaceId, effectiveRole, project, m.id)
            if (!hasCapability({ permissions: perms as never, memberId: m.id, memberRole: effectiveRole }, capability as never)) continue
          }
          kept.push(m)
        }
        list = kept
      }
      return { data: list.map((m) => ({ id: m.id, name: m.name ?? null, email: m.email })) }
    })

    .get('/api/v1/members', async (ctx: any) => {
      const { db, workspaceId, memberId } = ctx
      assertMemberJwt(memberId)
      requireAnyCapability({ permissions: ctx.permissions, memberId, memberRole: ctx.memberRole }, ['manage:members', 'manage:roles'])

      const rows = await db
        .select()
        .from(members)
        .where(eq(members.workspaceId, workspaceId))

      return { data: rows.map((m: any) => toMemberDto(m)) }
    })

    .post('/api/v1/members/invite', async (ctx: any) => {
      const { body, db, workspaceId, memberId, set } = ctx
      assertMemberJwt(memberId)
      requireOwnerOrCapability({ permissions: ctx.permissions, memberId, memberRole: ctx.memberRole }, 'manage:members')

      const payload = buildInvitePayload(body)
      await validateAssignableRole(db, workspaceId, payload.role, {
        callerRole: ctx.memberRole,
        codeRoleSlugs: ((ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)?.roles ?? []).map((r: any) => r.slug),
      })
      const passwordHash = await Bun.password.hash(payload.temporaryPassword)
      const id = `mem_${randomBytes(6).toString('hex')}`

      await db.insert(members).values({
        id,
        workspaceId,
        email: payload.email,
        name: payload.name,
        passwordHash,
        role: payload.role,
      })
      // Environment membership (plan D3): active everywhere the workspace is today.

      ctx.eventBus?.emit({
        id: randomUUID(), type: 'member.created', workspaceId, timestamp: new Date().toISOString(), actorId: memberId, actorType: 'member', source: 'admin',
        payload: { memberId: id, email: payload.email, role: payload.role },
      })

      set.status = 201
      return {
        id,
        workspaceId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        temporaryPassword: payload.temporaryPassword,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      }
    })

    .patch('/api/v1/members/:id', async (ctx: any) => {
      const { body, db, workspaceId, memberId, memberRole, params } = ctx
      assertMemberJwt(memberId)
      requireOwnerOrCapability({ permissions: ctx.permissions, memberId, memberRole }, 'manage:members')
      assertNotSelf(memberId, params.id)

      const { role } = body as { role: string }
      if (!role) throw new RequestError('VALIDATION_ERROR', 'role is required', 422)
      await validateAssignableRole(db, workspaceId, role, {
        callerRole: memberRole,
        codeRoleSlugs: ((ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)?.roles ?? []).map((r: any) => r.slug),
      })

      // Delegated managers cannot modify owners
      if (memberRole !== 'owner') {
        const [target] = await db.select().from(members)
          .where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId))).limit(1)
        if (target?.role === 'owner') {
          throw new RequestError('FORBIDDEN', 'Only owners can modify other owners', 403)
        }
      }

      await db
        .update(members)
        .set({ role })
        .where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId)))
      invalidateMemberPermissions(params.id)

      ctx.eventBus?.emit({
        id: randomUUID(), type: 'member.updated', workspaceId, timestamp: new Date().toISOString(), actorId: memberId, actorType: 'member', source: 'admin',
        payload: { memberId: params.id, role, changed: ['role'] },
      })

      return { id: params.id, role }
    })

    .delete('/api/v1/members/:id', async (ctx: any) => {
      const { db, workspaceId, memberId, memberRole, params, set } = ctx
      assertMemberJwt(memberId)
      requireOwnerOrCapability({ permissions: ctx.permissions, memberId, memberRole }, 'manage:members')
      if (memberRole !== 'owner') {
        const [target] = await db.select().from(members)
          .where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId))).limit(1)
        if (target?.role === 'owner') {
          throw new RequestError('FORBIDDEN', 'Only owners can remove owners', 403)
        }
      }
      assertNotSelf(memberId, params.id)

      await db
        .delete(members)
        .where(and(eq(members.id, params.id), eq(members.workspaceId, workspaceId)))

      set.status = 204
      return null
    })
