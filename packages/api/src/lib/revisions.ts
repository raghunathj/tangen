/**
 * File Name: revisions.ts
 * Purpose: Content revision management — creating named revisions, upserting the
 *   single auto-save slot per object, pruning old versions, and building snapshots.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db (revisions table, DbClient)
 */

import { randomUUID } from 'node:crypto'
import { eq, and, sql } from 'drizzle-orm'
import { revisions } from '@tangen/db'
import type { DbClient } from '@tangen/db'
import { jsonbParam } from './sql-values'

/**
 * Inserts or refreshes the single autosave revision for an object.
 * If an autosave already exists it is updated in place (snapshot + timestamp);
 * otherwise a new autosave revision row is inserted.
 * @param db - Drizzle database client
 * @param opts - Object metadata and content row to snapshot
 */
export async function upsertAutoSave(
  db: DbClient,
  opts: {
    objectId: string
    workspaceId: string
    typeId: string
    typeName: string
    row: Record<string, unknown>
    createdBy?: string | null
    extDataSnapshot?: Record<string, Record<string, unknown>>
  },
): Promise<void> {
  const { objectId, workspaceId, typeId, typeName, row, createdBy, extDataSnapshot } = opts
  const contentSnapshot = buildSnapshot(row)
  const snapshot = extDataSnapshot ? { ...contentSnapshot, extensionData: extDataSnapshot } : contentSnapshot
  const existing = await db
    .select({ id: revisions.id })
    .from(revisions)
    .where(and(
      eq(revisions.objectId, objectId),
      eq(revisions.workspaceId, workspaceId),
      sql`version_type = 'autosave'`,
    ))
    .limit(1)

  if (existing.length > 0) {
    // Refresh snapshot and timestamp so it sorts to the top of history
    await db.execute(
      sql`UPDATE _revisions SET snapshot = ${jsonbParam(snapshot)}, created_at = NOW() WHERE id = ${existing[0].id}`,
    )
  } else {
    await insertRevisionAtomically(db, {
      workspaceId, typeId, typeName, objectId,
      versionType: 'autosave', snapshot, createdBy: createdBy ?? null,
    })
  }
}

/**
 * Deletes the autosave revision for an object, typically called after a successful publish or save.
 * @param db - Drizzle database client
 * @param opts - Object ID and workspace ID identifying the autosave to remove
 */
export async function deleteAutoSave(
  db: DbClient,
  opts: { objectId: string; workspaceId: string },
): Promise<void> {
  await db.execute(
    sql`DELETE FROM _revisions WHERE object_id = ${opts.objectId} AND workspace_id = ${opts.workspaceId} AND version_type = 'autosave'`,
  )
}

const SYSTEM_COLS = new Set([
  'id', 'workspace_id', 'workspaceId',
  'status',
  'published_at', 'publishedAt',
  'published_values', 'publishedValues',
  'scheduled_at', 'scheduledAt',
  'scheduled_by', 'scheduledBy',
  'created_at', 'createdAt',
  'updated_at', 'updatedAt',
  'created_by', 'createdBy',
  'updated_by', 'updatedBy',
  'created_by_kind', 'createdByKind',
  'updated_by_kind', 'updatedByKind',
  'published_by_kind', 'publishedByKind',
  '_has_draft_app_data', '_hasDraftAppData',
  'type',
])

/**
 * Extracts { title, slug, values } from a content row for storage as a revision snapshot.
 * System-managed columns (ids, timestamps, status, etc.) are stripped from `values`.
 * @param row - Raw content object row from the database
 * @returns Snapshot object containing title, slug, and user-editable field values
 */
export function buildSnapshot(row: Record<string, unknown>): {
  title: string | null
  slug: string | null
  values: Record<string, unknown>
} {
  const { title, slug, title: _t, slug: _s, ...rest } = row as any
  const values: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    if (!SYSTEM_COLS.has(k)) values[k] = v
  }
  return { title: title ?? null, slug: slug ?? null, values }
}

/**
 * Creates a named revision for a content object and prunes excess old revisions.
 * Inserts a new row with the next sequential version number, then deletes any
 * rows beyond the `maxVersions` limit (default 10), oldest first.
 * @param db - Drizzle database client
 * @param opts - Object metadata, content row, optional version type label, and pruning limit
 */
/**
 * Allocates the next version for an object and inserts the revision in ONE
 * statement, then retries if the database says somebody else took that number.
 *
 * The old shape - `SELECT COALESCE(MAX(version),0)` followed by a separate
 * INSERT - could not be made safe by ordering alone. Two writers reading the
 * same maximum both computed the same next version, and nothing in the schema
 * stopped both from inserting it. Computing the maximum INSIDE the insert
 * closes the window between the read and the write but not the one between two
 * concurrent inserts, so the `_revisions_object_version_uniq` index is what
 * actually enforces the invariant and this retries when it fires.
 *
 * The allocation scope is (workspace_id, object_id):
 * that is the scope the previous MAX() used, and the unique index matches it
 * exactly, so numbering semantics are unchanged.
 */
