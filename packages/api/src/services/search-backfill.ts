/**
 * File Name: search-backfill.ts
 * Purpose: Fill the search index from existing content, resumably, without
 *   holding up the server.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Resumable by construction rather than by bookkeeping.
 *   Each pass asks for content rows that have no search document yet, indexes a
 *   batch, and stops; the next pass asks the same question and gets what is
 *   left. There is no cursor to persist, nothing to corrupt, and a process that
 *   dies mid-backfill simply resumes where the data says it is.
 *
 *   It is also, deliberately, not startup work. The previous engine rebuilt its
 *   whole index at every boot - 46,349 documents, two and a half minutes of
 *   pinned CPU, during which the job queue did not drain at all. Nothing here
 *   runs before the server listens, and a backfill in progress never blocks a
 *   request: unindexed content is missing from search results until its batch
 *   arrives, which is a visible, bounded, self-healing state.
 */
import { sql } from 'drizzle-orm'
import { getLogger } from '@tangen/logging'
import type { SearchEngine } from './search-engine'
import { buildContentDocuments } from './content-search-writer'

const logger = getLogger(['tangen', 'api', 'search'])

export interface BackfillOptions {
  /** Rows per pass. Small enough that a pass never holds a connection long. */
  batchSize?: number
  /** Stop after this many rows in one call; the rest waits for the next. */
  maxRows?: number
  /** Pause between batches so a backfill cannot monopolise the pool. */
  pauseMs?: number
}

export interface BackfillProgress {
  workspaceId: string
  typeSlug: string
  indexed: number
  remaining: number
  done: boolean
  /** Existing documents whose publication state disagreed with the content. */
  repaired?: number
}

type Db = { execute: (q: unknown) => Promise<unknown> }
const rows = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as T[]

/** Content rows of one type that have no search document yet. */
export async function countUnindexed(
  db: Db, workspaceId: string, typeSlug: string, table: string,
): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${sql.raw(`"${table}"`)} c
     WHERE c.workspace_id = ${workspaceId}
       AND NOT EXISTS (
         SELECT 1 FROM search_documents d
          WHERE d.workspace_id = c.workspace_id
            AND d.source = 'content' AND d.type_slug = ${typeSlug} AND d.object_id = c.id)`)
  return Number(rows<{ n: number }>(res)[0]?.n ?? 0)
}

/**
 * One bounded pass over a type's unindexed rows.
 *
 * @param typeDef - the type's fields, for extracting searchable text.
 * @param table - the generated content table name.
 * @returns What it did, and what is left, so a caller can decide to continue.
 */
export async function backfillType(
  db: Db,
  engine: SearchEngine,
  args: { workspaceId: string; typeSlug: string; table: string; typeDef: { name: string; fields: Array<{ name: string; fieldType?: string; config?: Record<string, unknown> }> } },
  opts: BackfillOptions = {},
): Promise<BackfillProgress> {
  const batchSize = opts.batchSize ?? 200
  const maxRows = opts.maxRows ?? 5_000
  const pauseMs = opts.pauseMs ?? 25
  const { workspaceId, typeSlug, table, typeDef } = args
  let indexed = 0

  // Documents that exist but carry the wrong publication state are invisible to
  // the gap-filling loop below, which only looks for MISSING ones. Correct them
  // first, so one backfill leaves the index consistent rather than merely
  // complete.
  const repaired = await repairPublicationState(db, { workspaceId, typeSlug, table })

  while (indexed < maxRows) {
    // "Not yet indexed" IS the cursor. No progress row to keep in step with
    // reality, and re-running after a crash is simply the next pass.
    const batch = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT c.* FROM ${sql.raw(`"${table}"`)} c
       WHERE c.workspace_id = ${workspaceId}
         AND NOT EXISTS (
           SELECT 1 FROM search_documents d
            WHERE d.workspace_id = c.workspace_id
              AND d.source = 'content' AND d.type_slug = ${typeSlug} AND d.object_id = c.id)
       ORDER BY c.id
       LIMIT ${batchSize}`))
    if (batch.length === 0) break

    const docs = batch.flatMap((row) => buildContentDocuments({
      workspaceId, typeSlug, objectId: String(row.id), row, typeDef,
    }))
    // Gap filling, never overwriting: an editor who saved between this batch's
    // SELECT and this write has already put the current document in place, and
    // it must win.
    await engine.indexIfAbsent(docs)
    indexed += batch.length
    if (batch.length < batchSize) break
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs))
  }

  const remaining = await countUnindexed(db, workspaceId, typeSlug, table)
  if (indexed > 0) {
    logger.info(`[search] backfilled ${indexed} ${typeSlug} documents for ${workspaceId}, ${remaining} remaining`)
  }
  return { workspaceId, typeSlug, indexed, remaining, done: remaining === 0, repaired }
}

/**
 * Re-align publication state on documents that already exist.
 *
 * `backfillType` fills gaps with `indexIfAbsent` and deliberately never
 * overwrites, so an editor's newer save always wins a race with a backfill
 * batch. That guarantee is why it cannot repair a document that exists but is
 * WRONG - and documents like that exist wherever a publish happened while the
 * publish routes were not projecting the transition into search: the row was
 * indexed as a draft on create and nothing ever corrected it.
 *
 * So this repairs those, and does the least it possibly can. It touches only
 * `is_published` and `status`, only where they disagree with the content row,
 * and never the title, body or excerpt - so it cannot clobber the editor write
 * that `indexIfAbsent` exists to protect. Everything else about a document is
 * still the writer's business.
 *
 * @returns how many documents were corrected.
 */
export async function repairPublicationState(
  db: Db,
  args: { workspaceId: string; typeSlug: string; table: string },
): Promise<number> {
  const { workspaceId, typeSlug, table } = args
  const res = await db.execute(sql`
    UPDATE search_documents d
       SET is_published = (c.status = 'published'), status = c.status, updated_at = now()
      FROM ${sql.raw(`"${table}"`)} c
     WHERE c.id = d.object_id
       AND d.workspace_id = ${workspaceId}
       AND d.source = 'content' AND d.type_slug = ${typeSlug}
       AND (d.is_published <> (c.status = 'published') OR d.status <> c.status)
    RETURNING d.object_id`)
  const n = rows<{ object_id: string }>(res).length
  if (n > 0) logger.info(`[search] repaired publication state on ${n} ${typeSlug} documents for ${workspaceId}`)
  return n
}

/**
 * Kick a backfill off without waiting for it. Called after the server is
 * listening, never during composition, and it swallows its own failures - a
 * backfill that cannot run must not stop a server from serving.
 */
export function startBackfill(run: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(run)
    .catch((e) => logger.warn(`[search] backfill stopped: ${(e as Error).message}`))
}
