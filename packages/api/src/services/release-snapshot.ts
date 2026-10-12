/**
 * File Name: release-snapshot.ts
 * Purpose: Field snapshots for release items - the values shown by
 *   diff/review and used for conflict detection at apply time. Factored out
 *   of releases/create.ts so item-add uses the SAME code path (it used to
 *   write fieldSnapshot: {} - every diff against it was a lie; sync
 *   overhaul defect 6).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Table registries are parameters, not imports - routes
 *   pass contentTables; tests pass fixtures (module mocks leak in bun).
 */
import { eq, and } from 'drizzle-orm'

/**
 * Copyable field values of one object in one env, or null when it does not
 * exist there. Identity columns (id/workspaceId) are stripped.
 */
export async function snapshotObjectFields(
  db: any,
  workspaceId: string,
  table: any,
  objectId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [row] = await db.select().from(table)
      .where(and(eq(table.id, objectId), eq(table.workspaceId, workspaceId)))
      .limit(1)
    if (!row) return null
    const { id: _id, workspaceId: _ws, ...fields } = row as Record<string, unknown>
    return fields
  } catch {
    return null   // table missing / column drift - treat as absent
  }
}

/**
 * Scans the registry for the type that owns objectId in the given env.
 * Used by release creation, where the client sends bare object ids.
 */
export async function findAndSnapshotObject(
  db: any,
  workspaceId: string,
  objectId: string,
  tables: Record<string, any>,
): Promise<{ typeName: string; fields: Record<string, unknown> } | null> {
  for (const [typeName, table] of Object.entries(tables)) {
    const fields = await snapshotObjectFields(db, workspaceId, table, objectId)
    if (fields) return { typeName, fields }
  }
  return null
}
