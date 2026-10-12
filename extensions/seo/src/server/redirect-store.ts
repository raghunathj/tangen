/**
 * File Name: redirect-store.ts
 * Purpose: Where redirects live (closure plan Phase 9A, Units 8, 17 and 20).
 *          The platform's own extension store, keyed by the normalized source,
 *          so a lookup is ONE indexed row read and a duplicate source cannot
 *          be created at all.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: No extension migrations and no new tables. `ctx.store`
 *          is `extension_data` with `object_id` as the key, under the unique
 *          index (extension_id, object_id, workspace_id) - already
 *          workspace and environment scoped, and already indexed for exactly
 *          the read a redirect resolver performs. A dedicated table would have
 *          been a second, weaker copy of it; the Phase 9A report says so
 *          rather than adding schema for the appearance of rigour.
 */
import { normalizeSource, normalizeSourcePath, redirectKey, validateRedirect, detectCycle, type RedirectCheck, type SeoRedirect } from '../lib/redirects'
import type { ExtensionStore } from '@tangen/cms'

export const REDIRECT_PREFIX = 'redirect:'

/** How many redirects the Admin list will page through at once. */
export const REDIRECT_PAGE_SIZE = 50

/**
 * ONE indexed row read: the primary lookup a request path performs. Nothing
 * is loaded into process memory, and the answer does not depend on how many
 * redirects the workspace has.
 */
export async function findRedirect(store: ExtensionStore, path: string): Promise<SeoRedirect | null> {
  // A rule that names a query string is exact; otherwise the visitor's query
  // is not part of what was moved, so the rule for the PATH answers. That is
  // what makes `/old-page?utm_source=mail` reach the `/old-page` redirect.
  const exact = await store.get(redirectKey(path))
  const row = exact ?? await store.get(redirectKey(normalizeSourcePath(path)))
  if (!row) return null
  const redirect = row as unknown as SeoRedirect
  return redirect.enabled === false ? null : redirect
}

export async function listRedirects(
  store: ExtensionStore,
  opts: { limit?: number; offset?: number; sort?: 'source' | 'updatedAt'; desc?: boolean } = {},
): Promise<{ rows: SeoRedirect[]; total: number }> {
  const [entries, total] = await Promise.all([
    store.list(REDIRECT_PREFIX, { orderByDataKey: opts.sort ?? 'source', ...(opts.desc ? { desc: true } : {}), limit: opts.limit ?? REDIRECT_PAGE_SIZE, offset: opts.offset ?? 0 }),
    store.count ? store.count(REDIRECT_PREFIX) : Promise.resolve(-1),
  ])
  const rows = entries.map((e) => e.data as unknown as SeoRedirect)
  return { rows, total: total >= 0 ? total : rows.length }
}

export type SaveResult = { ok: true; redirect: SeoRedirect } | { ok: false; reason: string; detail?: unknown }

/**
 * Writes one redirect. Everything that can be refused is refused HERE - the
 * route is a thin caller - so the same rules apply to the Admin, to the CLI
 * and to anything else that ever writes one.
 */
export async function saveRedirect(
  store: ExtensionStore,
  input: Partial<SeoRedirect> & { source: string },
  opts: { replacing?: string; siteUrl?: string; now: string } = { now: new Date(0).toISOString() },
): Promise<SaveResult> {
  // Validate what the editor TYPED, then normalise for storage. Normalising
  // first made `SOURCE_EMPTY` and `SOURCE_NOT_A_PATH` unreachable through the
  // route: an empty From became "/" and would have redirected the home page.
  const typed = String(input.source ?? '')
  const source = normalizeSource(typed)
  const candidate: SeoRedirect = {
    source,
    destination: input.destination as SeoRedirect['destination'],
    status: (input.status ?? 301) as SeoRedirect['status'],
    enabled: input.enabled !== false,
    // Absent means "carry it"; only an explicit false is stored.
    ...(input.keepQuery === false ? { keepQuery: false } : {}),
    createdAt: input.createdAt ?? opts.now,
    updatedAt: opts.now,
    ...(input.note ? { note: String(input.note).slice(0, 500) } : {}),
  }

  const checked: RedirectCheck = validateRedirect({ ...candidate, source: typed, siteUrl: opts.siteUrl })
  if (!checked.ok) return { ok: false, reason: checked.reason }

  // One source, one redirect: the key IS the source, so a duplicate is a
  // collision rather than a second row nobody can tell apart.
  const replacingKey = opts.replacing ? redirectKey(opts.replacing) : null
  const key = redirectKey(source)
  if (key !== replacingKey && (await store.get(key))) return { ok: false, reason: 'DUPLICATE_SOURCE' }

  // Bounded cycle check across what is already stored. Explicitly bounded -
  // this is a guard against the obvious mistake, not a graph analysis.
  if (candidate.destination?.kind === 'external' || candidate.destination?.kind === 'path') {
    const existing = await loadChain(store)
    let destPath: string | null = null
    if (candidate.destination.kind === 'path') destPath = normalizeSourcePath(candidate.destination.path)
    else try { destPath = new URL(candidate.destination.url).pathname } catch { destPath = null }
    if (destPath) {
      const cycle = detectCycle(source, destPath, existing)
      if (cycle.cycle) return { ok: false, reason: 'REDIRECT_LOOP', detail: cycle.path }
    }
  }

  if (replacingKey && replacingKey !== key) await store.remove(replacingKey)
  await store.put(key, candidate as unknown as Record<string, unknown>)
  return { ok: true, redirect: candidate }
}

export async function deleteRedirect(store: ExtensionStore, source: string): Promise<void> {
  await store.remove(redirectKey(source))
}

/**
 * source -> destination path, for the bounded cycle check only. It reads the
 * stored redirects once at WRITE time; nothing on the request path does this.
 */
async function loadChain(store: ExtensionStore): Promise<Map<string, string>> {
  const entries = await store.list(REDIRECT_PREFIX, { limit: 1000 })
  const chain = new Map<string, string>()
  for (const { data } of entries) {
    const r = data as unknown as SeoRedirect
    if (r.destination?.kind !== 'external') continue
    try { chain.set(normalizeSource(r.source), new URL(r.destination.url).pathname) } catch { /* skip */ }
  }
  return chain
}
