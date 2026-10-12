/**
 * File Name: diff.ts
 * Purpose: Elysia route plugin for GET /api/v1/releases/:id/diff, producing a per-object field-level diff
 *          between the release snapshot and the current state of the target environment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db releases, releaseItems, and contentTables; member authentication is mandatory.
 */
import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { releases, releaseItems } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'

export interface FieldDiffEntry {
  field: string
  draftValue: unknown
  publishedValue: unknown
  changed: boolean
}

/**
 * Produces a field-by-field diff between a release snapshot and the current target row.
 * @param sourceSnapshot - Field values captured at release creation time
 * @param targetCurrent - Current field values from the target environment
 * @returns Array of FieldDiffEntry records indicating which fields changed and their respective values
 */
export function buildFieldDiff(
  draft: Record<string, unknown>,
  published: Record<string, unknown>,
): FieldDiffEntry[] {
  const allFields = new Set([...Object.keys(draft), ...Object.keys(published)])
  const result: FieldDiffEntry[] = []
  for (const field of allFields) {
    const src = draft[field] ?? null
    const tgt = published[field] ?? null
    result.push({
      field,
      draftValue: src,
      publishedValue: tgt,
      changed: JSON.stringify(src) !== JSON.stringify(tgt),
    })
  }
  return result
}

/**
 * Elysia plugin providing GET /api/v1/releases/:id/diff to show field-level changes for each release item.
 * @returns Elysia plugin function
 */
export const releaseDiffRoute = (app: Elysia) =>
  app.get('/api/v1/releases/:id/diff', async (ctx: any) => {
    const { db, workspaceId, memberId, params } = ctx

    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)

    const releaseId = params.id as string
    const [release] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.id, releaseId), eq(releases.workspaceId, workspaceId)))
      .limit(1)

    if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)

    const items = await db
      .select()
      .from(releaseItems)
      .where(eq(releaseItems.releaseId, releaseId))

    const diffs = []
    for (const item of items) {
      const table = (contentTables as Record<string, any>)[item.typeName]
      let targetCurrent: Record<string, unknown> = {}
      if (table) {
        try {
          const [row] = await db
            .select()
            .from(table)
            .where(and(eq(table.id, item.objectId), eq(table.workspaceId, workspaceId)))
            .limit(1)
          if (row) {
            const { id: _id, workspaceId: _ws, ...fields } = row as Record<string, unknown>
            targetCurrent = fields
          }
        } catch { /* table may not exist */ }
      }

      diffs.push({
        objectId: item.objectId,
        typeName: item.typeName,
        fields: buildFieldDiff(item.fieldSnapshot as Record<string, unknown>, targetCurrent),
      })
    }

    return { data: { release, diffs } }
  })
