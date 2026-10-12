/**
 * File Name: not-found.ts
 * Purpose: The 404 Monitor's data rules (plan-seo-manager-v2 V5), pure.
 *          PATHS ONLY: a miss is normalised to a path, its query string and
 *          fragment dropped, and nothing about the visitor is derived or
 *          kept - no address, no agent, no referrer. The store holds at most
 *          MISS_CAP unique paths; at the cap the weakest row (fewest hits,
 *          then least recently seen) makes room, so a scanner spraying
 *          unique URLs cannot push out the miss that matters.
 *
 * Author: Raghunath J
 * License: MIT
 */

export const NOT_FOUND_PREFIX = 'notfound:'
/** Unique paths, not hits: a path is counted for as long as it is tracked. */
export const MISS_CAP = 500
export const MISS_PAGE_SIZE = 50
const MAX_PATH_LENGTH = 512

export interface MissRow {
  path: string
  hits: number
  firstSeenAt: string
  lastSeenAt: string
  /** Set when an editor decided this path needs no redirect; it stops being counted and leaves the list. */
  ignoredAt?: string
}

export const notFoundKey = (path: string): string => `${NOT_FOUND_PREFIX}${path}`

/**
 * The path a miss is recorded under, or null when there is nothing usable.
 * An absolute URL contributes its pathname only; a query string, a fragment,
 * and anything past the length limit are dropped rather than stored.
 */
export function normalizeMissPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (!value) return null
  // An absolute URL: keep the path, drop the origin, the query and the hash.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try { value = new URL(value).pathname } catch { return null }
  }
  value = value.split('#')[0]!.split('?')[0]!
  if (!value) return null
  // One leading slash, no trailing one, no doubles.
  value = `/${value.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
  if (value.length > 1) value = value.replace(/\/+$/, '')
  if (!value || value === '/') return null
  if (value.length > MAX_PATH_LENGTH) return null
  // A control character never belongs in a stored path.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}

/** The row after one more miss on it; a first sighting starts at one hit. */
export function countMiss(existing: MissRow | null | undefined, path: string, now: Date): MissRow {
  const at = now.toISOString()
  if (!existing) return { path, hits: 1, firstSeenAt: at, lastSeenAt: at }
  return { ...existing, path, hits: (Number(existing.hits) || 0) + 1, firstSeenAt: existing.firstSeenAt ?? at, lastSeenAt: at }
}

/** Which tracked path makes room for a new one: fewest hits, then least recently seen. Null when there is nothing to evict. */
export function weakestMiss(rows: readonly MissRow[]): MissRow | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => (a.hits - b.hits) || a.lastSeenAt.localeCompare(b.lastSeenAt) || a.path.localeCompare(b.path))[0]!
}

export type MissSort = 'hits' | 'path' | 'lastSeenAt' | 'firstSeenAt'

/** The list an editor reads: ignored rows aside, busiest first unless asked otherwise. */
export function sortMisses(rows: readonly MissRow[], opts: { includeIgnored?: boolean; sort?: MissSort; desc?: boolean } = {}): MissRow[] {
  const sort = opts.sort ?? 'hits'
  // Each key has the direction an editor means by default: most hits, most
  // recent, but paths read A to Z.
  const desc = opts.desc ?? sort !== 'path'
  const compare = (a: MissRow, b: MissRow): number => {
    const first = sort === 'hits' ? a.hits - b.hits : String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''))
    return (desc ? -first : first) || a.path.localeCompare(b.path)
  }
  return rows.filter((r) => (opts.includeIgnored ? true : !r.ignoredAt)).sort(compare)
}
