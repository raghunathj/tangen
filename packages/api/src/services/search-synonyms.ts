/**
 * File Name: search-synonyms.ts
 * Purpose: C4 — synonym groups applied at query time. expandQuery adds a matched
 *   group's other terms to the query (so "laptop" also finds "notebook"). Groups
 *   are loaded from search_synonyms and cached briefly; edits invalidate the
 *   cache. The content provider searches the expanded term.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq } from 'drizzle-orm'
import { searchSynonyms } from '@tangen/db'

/**
 * Expand a query with any matching synonym groups. If a query word is in a group,
 * the group's other terms are appended (de-duped, original query preserved).
 */
export function expandQuery(query: string, groups: string[][]): string {
  const words = new Set(query.toLowerCase().split(/\s+/).filter(Boolean))
  const additions: string[] = []
  const added = new Set<string>()
  for (const group of groups) {
    const lower = group.map((g) => g.toLowerCase())
    if (!lower.some((t) => words.has(t))) continue
    group.forEach((term, i) => {
      if (!words.has(lower[i]) && !added.has(lower[i])) {
        additions.push(term)
        added.add(lower[i])
      }
    })
  }
  return additions.length ? `${query} ${additions.join(' ')}` : query
}

// ── Loading + cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000
const _cache = new Map<string, { at: number; groups: string[][] }>()

/** Load a workspace/env's synonym groups (groups of ≥2 terms), cached briefly. */
export async function loadSynonymGroups(db: any, workspaceId: string): Promise<string[][]> {
  const key = `${workspaceId}`
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.groups

  const rows: Array<{ terms: unknown }> = await db
    .select({ terms: searchSynonyms.terms })
    .from(searchSynonyms)
    .where(and(eq(searchSynonyms.workspaceId, workspaceId)))

  const groups = rows
    .map((r) => (Array.isArray(r.terms) ? (r.terms as string[]) : []))
    .filter((g) => g.length > 1)
  _cache.set(key, { at: Date.now(), groups })
  return groups
}

/** Drop the cache for a workspace/env after an edit (async invalidation). */
export function invalidateSynonymCache(workspaceId: string): void {
  _cache.delete(`${workspaceId}`)
}
