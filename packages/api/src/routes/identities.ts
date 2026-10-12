/**
 * File Name: identities.ts
 * Purpose: Service and agent identities, managed by members who manage keys
 *          (framework kernel K8): list, create, edit, suspend and delete.
 *          Deleting an identity revokes its credentials; what it wrote stays
 *          attributed to its id.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { eq, and, isNull } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { identities, apiKeys } from '@tangen/db'
import type { Identity, IdentityKind } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { requireDecision } from '../kernel/policy'
import { actorFromContext } from '../kernel/actor'
import { sanitizeApiKeyPermissions } from '../lib/api-key-permissions'

const KINDS: IdentityKind[] = ['service', 'agent']
const STATUSES = ['active', 'suspended']

function assertManages(ctx: any): void {
  requireDecision(actorFromContext(ctx), { kind: 'capability', capability: 'manage:apiKeys' })
}

function capabilitiesOf(input: unknown): string[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.some((c) => typeof c !== 'string' || !/^[a-z0-9][a-z0-9_-]*:[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(c))) {
    throw new RequestError('VALIDATION', 'capabilities must be a list of capability ids (scope:name)', 400)
  }
  return Array.from(new Set(input as string[]))
}

function nameOf(input: unknown): string {
  const name = typeof input === 'string' ? input.trim() : ''
  if (!name || name.length > 120) throw new RequestError('VALIDATION', 'name is required (at most 120 characters)', 400)
  return name
}

export function serializeIdentity(row: any, keys: any[] = []): Identity & { keys: Array<{ id: string; label: string; keyPrefix: string; revokedAt: string | null; lastUsedAt: string | null }> } {
  return {
    id: row.id, workspaceId: row.workspaceId, kind: row.kind, name: row.name, description: row.description ?? null,
    status: row.status, permissions: sanitizeApiKeyPermissions(row.permissions), capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    ownerId: row.ownerId ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    keys: keys.map((k) => ({ id: k.id, label: k.label, keyPrefix: k.keyPrefix, revokedAt: k.revokedAt ?? null, lastUsedAt: k.lastUsedAt ?? null })),
  }
}

export const identityRoutes = (app: Elysia) =>
  app
    .get('/api/v1/admin/identities', async (ctx: any) => {
      assertManages(ctx)
      const { db, workspaceId } = ctx
      const rows = await db.select().from(identities).where(eq(identities.workspaceId, workspaceId))
      const keys = await db.select().from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId))
      return { data: rows.map((r: any) => serializeIdentity(r, keys.filter((k: any) => k.identityId === r.id))) }
    })
    .post('/api/v1/admin/identities', async (ctx: any) => {
      assertManages(ctx)
      const { db, workspaceId, body, set } = ctx
      const b = (body ?? {}) as Record<string, unknown>
      if (!KINDS.includes(b.kind as IdentityKind)) throw new RequestError('VALIDATION', 'kind must be service or agent', 400)
      const row = {
        id: `idn_${randomBytes(6).toString('hex')}`, workspaceId, kind: b.kind as string, name: nameOf(b.name),
        description: typeof b.description === 'string' ? b.description.trim() || null : null,
        status: 'active', permissions: sanitizeApiKeyPermissions(b.permissions ?? {}), capabilities: capabilitiesOf(b.capabilities),
        ownerId: ctx.memberId ?? null,
      }
      await db.insert(identities).values(row)
      const [saved] = await db.select().from(identities).where(eq(identities.id, row.id)).limit(1)
      set.status = 201
      return { data: serializeIdentity(saved) }
    })
    .patch('/api/v1/admin/identities/:id', async (ctx: any) => {
      assertManages(ctx)
      const { db, workspaceId, body, params } = ctx
      const [row] = await db.select().from(identities).where(and(eq(identities.id, String(params.id)), eq(identities.workspaceId, workspaceId))).limit(1)
      if (!row) throw new RequestError('NOT_FOUND', 'Identity not found', 404)
      const b = (body ?? {}) as Record<string, unknown>
      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if (b.name !== undefined) patch.name = nameOf(b.name)
      if (b.description !== undefined) patch.description = typeof b.description === 'string' ? b.description.trim() || null : null
      if (b.status !== undefined) {
        if (!STATUSES.includes(String(b.status))) throw new RequestError('VALIDATION', 'status must be active or suspended', 400)
        patch.status = b.status
      }
      if (b.permissions !== undefined) patch.permissions = sanitizeApiKeyPermissions(b.permissions ?? {})
      if (b.capabilities !== undefined) patch.capabilities = capabilitiesOf(b.capabilities)
      await db.update(identities).set(patch).where(eq(identities.id, row.id))
      const [saved] = await db.select().from(identities).where(eq(identities.id, row.id)).limit(1)
      const keys = await db.select().from(apiKeys).where(eq(apiKeys.identityId, row.id))
      return { data: serializeIdentity(saved, keys) }
    })
    .delete('/api/v1/admin/identities/:id', async (ctx: any) => {
      assertManages(ctx)
      const { db, workspaceId, params } = ctx
      const [row] = await db.select().from(identities).where(and(eq(identities.id, String(params.id)), eq(identities.workspaceId, workspaceId))).limit(1)
      if (!row) throw new RequestError('NOT_FOUND', 'Identity not found', 404)
      // Its credentials die with it; its attribution stays.
      await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.identityId, row.id), isNull(apiKeys.revokedAt)))
      await db.delete(identities).where(eq(identities.id, row.id))
      return { data: { id: row.id, deleted: true } }
    })
