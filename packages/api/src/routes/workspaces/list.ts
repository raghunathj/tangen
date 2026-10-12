/**
 * File Name: list.ts
 * Purpose: Workspace list, create, and switch routes for admin members — lists accessible
 *          workspaces (all for superadmin), creates new ones, and issues a scoped JWT on switch.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; workspace switch re-signs the JWT for the target
 *   workspace; superadmins can switch to any workspace without holding membership.
 */
import { Elysia } from 'elysia'
import { eq, and, inArray, count, max } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'
import { workspaces, members, refreshTokens } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { isSuperAdmin } from '../../lib/workspace-boundary'
import { getJwtKey } from '../../lib/jwt-secret'
import { buildRefreshCookie } from '../../lib/refresh-cookie'

const ACCESS_TOKEN_TTL = 15 * 60

function toWorkspaceDto(w: any, memberCount?: number, lastActivity?: string | null) {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    createdAt: w.createdAt,
    memberCount: memberCount ?? null,
    lastActivity: lastActivity ?? null,
  }
}

/**
 * Registers workspace list (GET), create (POST), and switch (POST /switch) routes.
 * @param app - The Elysia application instance to attach the routes to.
 * @returns The Elysia app with all workspace routes mounted.
 */
export const workspacesRoute = (app: Elysia) =>
  app
    // List all workspaces the authenticated member has access to (matched by email)
    // Superadmin members see all workspaces in the system.
    .get('/api/v1/workspaces', async (ctx: any) => {
      const { db, memberId, memberRole } = ctx

      const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1)
      if (!member) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      let wsRows: any[]
      if (isSuperAdmin(memberRole)) {
        wsRows = await db.select().from(workspaces)
      } else {
        const memberRows = await db
          .select({ workspaceId: members.workspaceId })
          .from(members)
          .where(eq(members.email, member.email))

        const wsIds = memberRows.map((r: any) => r.workspaceId as string)
        if (wsIds.length === 0) return { data: [] }

        wsRows = await db
          .select()
          .from(workspaces)
          .where(inArray(workspaces.id, wsIds))
      }

      // Fetch member count and last login per workspace
      const wsIds = wsRows.map((w: any) => w.id)
      const statsRows: { workspaceId: string; memberCount: number; lastActivity: Date | null }[] =
        wsIds.length > 0
          ? await db
              .select({
                workspaceId: members.workspaceId,
                memberCount: count(members.id),
                lastActivity: max(members.lastLoginAt),
              })
              .from(members)
              .where(inArray(members.workspaceId, wsIds))
              .groupBy(members.workspaceId)
          : []

      const statsMap = new Map(statsRows.map((r) => [r.workspaceId, r]))

      return {
        data: wsRows.map((w: any) => {
          const s = statsMap.get(w.id)
          return toWorkspaceDto(
            w,
            s?.memberCount ?? 0,
            s?.lastActivity ? (s.lastActivity as Date).toISOString() : null,
          )
        }),
      }
    })

    // Create a new workspace and add the creator as owner
    .post('/api/v1/workspaces', async (ctx: any) => {
      const { body, db, memberId, set } = ctx
      const b = body as Record<string, unknown>
      const name = (b.name as string | undefined)?.trim()
      const slug = (b.slug as string | undefined)?.trim()

      if (!name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
      if (!slug) throw new RequestError('VALIDATION_ERROR', 'slug is required', 422)
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new RequestError('VALIDATION_ERROR', 'slug must be lowercase alphanumeric with hyphens', 422)
      }

      const id = `wsp_${slug.replace(/-/g, '_')}`

      const [currentMember] = await db.select().from(members).where(eq(members.id, memberId)).limit(1)
      if (!currentMember) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      await db.insert(workspaces).values({ id, name, slug }).onConflictDoNothing()

      const newMemberId = `mem_${randomBytes(6).toString('hex')}`
      await db.insert(members).values({
        id: newMemberId,
        workspaceId: id,
        email: currentMember.email,
        name: currentMember.name,
        passwordHash: currentMember.passwordHash,
        role: 'owner',
      }).onConflictDoNothing()

      set.status = 201
      return { id, name, slug }
    })

    // Switch workspace — verifies membership then issues a new JWT for the target workspace.
    // Superadmin members can switch to any workspace without being a member.
    .post('/api/v1/workspaces/switch', async (ctx: any) => {
      const { body, db, memberId, memberRole } = ctx
      const { workspaceId } = body as { workspaceId: string }

      if (!workspaceId) throw new RequestError('VALIDATION_ERROR', 'workspaceId is required', 422)

      const [currentMember] = await db.select().from(members).where(eq(members.id, memberId)).limit(1)
      if (!currentMember) throw new RequestError('NOT_FOUND', 'Member not found', 404)

      let targetWorkspaceId: string
      let targetRole: string
      let targetMemberId: string
      let targetEmail: string

      if (isSuperAdmin(memberRole)) {
        const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
        if (!ws) throw new RequestError('NOT_FOUND', 'Workspace not found', 404)
        targetWorkspaceId = workspaceId
        targetRole = 'superadmin'
        targetMemberId = currentMember.id
        targetEmail = currentMember.email
      } else {
        const [targetMember] = await db
          .select()
          .from(members)
          .where(and(eq(members.workspaceId, workspaceId), eq(members.email, currentMember.email)))
          .limit(1)

        if (!targetMember) throw new RequestError('FORBIDDEN', 'No access to this workspace', 403)

        targetWorkspaceId = targetMember.workspaceId
        targetRole = targetMember.role
        targetMemberId = targetMember.id
        targetEmail = targetMember.email
      }

      const accessToken = await new SignJWT({
        workspaceId: targetWorkspaceId,
        role: targetRole,
        email: targetEmail,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(targetMemberId)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
        .sign(getJwtKey())

      // Issue a new refresh token for the target workspace so that expiry-driven
      // token refreshes stay scoped to the correct workspace.
      const REFRESH_TTL_DAYS = 30
      const rawRefresh = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(rawRefresh).digest('hex')
      const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
      const refreshId = `rt_${randomBytes(8).toString('hex')}`
      await db.insert(refreshTokens).values({ id: refreshId, memberId: targetMemberId, tokenHash, expiresAt })

      ctx.set.headers['Set-Cookie'] = buildRefreshCookie(rawRefresh, REFRESH_TTL_DAYS)

      return {
        accessToken,
        member: {
          memberId: targetMemberId,
          workspaceId: targetWorkspaceId,
          role: targetRole,
          email: targetEmail,
        },
      }
    })
