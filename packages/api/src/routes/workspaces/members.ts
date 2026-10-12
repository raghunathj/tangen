/**
 * File Name: members.ts
 * Purpose: Superadmin-only routes to invite (POST) and remove (DELETE) members from a
 *          specific workspace; a hashed temporary password is generated if none is supplied.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; password hashing uses Bun.password.hash;
 *   invite uses onConflictDoNothing so a duplicate email is silently ignored.
 */
import { Elysia } from 'elysia'
import { randomBytes } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { members, workspaces } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { isSuperAdmin } from '../../lib/workspace-boundary'

const VALID_MEMBER_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const

function assertSuperAdmin(memberRole: string | null): void {
  if (!isSuperAdmin(memberRole)) {
    throw new RequestError('FORBIDDEN', 'Only superadmin members can perform this action', 403)
  }
}

export interface WorkspaceMemberInvite {
  email: string
  role: string
  name: string | null
  temporaryPassword: string
}

/**
 * Validates and constructs a member invite payload from a POST request body.
 * @param body - Raw request body with email, role, optional name, and optional temporaryPassword.
 * @returns A WorkspaceMemberInvite with a password (generated if not supplied).
 */
export function buildWorkspaceMemberInvite(body: unknown): WorkspaceMemberInvite {
  const b = body as Record<string, unknown>
  const email = (b?.email as string | undefined)?.trim()
  const role = b?.role as string | undefined
  const name = (b?.name as string | undefined)?.trim() ?? null
  const suppliedPassword = b?.temporaryPassword as string | undefined

  if (!email) throw new RequestError('VALIDATION_ERROR', 'email is required', 422)
  if (!role || !(VALID_MEMBER_ROLES as readonly string[]).includes(role)) {
    throw new RequestError(
      'VALIDATION_ERROR',
      `role must be one of: ${VALID_MEMBER_ROLES.join(', ')}`,
      422,
    )
  }

  return {
    email,
    role,
    name,
    temporaryPassword: suppliedPassword ?? randomBytes(12).toString('base64url'),
  }
}

/**
 * Registers POST (invite) and DELETE (remove) member routes for a workspace.
 * @param app - The Elysia application instance to attach the routes to.
 * @returns The Elysia app with both workspace member management routes mounted.
 */
export const workspaceMemberRoutes = (app: Elysia) =>
  app
    .post('/api/v1/admin/workspaces/:workspaceId/members', async (ctx: any) => {
      const { body, db, memberRole, params, set } = ctx
      assertSuperAdmin(memberRole)

      const wsId = params.workspaceId as string
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1)
      if (!ws) throw new RequestError('NOT_FOUND', 'Workspace not found', 404)

      const payload = buildWorkspaceMemberInvite(body)
      const passwordHash = await Bun.password.hash(payload.temporaryPassword)
      const id = `mem_${randomBytes(6).toString('hex')}`

      await db.insert(members).values({
        id,
        workspaceId: wsId,
        email: payload.email,
        name: payload.name,
        passwordHash,
        role: payload.role,
      }).onConflictDoNothing()
      // Environment membership (plan D3): active everywhere the workspace is today.

      set.status = 201
      return {
        id,
        workspaceId: wsId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        temporaryPassword: payload.temporaryPassword,
      }
    })

    .delete('/api/v1/admin/workspaces/:workspaceId/members/:memberId', async (ctx: any) => {
      const { db, memberRole, params, set } = ctx
      assertSuperAdmin(memberRole)

      const wsId = params.workspaceId as string
      const memberId = params.memberId as string

      const [member] = await db
        .select()
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.workspaceId, wsId)))
        .limit(1)

      if (!member) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      await db
        .delete(members)
        .where(and(eq(members.id, memberId), eq(members.workspaceId, wsId)))

      set.status = 204
      return null
    })
