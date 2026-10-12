/**
 * File Name: manage.ts
 * Purpose: Elysia route plugin providing CRUD endpoints for admin saved views — named filter presets
 *          that members can save as private or share across the workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db savedViews table; write operations require member authentication
 *                     and enforce ownership — members may only edit or delete their own views.
 */
import { Elysia } from 'elysia'
import { randomBytes } from 'node:crypto'
import { eq, and, or } from 'drizzle-orm'
import { savedViews } from '@tangen/db'
import { RequestError } from '../../lib/errors'

/**
 * Elysia plugin providing GET, POST, PATCH, and DELETE endpoints for managing saved admin views.
 * @returns Elysia plugin function
 */
export const savedViewRoutes = (app: Elysia) =>
  app

    .get('/api/v1/saved-views', async (ctx: any) => {
      const { db, workspaceId, memberId } = ctx
      const typeName = ctx.query?.typeName as string | undefined
      if (!typeName) throw new RequestError('VALIDATION_ERROR', 'typeName query param is required', 422)

      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.workspaceId, workspaceId),
            eq(savedViews.typeName, typeName),
            or(
              eq(savedViews.visibility, 'shared'),
              and(
                eq(savedViews.visibility, 'private'),
                eq(savedViews.createdBy, memberId ?? ''),
              ),
            ),
          ),
        )

      return { data: rows }
    })

    .post('/api/v1/saved-views', async (ctx: any) => {
      const { body, db, workspaceId, memberId, set } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Saved views require member authentication', 403)

      const b = body as Record<string, unknown>
      const name = (b.name as string | undefined)?.trim()
      if (!name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
      const typeName = (b.typeName as string | undefined)?.trim()
      if (!typeName) throw new RequestError('VALIDATION_ERROR', 'typeName is required', 422)

      const visibility = b.visibility === 'shared' ? 'shared' : 'private'
      const filters = (b.filters as object) ?? {}

      const id = `sv_${randomBytes(8).toString('hex')}`
      await db.insert(savedViews).values({
        id, workspaceId, typeName, name, filters, visibility, createdBy: memberId,
      })

      const [row] = await db.select().from(savedViews).where(eq(savedViews.id, id))
      set.status = 201
      return row
    })

    .patch('/api/v1/saved-views/:id', async (ctx: any) => {
      const { body, db, workspaceId, memberId, params } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Saved views require member authentication', 403)

      const [existing] = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.id, params.id), eq(savedViews.workspaceId, workspaceId)))

      if (!existing) throw new RequestError('NOT_FOUND', 'Saved view not found', 404)
      if (existing.createdBy !== memberId) {
        throw new RequestError('FORBIDDEN', "Cannot edit another member's view", 403)
      }

      const b = body as Record<string, unknown>
      const update: Record<string, unknown> = { updatedAt: new Date() }
      if (b.name !== undefined) update.name = (b.name as string).trim()
      if (b.visibility !== undefined) update.visibility = b.visibility === 'shared' ? 'shared' : 'private'
      if (b.filters !== undefined) update.filters = b.filters

      await db.update(savedViews).set(update).where(eq(savedViews.id, params.id))
      const [row] = await db.select().from(savedViews).where(eq(savedViews.id, params.id))
      return row
    })

    .delete('/api/v1/saved-views/:id', async (ctx: any) => {
      const { db, workspaceId, memberId, params, set } = ctx
      if (!memberId) throw new RequestError('FORBIDDEN', 'Saved views require member authentication', 403)

      const [existing] = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.id, params.id), eq(savedViews.workspaceId, workspaceId)))

      if (!existing) throw new RequestError('NOT_FOUND', 'Saved view not found', 404)
      if (existing.createdBy !== memberId) {
        throw new RequestError('FORBIDDEN', "Cannot delete another member's view", 403)
      }

      await db.delete(savedViews).where(eq(savedViews.id, params.id))
      set.status = 204
      return null
    })
