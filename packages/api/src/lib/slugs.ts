/**
 * File Name: slugs.ts
 * Purpose: Race-safe slug allocation. The database's unique index on
 *          (slug) is the authority; this module only chooses a good
 *          candidate cheaply and recognises the database's refusal.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Before this, uniqueness was a SELECT-then-INSERT
 *   preflight: eight concurrent creates with one slug produced eight rows, and
 *   the preflight's miss case - proving a new slug absent - was a full scan of
 *   the table. Now the candidate is found with one index-backed probe over a
 *   batch of suffixes, the insert is attempted, and a unique violation means
 *   "someone got there first": re-probe and try again, a bounded number of
 *   times. Correctness never depends on the probe; the probe only keeps the
 *   friendly `slug`, `slug-1`, `slug-2` behaviour and avoids wasted attempts.
 */
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { textArrayParam } from './sql-values'

/** How many suffixes one probe covers: base plus base-1 … base-(N-1). */
export const SLUG_PROBE_BATCH = 26
/** How many insert attempts a create makes before giving up with a conflict. */
export const SLUG_MAX_ATTEMPTS = 8

/** Escape LIKE metacharacters so a slug is matched literally as a prefix. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * The database said no to this slug: PostgreSQL unique_violation on a
 * `<table>_slug_uniq` index. Anything else is not ours to retry.
 */
export function isSlugUniqueViolation(err: unknown): boolean {
  // Drivers wrap differently: postgres.js throws a PostgresError with `code`
  // and `constraint_name`; drizzle wraps it in a query error whose `cause` is
  // that; PGlite reports the same fields one level down again. Walk the chain.
  type E = { code?: string; constraint_name?: string; message?: string; cause?: unknown }
  const chain: E[] = []
  for (let cur = err as E | undefined, i = 0; cur && i < 4; cur = cur.cause as E | undefined, i++) chain.push(cur)
  const unique = chain.some((e) => e?.code === '23505' || /violates unique constraint/.test(String(e?.message ?? '')))
  const ours = chain.some((e) => String(e?.constraint_name ?? '').endsWith('_slug_uniq') || String(e?.message ?? '').includes('_slug_uniq'))
  return unique && ours
}

/**
 * The smallest free `base`, `base-1`, `base-2` … in one probe, or two.
 *
 * One statement checks the base and the first SLUG_PROBE_BATCH-1 suffixes
 * with an index-backed `= ANY(...)`; that is the whole story for every
 * ordinary create. Only when all of those are taken does a second statement
 * ask for the highest numeric suffix under the prefix, so a type that already
 * holds `post` through `post-10000` costs two round trips, not ten thousand.
 *
 * @param exec - runs a SQL fragment and returns rows; the caller's tx or db.
 * @param tableName - the content table (already validated as an identifier).
 * @param skipId - on update, the object's own id, whose slug does not collide with itself.
 */
export async function nextFreeSlug(
  exec: (q: SQL) => Promise<Array<Record<string, unknown>>>,
  args: { tableName: string; base: string; skipId?: string | null; spread?: number },
): Promise<string> {
  const { tableName, base, skipId, spread = 0 } = args
  const tbl = sql.raw(`"${tableName}"`)
  const own = skipId ? sql` AND "id" <> ${skipId}` : sql``
  const candidates = [base, ...Array.from({ length: SLUG_PROBE_BATCH - 1 }, (_, i) => `${base}-${i + 1}`)]
  const taken = new Set(
    // textArrayParam: one statement shape for any batch size, and an array the
    // driver binds as one parameter rather than expanding into a row.
    (await exec(sql`SELECT "slug" FROM ${tbl} WHERE "slug" = ANY(${textArrayParam(candidates)})${own}`))
      .map((r) => String(r.slug)),
  )
  // A burst of creates with one slug all see the same free list. If every
  // loser then took the first free suffix they would collide again, round after
  // round, so a retry (spread > 0) picks at random among the first spread+1
  // free candidates: the burst fans out across suffixes instead of queueing on
  // one. The first attempt is deterministic - `slug`, then `slug-1` - as before.
  const free = candidates.filter((c) => !taken.has(c))
  if (free.length > 0) return free[Math.floor(Math.random() * Math.min(free.length, spread + 1))]!
  // Every candidate in the batch is taken: one more statement, one answer.
  const rows = await exec(sql`SELECT max((substring("slug" from ${'^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-([0-9]+)$'}))::int) AS m
    FROM ${tbl} WHERE "slug" LIKE ${escapeLike(base) + '-%'}${own}`)
  const max = Number(rows[0]?.m ?? SLUG_PROBE_BATCH)
  return `${base}-${max + 1}`
}
