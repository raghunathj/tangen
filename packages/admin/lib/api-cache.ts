/**
 * File Name: api-cache.ts
 * Purpose: Short-TTL cache for admin GETs whose data changes rarely but is
 *          fetched by several components per navigation (/types, environments,
 *          AI settings/providers, preview config). Complements adminFetch's
 *          in-flight dedupe, which only helps CONCURRENT callers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Cached callers share the SAME parsed object - treat
 *          responses as read-only. /types entries are busted by the schema
 *          TYPES_CHANGED_EVENT; mutation pages call invalidateCachedGet for
 *          their own endpoints (AI settings save, environment create/delete).
 *
 *          The key carries the WORKSPACE as well as the environment, because
 *          the request does: `X-Tangen-Workspace` decides what the server
 *          answers, so a key without it served one workspace's types,
 *          environments and settings to another for a whole TTL (closure
 *          plan Phase 8B, finding 8B-3 - the defect class Phase 8A found in
 *          the capability caches).
 */
import { adminFetch, workspaceFetch, currentWorkspaceId } from './api'
import { TYPES_CHANGED_EVENT } from './schema-save'

const cache = new Map<string, { at: number; p: Promise<unknown> }>()
const DEFAULT_TTL = 60_000

export function cachedAdminGet<T>(
  path: string,
  opts: { ttlMs?: number; extraParams?: Record<string, string> } = {},
): Promise<T> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL
  const key = `${currentWorkspaceId() ?? '-'}|${path}|${JSON.stringify(opts.extraParams ?? null)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>
  const p = adminFetch<T>(path, undefined, opts.extraParams)
  // A failed fetch must not poison the window - drop it so retries go out.
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key) })
  cache.set(key, { at: Date.now(), p })
  return p
}

/** Variant over workspaceFetch (no page attribution header) - same TTL semantics. */
export function cachedWorkspaceGet<T>(path: string, opts: { ttlMs?: number } = {}): Promise<T> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL
  const key = `${currentWorkspaceId() ?? '-'}|${path}|null`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>
  const p = workspaceFetch<T>(path)
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key) })
  cache.set(key, { at: Date.now(), p })
  return p
}

/** Drops every workspace's cached entry whose path contains the fragment. */
export function invalidateCachedGet(pathFragment: string): void {
  for (const k of cache.keys()) {
    // key: `<workspace>|<path>|<params>`
    if (k.split('|')[1]?.includes(pathFragment)) cache.delete(k)
  }
}

/** Test seam: empty the cache between cases. */
export function __resetApiCache(): void {
  cache.clear()
}

// Schema mutations change /types - the schema-save layer already broadcasts.
if (typeof window !== 'undefined') {
  window.addEventListener(TYPES_CHANGED_EVENT, () => invalidateCachedGet('/types'))
}
