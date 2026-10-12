/**
 * File Name: admin.ts
 * Purpose: Superadmin-gated routes for workspace management — fetch, rename (PATCH name/slug),
 *          and soft-delete a workspace by setting its deletedAt timestamp.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; owners/admins may patch their own workspace;
 *   only superadmins can delete or access arbitrary workspaces.
 */
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { workspaces } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { isSuperAdmin } from '../../lib/workspace-boundary'

function assertSuperAdmin(memberRole: string | null): void {
  if (!isSuperAdmin(memberRole)) {
    throw new RequestError('FORBIDDEN', 'Only superadmin members can perform this action', 403)
  }
}

export interface WorkspacePatch {
  name?: string
  slug?: string
}

/**
 * Validates and extracts name and/or slug from a workspace PATCH request body.
 * @param body - Raw request body; at least one of name or slug must be present.
 * @returns A WorkspacePatch containing only the fields the caller supplied.
 */
export function buildWorkspacePatch(body: unknown): WorkspacePatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object', 422)
  }
  const b = body as Record<string, unknown>
  const patch: WorkspacePatch = {}

  if (b.name !== undefined) {
    const name = (b.name as string)?.trim()
    if (!name) throw new RequestError('VALIDATION_ERROR', 'name cannot be empty', 422)
    patch.name = name
  }

  if (b.slug !== undefined) {
    const slug = (b.slug as string)?.trim()
    if (!slug) throw new RequestError('VALIDATION_ERROR', 'slug cannot be empty', 422)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new RequestError('VALIDATION_ERROR', 'slug must be lowercase alphanumeric with hyphens', 422)
    }
    patch.slug = slug
  }

  if (!patch.name && !patch.slug) {
    throw new RequestError('VALIDATION_ERROR', 'Provide at least one of name or slug', 422)
  }

  return patch
}

/**
 * Registers GET, PATCH, and DELETE routes for /api/v1/admin/workspaces/:workspaceId.
 * @param app - The Elysia application instance to attach the routes to.
 * @returns The Elysia app with all workspace admin routes mounted.
 */
export const workspaceAdminRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/workspaces/:workspaceId', async (ctx: any) => {
      const { db, memberRole, params, workspaceId: callerWsId } = ctx
      const wsId = params.workspaceId as string
      // Superadmins can fetch any workspace; regular members can only fetch their own
      if (!isSuperAdmin(memberRole) && wsId !== callerWsId) {
        throw new RequestError('FORBIDDEN', 'Access denied', 403)
      }
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1)
      if (!ws) throw new RequestError('NOT_FOUND', 'Workspace not found', 404)
      return { data: { id: ws.id, name: ws.name, slug: ws.slug } }
    })

    .patch('/api/v1/admin/workspaces/:workspaceId', async (ctx: any) => {
      const { body, db, memberRole, params, workspaceId: callerWsId } = ctx
      const wsId = params.workspaceId as string
      // Superadmins can patch any workspace; owners can only patch their own
      if (!isSuperAdmin(memberRole)) {
        if (wsId !== callerWsId) throw new RequestError('FORBIDDEN', 'Access denied', 403)
        requireCapability({ permissions: ctx.permissions, memberId: ctx.memberId }, 'manage:settings')
      }

      const patch = buildWorkspacePatch(body)

      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1)
      if (!ws) throw new RequestError('NOT_FOUND', 'Workspace not found', 404)

      const updates: Record<string, unknown> = {}
      if (patch.name) updates.name = patch.name
      if (patch.slug) updates.slug = patch.slug

      await db.update(workspaces).set(updates).where(eq(workspaces.id, wsId))

      return { id: wsId, ...patch }
    })

    .delete('/api/v1/admin/workspaces/:workspaceId', async (ctx: any) => {
      const { db, memberRole, params, set } = ctx
      assertSuperAdmin(memberRole)

      const wsId = params.workspaceId as string
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1)
      if (!ws) throw new RequestError('NOT_FOUND', 'Workspace not found', 404)

      // Soft-delete: mark as deletedAt
      await db
        .update(workspaces)
        .set({ deletedAt: new Date() })
        .where(eq(workspaces.id, wsId))

      set.status = 204
      return null
    })
