/**
 * File Name: review.ts
 * Purpose: POST /api/v1/releases/:id/review - what each item of a Release
 *          would do when it publishes in place: NEW (never published),
 *          CHANGED (the draft differs from what is live), UNCHANGED (the
 *          draft is what is live). The state is stored on the item for the
 *          detail view and summarised for the reviewer.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { releases, releaseItems } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'

export type ComparisonState = 'NEW' | 'CHANGED' | 'UNCHANGED'

/** NEW when nothing is published; UNCHANGED when every published field equals the draft; CHANGED otherwise. */
export function computeComparisonState(
  draft: Record<string, unknown>,
  published: Record<string, unknown> | null,
): ComparisonState {
  if (published === null) return 'NEW'
  for (const k of new Set([...Object.keys(published), ...Object.keys(draft)])) {
    if (k === 'i18n') continue
    if (JSON.stringify(published[k] ?? null) !== JSON.stringify(draft[k] ?? null)) return 'CHANGED'
  }
  return 'UNCHANGED'
}

export interface ReviewSummary {
  new: number
  changed: number
  unchanged: number
  total: number
}

export function buildReviewSummary(items: { comparisonState: string }[]): ReviewSummary {
  const counts = { new: 0, changed: 0, unchanged: 0, total: items.length }
  for (const item of items) {
    if (item.comparisonState === 'NEW') counts.new++
    else if (item.comparisonState === 'CHANGED') counts.changed++
    else if (item.comparisonState === 'UNCHANGED') counts.unchanged++
  }
  return counts
}

export const releaseReviewRoute = (app: Elysia) =>
  app.post('/api/v1/releases/:id/review', async (ctx: any) => {
    const { db, workspaceId, memberId, params } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
    const [release] = await db.select().from(releases).where(and(eq(releases.id, params.id), eq(releases.workspaceId, workspaceId))).limit(1)
    if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)
    const items = await db.select().from(releaseItems).where(eq(releaseItems.releaseId, params.id))
    const reviewed: { objectId: string; typeName: string; comparisonState: ComparisonState; publishedAt: Date | null }[] = []
    for (const item of items) {
      const table = (contentTables as Record<string, any>)[item.typeName]
      let draft: Record<string, unknown> = item.fieldSnapshot as Record<string, unknown>
      let published: Record<string, unknown> | null = null
      let publishedAt: Date | null = null
      if (table) {
        const [row] = await db.select().from(table).where(and(eq(table.id, item.objectId), eq(table.workspaceId, workspaceId))).limit(1)
        if (row) {
          const { id: _id, workspaceId: _ws, publishedValues, publishedAt: at, ...fields } = row as Record<string, unknown>
          draft = fields
          published = (publishedValues as Record<string, unknown> | null) ?? null
          publishedAt = (at as Date | null) ?? null
        }
      }
      const state = computeComparisonState(draft, published)
      await db.update(releaseItems).set({ comparisonState: state, resolvedValues: draft }).where(eq(releaseItems.id, item.id))
      reviewed.push({ objectId: item.objectId, typeName: item.typeName, comparisonState: state, publishedAt })
    }
    return { data: { releaseId: params.id, items: reviewed, summary: buildReviewSummary(reviewed) } }
  })
