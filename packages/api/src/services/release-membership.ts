/**
 * File Name: release-membership.ts
 * Purpose: One object belongs to at most one OPEN Release
 *          (tasks/remove-environments-programme.md, section 11). A release
 *          is open until it is applied; while an object is in one, no other
 *          release may take it, so two change sets can never race to
 *          publish the same draft.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { sql } from 'drizzle-orm'
import { RequestError } from '../lib/errors'

/** Every status before `applied`: the release still owns its objects. */
export const OPEN_RELEASE_STATUSES = ['draft', 'in_review', 'approved', 'applying', 'failed'] as const

export interface OpenReleaseHolder { releaseId: string; name: string; status: string }

/** The open release that already holds this object, if any (another release than `excludeReleaseId`). */
export async function openReleaseHolding(
  db: any,
  input: { workspaceId: string; typeName: string; objectId: string; excludeReleaseId?: string },
): Promise<OpenReleaseHolder | null> {
  const res = await db.execute(sql`
    SELECT r.id AS release_id, r.name, r.status
      FROM release_items i
      JOIN releases r ON r.id = i.release_id
     WHERE r.workspace_id = ${input.workspaceId}
       AND i.type_name = ${input.typeName} AND i.object_id = ${input.objectId}
       AND r.status IN ('draft', 'in_review', 'approved', 'applying', 'failed')
       AND r.id <> ${input.excludeReleaseId ?? ''}
     ORDER BY r.created_at
     LIMIT 1`)
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
  const row = rows[0]
  return row ? { releaseId: String(row.release_id), name: String(row.name), status: String(row.status) } : null
}

/** Refuses (409 OBJECT_IN_OPEN_RELEASE) when another open release holds the object. */
export async function assertNotInOpenRelease(
  db: any,
  input: { workspaceId: string; typeName: string; objectId: string; excludeReleaseId?: string },
): Promise<void> {
  const holder = await openReleaseHolding(db, input)
  if (holder) {
    throw new RequestError('CONFLICT', `${input.typeName}/${input.objectId} is already in release "${holder.name}" (${holder.status}); one object belongs to at most one open release`, 409, { releaseId: holder.releaseId })
  }
}
