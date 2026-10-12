/**
 * File Name: search-curation.ts
 * Purpose: C5 — query curation ("recommendations"). matchRule resolves the
 *   pins/hides for a query (case-insensitive, audience-scoped, merged across
 *   matching rules); applyCuration reorders results (pins to the top in order,
 *   hides removed). Applied after the providers run. Rules are loaded from
 *   search_recommendations and cached; edits invalidate the cache.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { and, eq } from 'drizzle-orm'
import { searchRecommendations } from '@tangen/db'

export interface CurationRule {
  query: string
  pins: string[]
  hides: string[]
  audience?: string | null
}

export interface ResolvedCuration {
  pins: string[]
  hides: string[]
}

/** A result matches a pin/hide key by its id or url. */
function keyed<T extends { id?: string; url?: string }>(r: T, key: string): boolean {
  return r.id === key || r.url === key
}

/**
 * Reorder results per a rule: hides removed, pins moved to the top in pin order.
 * A pin that isn't in the results (or is hidden) is ignored.
 */
export function applyCuration<T extends { id?: string; url?: string }>(results: T[], rule?: ResolvedCuration): T[] {
  if (!rule) return results
  const kept = results.filter((r) => !rule.hides.some((h) => keyed(r, h)))
  const pinned: T[] = []
  const used = new Set<number>()
  for (const p of rule.pins) {
    const idx = kept.findIndex((r, i) => !used.has(i) && keyed(r, p))
    if (idx >= 0) { pinned.push(kept[idx]); used.add(idx) }
  }
  const rest = kept.filter((_, i) => !used.has(i))
  return [...pinned, ...rest]
}

/**
 * Resolve the effective pins/hides for a query, merging every rule whose query
 * matches (case-insensitive) and whose audience is unset or equals `audience`.
 */
export function matchRule(rules: CurationRule[], query: string, audience: 'internal' | 'public'): ResolvedCuration | undefined {
  const q = query.trim().toLowerCase()
  const matching = rules.filter(
    (r) => r.query.trim().toLowerCase() === q && (!r.audience || r.audience === audience),
  )
  if (matching.length === 0) return undefined
  const pins: string[] = []
  const hides: string[] = []
  for (const r of matching) {
    for (const p of r.pins ?? []) if (!pins.includes(p)) pins.push(p)
    for (const h of r.hides ?? []) if (!hides.includes(h)) hides.push(h)
  }
  return { pins, hides }
}

/** Extract result keys (ids) from stored pins/hides — typed refs {id} or strings. */
export function refIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? (x as any).id : undefined))
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
}

// ── Loading + cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000
const _cache = new Map<string, { at: number; rules: CurationRule[] }>()

/** Load a workspace/env's curation rules, cached briefly. */
export async function loadCurationRules(db: any, workspaceId: string): Promise<CurationRule[]> {
  const key = `${workspaceId}`
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rules
  const rows: any[] = await db
    .select({ query: searchRecommendations.query, pins: searchRecommendations.pins, hides: searchRecommendations.hides, audience: searchRecommendations.audience })
    .from(searchRecommendations)
    .where(and(eq(searchRecommendations.workspaceId, workspaceId)))
  const rules: CurationRule[] = rows.map((r) => ({
    query: r.query,
    pins: refIds(r.pins),
    hides: refIds(r.hides),
    audience: r.audience ?? null,
  }))
  _cache.set(key, { at: Date.now(), rules })
  return rules
}

export function invalidateCurationCache(workspaceId: string): void {
  _cache.delete(`${workspaceId}`)
}
