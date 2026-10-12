/**
 * File Name: search-providers.ts
 * Purpose: The search provider registry (Phase 1 of the search platform). A
 *          provider is one source of results — content, users, forms, or an
 *          extension. runSearchProviders runs every provider eligible for the
 *          request's audience (internal ⌘K vs public Site Search) and gate, in
 *          parallel, isolating any that throw so one failing source never blanks
 *          the whole result set. contentProvider asks the search ENGINE, and
 *          knows nothing about which one answered.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure orchestration + the built-in content provider; route
 *                     and palette wiring land in later slices (S5/S6).
 */
import { and, eq, ilike, or } from 'drizzle-orm'
import type { ExtensionSearchProvider, ExtensionSearchHit } from '@tangen/types'
import type { SearchEngine } from './search-engine'

/** Which surface a search runs on. */
export type SearchAudience = 'internal' | 'public'

/** A single result from any provider. */
export interface ProviderHit {
  id: string
  title: string
  /** 'content' | 'form' | 'auth_user' | extension-defined. */
  kind: string
  typeName?: string
  status?: string
  updatedAt?: string
  score?: number
  /** Explicit destination (extension providers set their own URL; built-ins
   *  derive it from kind + typeName at render). */
  url?: string
}

/** Context handed to a provider's search(). */
export interface SearchProviderCtx {
  workspaceId: string
  audience: SearchAudience
  limit: number
  /**
   * The content-search ENGINE. Content is the one source that needs indexing,
   * and this is the seam that stops it naming a particular one. Absent only in
   * older call sites, which fall back to the service directly.
   */
  engine?: SearchEngine
  /** Types the caller is allowed to read; applied inside the engine's query. */
  allowedTypes?: string[]
  /** Locale to search. Part of a document's identity, not a filter afterthought. */
  locale?: string
  /** Drizzle db handle (providers that hit Postgres, e.g. users/forms).* */
  db?: unknown
  /** Feature flags a provider may gate on (e.g. auth users enabled). */
  features?: Record<string, boolean>
  /** Synonym-expanded query for full-text providers (content). Falls back to the
   *  raw query when absent. Exact-match providers (users/forms) ignore it. */
  expandedTerm?: string
}

/** A source of search results. */
export interface SearchProvider {
  id: string
  /** Group heading shown in results. */
  label: string
  /** Audiences this provider may run in. */
  audiences: SearchAudience[]
  /** Optional feature/permission gate — provider is skipped when it returns false. */
  gate?: (ctx: SearchProviderCtx) => boolean
  search: (q: string, ctx: SearchProviderCtx) => Promise<ProviderHit[]>
}

/** One provider's results, tagged with its group. */
export interface ProviderResultGroup {
  id: string
  label: string
  hits: ProviderHit[]
}

/**
 * Run every provider that supports `ctx.audience` and passes its gate, in
 * parallel. A provider that throws is dropped (its group omitted) so one failing
 * source never blanks the result set; providers returning no hits are omitted too.
 * A blank query short-circuits to [] without invoking any provider.
 */
export async function runSearchProviders(
  providers: SearchProvider[],
  q: string,
  ctx: SearchProviderCtx,
): Promise<ProviderResultGroup[]> {
  if (!q.trim()) return []
  const eligible = providers.filter(
    (p) => p.audiences.includes(ctx.audience) && (p.gate ? p.gate(ctx) : true),
  )
  const settled = await Promise.allSettled(eligible.map((p) => p.search(q, ctx)))
  const groups: ProviderResultGroup[] = []
  eligible.forEach((p, i) => {
    const r = settled[i]
    if (r.status === 'fulfilled' && r.value.length > 0) {
      groups.push({ id: p.id, label: p.label, hits: r.value })
    }
  })
  return groups
}

/**
 * Adapt an extension's declared `searchProviders` into registry providers:
 * namespaced id (`ext:<extensionId>:<id>`), audience default of internal-only,
 * and hits carrying the extension's explicit URL + a namespaced `ext:<id>` kind.
 * `runSearch` bridges to the extension's own server ctx (built by the caller,
 * S5) so this stays pure and unit-testable.
 */
