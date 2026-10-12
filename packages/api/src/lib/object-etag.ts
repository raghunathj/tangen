/**
 * File Name: object-etag.ts
 * Purpose: Reads one object's concurrency token from the database and puts
 *          it on the response as an `ETag` (closure plan Phase 6B, Unit 6).
 *          Separate from the read itself because the token must come back
 *          as TEXT - Postgres stores `updated_at` to the microsecond and a
 *          JavaScript Date keeps only milliseconds, so a token built from
 *          the parsed row could never match its own row in a conditional
 *          UPDATE.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One extra tiny statement on a single-object read, and
 *          only when the caller can act on it. Never throws: a response
 *          without an ETag simply means "no concurrency token", which is
 *          how every pre-6B client behaves anyway.
 */
import { sql } from 'drizzle-orm'
import { etagFor } from './concurrency'

/** Reads `updated_at::text` for one row; null when the row or column is not there. */
export async function readUpdatedAtText(db: any, table: any, where: { id: string; workspaceId: string}): Promise<string | null> {
  try {
    const result = await db.execute(
      sql`SELECT ${table.updatedAt}::text AS updated_at_text FROM ${table} WHERE ${table.id} = ${where.id} AND ${table.workspaceId} = ${where.workspaceId} LIMIT 1`,
    )
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>
    const text = rows[0]?.updated_at_text
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

/** Puts the object's ETag on the response, when there is one. */
export async function attachObjectEtag(ctx: { set?: { headers?: Record<string, string> } }, db: any, table: any, where: { id: string; workspaceId: string}): Promise<string | null> {
  const etag = etagFor(await readUpdatedAtText(db, table, where))
  if (etag && ctx.set?.headers) ctx.set.headers['ETag'] = etag
  return etag
}
