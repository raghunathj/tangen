/**
 * File Name: search-recommendations.ts
 * Purpose: CRUD for query curation rules (Settings → Search) — pin/hide results
 *          for a query. Editing invalidates the query-time cache. manage:settings.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { randomUUID } from 'node:crypto'
import { and, eq, desc } from 'drizzle-orm'
import { searchRecommendations } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { invalidateCurationCache } from '../../services/search-curation'

export interface CurationRef { type?: string; id: string; title?: string }

/**
 * Normalize submitted pins/hides to typed refs. Accepts `{type,id,title}` objects
 * (from the object picker) or bare id/url strings (back-compat); de-dupes by id.
 */
export function cleanRefs(input: unknown): CurationRef[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: CurationRef[] = []
  for (const k of input) {
    const ref: CurationRef | null =
      typeof k === 'string' ? (k.trim() ? { id: k.trim() } : null)
      : k && typeof k === 'object' && (k as any).id ? { type: (k as any).type, id: String((k as any).id), title: (k as any).title } : null
    if (ref && !seen.has(ref.id)) { seen.add(ref.id); out.push(ref) }
  }
  return out
}

export const searchRecommendationsRoute = (app: Elysia) =>
  app
    .get('/api/v1/admin/search-recommendations', async (ctx: any) => {
      const { db, workspaceId, permissions } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      const rows = await db
        .select({ id: searchRecommendations.id, query: searchRecommendations.query, pins: searchRecommendations.pins, hides: searchRecommendations.hides, audience: searchRecommendations.audience })
        .from(searchRecommendations)
        .where(and(eq(searchRecommendations.workspaceId, workspaceId)))
        .orderBy(desc(searchRecommendations.updatedAt))
      return { data: rows }
    })
    .post('/api/v1/admin/search-recommendations', async (ctx: any) => {
      const { db, workspaceId, permissions, body } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      const query = String((body as any)?.query ?? '').trim()
      const pins = cleanRefs((body as any)?.pins)
      const hides = cleanRefs((body as any)?.hides)
      const audience = (body as any)?.audience === 'public' || (body as any)?.audience === 'internal' ? (body as any).audience : null
      if (!query) throw new RequestError('VALIDATION_ERROR', 'query is required', 422)
      if (pins.length === 0 && hides.length === 0) {
        throw new RequestError('VALIDATION_ERROR', 'Add at least one pin or hide', 422)
      }
      const id = randomUUID()
      await db.insert(searchRecommendations).values({ id, workspaceId, query, pins, hides, audience })
      invalidateCurationCache(workspaceId)
      return { data: { id, query, pins, hides, audience } }
    })
    .patch('/api/v1/admin/search-recommendations/:id', async (ctx: any) => {
      const { db, workspaceId, permissions, params, body } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      const query = String((body as any)?.query ?? '').trim()
      const pins = cleanRefs((body as any)?.pins)
      const hides = cleanRefs((body as any)?.hides)
      const audience = (body as any)?.audience === 'public' || (body as any)?.audience === 'internal' ? (body as any).audience : null
      if (!query) throw new RequestError('VALIDATION_ERROR', 'query is required', 422)
      if (pins.length === 0 && hides.length === 0) throw new RequestError('VALIDATION_ERROR', 'Add at least one pin or hide', 422)
      await db.update(searchRecommendations).set({ query, pins, hides, audience, updatedAt: new Date() }).where(and(
        eq(searchRecommendations.id, params.id), eq(searchRecommendations.workspaceId, workspaceId), ))
      invalidateCurationCache(workspaceId)
      return { data: { id: params.id, query, pins, hides, audience } }
    })
    .delete('/api/v1/admin/search-recommendations/:id', async (ctx: any) => {
      const { db, workspaceId, permissions, params } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      await db.delete(searchRecommendations).where(and(
        eq(searchRecommendations.id, params.id),
        eq(searchRecommendations.workspaceId, workspaceId),
        ))
      invalidateCurationCache(workspaceId)
      return { data: { id: params.id, deleted: true } }
    })
