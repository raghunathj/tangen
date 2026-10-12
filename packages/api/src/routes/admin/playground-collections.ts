/**
 * File Name: playground-collections.ts
 * Purpose: PG-3 — API Playground collections + variables. Collections are
 *          private by default; flipping visibility to 'shared' exposes them to
 *          exactly the members who clear the playground's own RBAC gate
 *          (owner/admin) — never wider. Only the creator edits/deletes;
 *          others run or duplicate. Variables are per member per env; their
 *          values are interpolated client-side at send and never appear in
 *          saved requests.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { randomBytes } from 'node:crypto'
import { eq, and, or } from 'drizzle-orm'
import { playgroundCollections, playgroundVariables } from '@tangen/db'
import { RequestError } from '../../lib/errors'

function requireAdminRole(ctx: any): void {
  if (!ctx.memberId) throw new RequestError('FORBIDDEN', 'Admin session required', 403)
  const role = String(ctx.memberRole ?? '')
  if (role !== 'owner' && role !== 'admin' && role !== 'superadmin') {
    throw new RequestError('FORBIDDEN', 'The API Playground is available to owners and admins only', 403)
  }
}

const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`

export interface SavedRequest {
  id: string
  name: string
  request: Record<string, unknown>
}

/** Owner-only mutations — shared collections are read-only to everyone else. */
export function assertCollectionOwner(row: { createdBy: string } | undefined, memberId: string): asserts row is { createdBy: string } {
  if (!row) throw new RequestError('NOT_FOUND', 'Collection not found', 404)
  if (row.createdBy !== memberId) {
    throw new RequestError('FORBIDDEN', 'Only the collection owner can change it - duplicate it to your collections instead', 403)
  }
}

export const playgroundCollectionRoutes = (app: Elysia) =>
  app

    // Mine + shared (shared = visible to every playground-RBAC member)
    .get('/api/v1/admin/playground/collections', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId } = ctx
      const rows = await db
        .select()
        .from(playgroundCollections)
        .where(and(
          eq(playgroundCollections.workspaceId, workspaceId),
          or(eq(playgroundCollections.createdBy, memberId), eq(playgroundCollections.visibility, 'shared')),
        ))
      return { data: rows }
    })

    .post('/api/v1/admin/playground/collections', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId, body } = ctx
      const name = String(body?.name ?? '').trim()
      if (!name) throw new RequestError('VALIDATION_ERROR', 'Collection name is required', 422)
      const [row] = await db.insert(playgroundCollections).values({
        id: newId('pgc'), workspaceId, name,
        requests: Array.isArray(body?.requests) ? body.requests : [],
        visibility: 'private', createdBy: memberId,
      }).returning()
      return { data: row }
    })

    // Rename / share / replace requests — owner only
    .patch('/api/v1/admin/playground/collections/:id', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId, body } = ctx
      const [row] = await db.select().from(playgroundCollections)
        .where(and(eq(playgroundCollections.id, ctx.params.id), eq(playgroundCollections.workspaceId, workspaceId)))
      assertCollectionOwner(row, memberId)
      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
      if (body?.visibility === 'private' || body?.visibility === 'shared') patch.visibility = body.visibility
      if (Array.isArray(body?.requests)) patch.requests = body.requests
      const [updated] = await db.update(playgroundCollections).set(patch)
        .where(eq(playgroundCollections.id, ctx.params.id)).returning()
      return { data: updated }
    })

    .delete('/api/v1/admin/playground/collections/:id', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId } = ctx
      const [row] = await db.select().from(playgroundCollections)
        .where(and(eq(playgroundCollections.id, ctx.params.id), eq(playgroundCollections.workspaceId, workspaceId)))
      assertCollectionOwner(row, memberId)
      await db.delete(playgroundCollections).where(eq(playgroundCollections.id, ctx.params.id))
      return { data: { deleted: true } }
    })

    // ── Variables — one private set per member per env ──────────────────────
    .get('/api/v1/admin/playground/variables', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId } = ctx
      const [row] = await db.select().from(playgroundVariables)
        .where(and(eq(playgroundVariables.workspaceId, workspaceId), eq(playgroundVariables.memberId, memberId)))
      return { data: { vars: row?.vars ?? {} } }
    })

    .put('/api/v1/admin/playground/variables', async (ctx: any) => {
      requireAdminRole(ctx)
      const { db, workspaceId, memberId, body } = ctx
      const vars = body?.vars
      if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
        throw new RequestError('VALIDATION_ERROR', 'vars must be an object of { name: { value, secret? } }', 422)
      }
      await db.insert(playgroundVariables)
        .values({ id: newId('pgv'), workspaceId, memberId, vars, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [playgroundVariables.workspaceId, playgroundVariables.memberId],
          set: { vars, updatedAt: new Date() },
        })
      return { data: { vars } }
    })