async function insertRevisionAtomically(
  db: DbClient,
  values: {
    workspaceId: string; typeId: string; typeName: string
    objectId: string; versionType: string | null; snapshot: unknown; createdBy: string | null; locale?: string | null
  },
): Promise<number> {
  const { workspaceId, typeId, typeName, objectId, versionType, snapshot, createdBy, locale = null } = values
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await db.execute(sql`
        INSERT INTO _revisions (id, workspace_id, type_id, type_name, object_id, version, version_type, snapshot, created_by, locale)
        SELECT ${randomUUID()}, ${workspaceId}, ${typeId}, ${typeName}, ${objectId},
               COALESCE(MAX(version), 0) + 1, ${versionType}, ${JSON.stringify(snapshot)}::jsonb, ${createdBy}, ${locale}
        FROM _revisions WHERE workspace_id = ${workspaceId} AND object_id = ${objectId}
        RETURNING version
      `) as unknown as Array<{ version: number }> | { rows?: Array<{ version: number }> }
      const out = Array.isArray(rows) ? rows : (rows.rows ?? [])
      return Number(out[0]?.version ?? 0)
    } catch (e) {
      // 23505 unique_violation: a concurrent writer took this number first.
      const code = (e as { code?: string; cause?: { code?: string } })?.code
        ?? (e as { cause?: { code?: string } })?.cause?.code
      const msg = e instanceof Error ? e.message : String(e)
      if (code !== '23505' && !msg.includes('_revisions_object_version_uniq')) throw e
      if (attempt === 4) throw e
    }
  }
  throw new Error('could not allocate a revision version')
}

export async function createRevision(
  db: DbClient,
  opts: {
    objectId: string
    workspaceId: string
    typeId: string
    typeName: string
    row: Record<string, unknown>
    createdBy?: string | null
    maxVersions?: number
    versionType?: string | null
    /** Extension data to snapshot alongside content fields, keyed by extensionId. */
    extDataSnapshot?: Record<string, Record<string, unknown>>
    /**
     * Also remove the rolling autosave row: a manual save promotes it to a real
     * checkpoint, so it is redundant the moment this revision exists. Folded
     * into the retention statement rather than issued ahead of it, which is
     * one round trip fewer on every update and publish.
     */
    dropAutosave?: boolean
    /** The locale this revision captured (a localized save); null or absent for the base row (K5). */
    locale?: string | null
    /** The translations map frozen with a published revision (K5). */
    i18n?: Record<string, unknown> | null
  },
): Promise<void> {
  const { objectId, workspaceId, typeId, typeName, row, createdBy, maxVersions = 10, versionType, extDataSnapshot, dropAutosave = false, locale, i18n } = opts

  const contentSnapshot = buildSnapshot(row)
  const snapshot = {
    ...contentSnapshot,
    ...(extDataSnapshot ? { extensionData: extDataSnapshot } : {}),
    ...(i18n && typeof i18n === 'object' ? { i18n } : {}),
  }

  // One statement, and the database - not the ordering of two - decides that
  // the version is unique.
  await insertRevisionAtomically(db, {
    workspaceId, typeId, typeName, objectId,
    versionType: versionType ?? null, snapshot, createdBy: createdBy ?? null, locale: locale ?? null,
  })

  // Retention in ONE statement. This used to SELECT the newest N and then,
  // only when N were found, DELETE everything older than the oldest of them:
  // two round trips on a mature object and one wasted round trip on every
  // young one, since the SELECT nearly always came back short. A DELETE whose
  // cutoff is a subquery does the same job in one trip and deletes nothing
  // when there is nothing to delete.
  //
  // "Newest" is by version, not created_at. Versions are unique per object
  // (0036), so the Nth newest is unambiguous where a created_at tie could keep
  // N+1; and versions have gaps (autosaves are deleted), so this ranks rather
  // than subtracts. The subquery walks the (workspace_id, object_id, version)
  // index; when there is no Nth row it yields NULL, the comparison is unknown,
  // and nothing is deleted - which is the young-object case.
  await db.execute(sql`
    DELETE FROM _revisions
     WHERE object_id = ${objectId} AND workspace_id = ${workspaceId}
       AND (
         version < (SELECT version FROM _revisions
                     WHERE object_id = ${objectId} AND workspace_id = ${workspaceId}
                     ORDER BY version DESC OFFSET ${maxVersions - 1} LIMIT 1)
         ${dropAutosave ? sql`OR version_type = 'autosave'` : sql``}
       )`)
}
