/**
 * File Name: search-synonyms.ts
 * Purpose: CRUD for marketing-managed synonym groups (Settings → Search). Editing
 *          invalidates the query-time cache so changes take effect promptly.
 *          Requires manage:settings.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { randomUUID } from 'node:crypto'
import { and, eq, desc } from 'drizzle-orm'
import { searchSynonyms } from '@tangen/db'
import { RequestError } from '../../lib/errors'
import { requireCapability } from '../../lib/member-access'
import { invalidateSynonymCache } from '../../services/search-synonyms'

/** Normalize a submitted terms list: trim, drop blanks, de-dupe, keep order. */
export function normalizeTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of input) {
    const s = String(t ?? '').trim()
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

export const searchSynonymsRoute = (app: Elysia) =>
  app
    .get('/api/v1/admin/search-synonyms', async (ctx: any) => {
      const { db, workspaceId, permissions } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      const rows = await db
        .select({ id: searchSynonyms.id, label: searchSynonyms.label, terms: searchSynonyms.terms, updatedAt: searchSynonyms.updatedAt })
        .from(searchSynonyms)
        .where(and(eq(searchSynonyms.workspaceId, workspaceId)))
        .orderBy(desc(searchSynonyms.updatedAt))
      return { data: rows }
    })
    .post('/api/v1/admin/search-synonyms', async (ctx: any) => {
      const { db, workspaceId, permissions, body } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      const label = String((body as any)?.label ?? '').trim()
      const terms = normalizeTerms((body as any)?.terms)
      if (!label) throw new RequestError('VALIDATION_ERROR', 'A title is required', 422)
      if (terms.length < 2) {
        throw new RequestError('VALIDATION_ERROR', 'A synonym group needs at least 2 distinct terms', 422)
      }
      const id = randomUUID()
      await db.insert(searchSynonyms).values({ id, workspaceId, label, terms })
      invalidateSynonymCache(workspaceId)
      return { data: { id, label, terms } }
    })
    .patch('/api/v1/admin/search-synonyms/:id', async (ctx: any) => {
      const { db, workspaceId, permissions, params, body } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      const label = String((body as any)?.label ?? '').trim()
      const terms = normalizeTerms((body as any)?.terms)
      if (!label) throw new RequestError('VALIDATION_ERROR', 'A title is required', 422)
      if (terms.length < 2) throw new RequestError('VALIDATION_ERROR', 'A synonym group needs at least 2 distinct terms', 422)
      await db.update(searchSynonyms).set({ label, terms, updatedAt: new Date() }).where(and(
        eq(searchSynonyms.id, params.id), eq(searchSynonyms.workspaceId, workspaceId), ))
      invalidateSynonymCache(workspaceId)
      return { data: { id: params.id, label, terms } }
    })
    .delete('/api/v1/admin/search-synonyms/:id', async (ctx: any) => {
      const { db, workspaceId, permissions, params } = ctx
      requireCapability({ permissions, memberId: ctx.memberId }, 'manage:settings')
      await db.delete(searchSynonyms).where(and(
        eq(searchSynonyms.id, params.id),
        eq(searchSynonyms.workspaceId, workspaceId),
        ))
      invalidateSynonymCache(workspaceId)
      return { data: { id: params.id, deleted: true } }
    })