export function adaptExtensionSearchProviders(
  extensionId: string,
  defs: ExtensionSearchProvider[],
  runSearch: (def: ExtensionSearchProvider, q: string, ctx: SearchProviderCtx) => Promise<ExtensionSearchHit[]>,
): SearchProvider[] {
  return defs.map((def) => ({
    id: `ext:${extensionId}:${def.id}`,
    label: def.label,
    audiences: def.audiences ?? ['internal'],
    async search(q, ctx) {
      const hits = await runSearch(def, q, ctx)
      return hits.map((h) => ({
        id: h.id,
        title: h.title,
        kind: `ext:${extensionId}`,
        url: h.to,
        status: h.status,
      }))
    },
  }))
}

/**
 * Collect registry providers from every installed extension that declares
 * `searchProviders`. Bridges each to the extension's own server ctx (built lazily
 * per query via `buildExtCtx`). Injected accessors keep this unit-testable; the
 * route supplies them from the extension registry + wiring deps.
 */
/**
 * K2.1: the providers the ACTIVE extensions of a workspace contribute
 * (`search.providers@1`), each run with its contributor's own ctx.
 */
export async function extensionSearchProvidersFor(
  workspaceId: string,
  deps: { activeIds?: (workspaceId: string) => Promise<string[]>; isActive: (id: string, workspaceId: string) => Promise<boolean>; buildCtx: (id: string, workspaceId: string) => unknown | Promise<unknown> },
): Promise<SearchProvider[]> {
  const { contributions } = await import('../kernel/contributions')
  const { listRegisteredExtensionIds } = await import('../hooks/app-hooks-registry')
  const ids = listRegisteredExtensionIds()
  const active = deps.activeIds
    ? new Set(await deps.activeIds(workspaceId).catch(() => [] as string[]))
    : new Set((await Promise.all(ids.map(async (id) => ((await deps.isActive(id, workspaceId)) ? id : null)))).filter((id): id is string => !!id))
  const byExtension = new Map<string, ExtensionSearchProvider[]>()
  for (const c of contributions<ExtensionSearchProvider>('search.providers@1', { activeIds: active })) {
    byExtension.set(c.extensionId, [...(byExtension.get(c.extensionId) ?? []), c.item])
  }
  const out: SearchProvider[] = []
  for (const [id, defs] of byExtension) {
    out.push(...adaptExtensionSearchProviders(id, defs, async (def, q, ctx) => def.search(q, (await deps.buildCtx(id, ctx.workspaceId)) as never)))
  }
  return out
}

export async function collectExtensionSearchProviders(
  ids: string[],
  getDefs: (id: string) => ExtensionSearchProvider[] | undefined,
  isInstalled: (id: string) => Promise<boolean>,
  buildExtCtx: (id: string, workspaceId: string) => Promise<unknown>,
): Promise<SearchProvider[]> {
  const out: SearchProvider[] = []
  for (const id of ids) {
    const defs = getDefs(id)
    if (!defs?.length) continue
    if (!(await isInstalled(id))) continue
    out.push(
      ...adaptExtensionSearchProviders(id, defs, async (def, q, ctx) => {
        const extCtx = await buildExtCtx(id, ctx.workspaceId)
        return def.search(q, extCtx as never)
      }),
    )
  }
  return out
}

/**
 * Content, through the search engine. Admin sees everything the caller may
 * read; public sees only what is published.
 *
 * The provider names no datastore. That is the seam: swapping the engine is a
 * composition change, and nothing here - nor any extension - needs to know.
 */
export const contentProvider: SearchProvider = {
  id: 'content',
  label: 'Content',
  audiences: ['internal', 'public'],
  async search(q, ctx) {
    const term = ctx.expandedTerm ?? q // synonym-expanded when available
    if (ctx.engine) {
      const res = await ctx.engine.search({
        workspaceId: ctx.workspaceId,
        query: term,
        audience: ctx.audience,
        limit: ctx.limit,
        source: 'content',
        ...(ctx.locale !== undefined ? { locale: ctx.locale } : {}),
        ...(ctx.allowedTypes ? { allowedTypes: ctx.allowedTypes } : {}),
      })
      return res.hits.map((h) => ({
        id: h.objectId,
        title: h.title,
        kind: 'content',
        typeName: h.typeSlug,
        status: h.status,
        score: h.score,
      }))
    }
    return []
  },
}
