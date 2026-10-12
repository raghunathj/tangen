/**
 * File Name: not-found-store.ts
 * Purpose: The 404 Monitor's store (plan-seo-manager-v2 V5). The public
 *          redirect lookup a site calls on a miss already knows every path
 *          that did not resolve; this counts it in the extension's own
 *          store, paths only, capped at MISS_CAP unique paths. Recording is
 *          best effort: a site's 404 must never fail because bookkeeping
 *          did.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionStore } from '@tangen/cms'
import {
  countMiss, MISS_CAP, MISS_PAGE_SIZE, normalizeMissPath, notFoundKey,
  NOT_FOUND_PREFIX, sortMisses, weakestMiss, type MissRow, type MissSort,
} from '../lib/not-found'

const allRows = async (store: ExtensionStore): Promise<MissRow[]> =>
  (await store.list(NOT_FOUND_PREFIX, { limit: MISS_CAP + 50 })).map((r) => r.data as unknown as MissRow).filter((r) => typeof r?.path === 'string')

/** Counts one miss. Returns the stored path, or null when nothing was recorded. */
export async function recordNotFound(store: ExtensionStore, rawPath: unknown, now = new Date()): Promise<string | null> {
  const path = normalizeMissPath(rawPath)
  if (!path) return null
  const existing = (await store.get(notFoundKey(path))) as unknown as MissRow | undefined
  // An ignored path stays ignored: it is a decision, not a gap in the data.
  if (existing?.ignoredAt) return null
  if (!existing) {
    const rows = await allRows(store)
    if (rows.length >= MISS_CAP) {
      const weakest = weakestMiss(rows)
      // Nothing weaker than a first sighting: leave the list as it is.
      if (!weakest || weakest.hits > 1) return null
      await store.remove(notFoundKey(weakest.path))
    }
  }
  await store.put(notFoundKey(path), countMiss(existing ?? null, path, now) as never)
  return path
}

export async function listNotFound(
  store: ExtensionStore,
  opts: { limit?: number; offset?: number; includeIgnored?: boolean; sort?: MissSort; desc?: boolean } = {},
): Promise<{ rows: MissRow[]; total: number; tracked: number; cap: number }> {
  const tracked = await allRows(store)
  const rows = sortMisses(tracked, { includeIgnored: opts.includeIgnored, ...(opts.sort ? { sort: opts.sort } : {}), ...(opts.desc !== undefined ? { desc: opts.desc } : {}) })
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? MISS_PAGE_SIZE), 200))
  return { rows: rows.slice(offset, offset + limit), total: rows.length, tracked: tracked.length, cap: MISS_CAP }
}

/** Marks a path as needing nothing: it leaves the list and stops being counted. */
export async function ignoreNotFound(store: ExtensionStore, rawPath: unknown, now = new Date()): Promise<MissRow | null> {
  const path = normalizeMissPath(rawPath)
  if (!path) return null
  const existing = (await store.get(notFoundKey(path))) as unknown as MissRow | undefined
  if (!existing) return null
  const row: MissRow = { ...existing, ignoredAt: now.toISOString() }
  await store.put(notFoundKey(path), row as never)
  return row
}

/** Forgets a path entirely; it will be counted again if it is requested again. */
export async function clearNotFound(store: ExtensionStore, rawPath: unknown): Promise<boolean> {
  const path = normalizeMissPath(rawPath)
  if (!path) return false
  if (!(await store.get(notFoundKey(path)))) return false
  await store.remove(notFoundKey(path))
  return true
}
