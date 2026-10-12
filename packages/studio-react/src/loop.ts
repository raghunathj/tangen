/**
 * File Name: loop.ts
 * Purpose: The data half of kit.loop - walking a block tree for its query
 *          specs, and resolving those specs through a SITE-SUPPLIED
 *          resolver into the per-loop results the renderer reads.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Two-phase ON PURPOSE - resolve first, render second.
 *          An async widget would force RSC on every consumer and make the
 *          runtime untestable with renderToStaticMarkup; a site instead
 *          awaits resolveStudioData() in its own loader (Next page, Astro
 *          frontmatter, Remix loader) and hands the result to
 *          <StudioBlocks loopData={...}/>, which stays synchronous.
 *          The package never holds credentials or knows an endpoint - the
 *          resolver is the site's, same adapter philosophy as the SSR
 *          packages. Query values are passed through VERBATIM: they are the
 *          platform's TangenQL body, not a dialect this package invents.
 */
import type { BlockNode } from './types'

/** One loop's query, in TangenQL's own shape. */
export type LoopQuerySpec = {
  /** The `_key` of the kit.loop this spec came from. */
  loopKey: string
  /** The object type to query. */
  source: string
  /** TangenQL filter object, passed through verbatim. */
  query: Record<string, unknown>
  sort?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
}

/** What a resolver returns for one loop. */
export type LoopResult = {
  data: unknown[]
  meta?: { total?: number }
  /** Set by resolveStudioData when the resolver threw. */
  error?: boolean
}

/** Resolved results, keyed by loop `_key`. */
export type LoopData = Record<string, LoopResult>

/** The site's query executor. */
export type QueryResolver = (spec: LoopQuerySpec) => Promise<LoopResult>

const isBlock = (v: unknown): v is BlockNode =>
  !!v && typeof v === 'object' && typeof (v as BlockNode)._type === 'string'

/**
 * Every loop query in the tree, in document order. A loop with no source is
 * skipped (nothing to ask for), as is a disabled one - hidden blocks never
 * render, so fetching for them would be pure waste.
 */
export function collectLoopQueries(blocks: unknown): LoopQuerySpec[] {
  const out: LoopQuerySpec[] = []
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const entry of list) {
      if (!isBlock(entry)) continue
      if (entry._disabled === true) continue
      if (entry._type === 'kit.loop') {
        const source = typeof entry.source === 'string' ? entry.source : ''
        if (source) {
          const spec: LoopQuerySpec = {
            loopKey: typeof entry._key === 'string' ? entry._key : '',
            source,
            query: (entry.query && typeof entry.query === 'object' && !Array.isArray(entry.query))
              ? (entry.query as Record<string, unknown>)
              : {},
          }
          if (typeof entry.sortField === 'string' && entry.sortField) {
            spec.sort = {
              field: entry.sortField,
              direction: entry.sortDirection === 'asc' ? 'asc' : 'desc',
            }
          }
          if (typeof entry.limit === 'number' && Number.isFinite(entry.limit)) spec.limit = entry.limit
          out.push(spec)
        }
      }
      // Descend into every child block array (section children, row columns,
      // and a loop's own template - a template may itself contain nothing
      // queryable today, but walking it costs nothing and stays future-proof).
      for (const value of Object.values(entry)) if (Array.isArray(value)) walk(value)
    }
  }
  walk(blocks)
  return out
}

/**
 * Runs every loop query through the site's resolver, concurrently, and keys
 * the results by loop. A resolver that throws yields `{ data: [], error:
 * true }` for that loop ONLY - one failing query degrades its own section to
 * the error slot instead of taking the whole page down.
 */
export async function resolveStudioData(
  blocks: unknown,
  resolveQuery: QueryResolver,
): Promise<LoopData> {
  const specs = collectLoopQueries(blocks)
  const results = await Promise.all(specs.map(async (spec): Promise<[string, LoopResult]> => {
    try {
      const result = await resolveQuery(spec)
      return [spec.loopKey, { data: Array.isArray(result?.data) ? result.data : [], meta: result?.meta }]
    } catch {
      return [spec.loopKey, { data: [], error: true }]
    }
  }))
  return Object.fromEntries(results)
}
