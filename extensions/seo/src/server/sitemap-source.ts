/**
 * File Name: sitemap-source.ts
 * Purpose: Building the sitemap from published content (closure plan Phase 9A,
 *          Units 7 and 20). Bounded iteration and a SINGLE metadata read for
 *          the whole run - not one query per object, which is the failure this
 *          file exists to avoid.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The URL for each object comes from the application's
 *          resolver. An object it cannot place has no sitemap entry and the
 *          run reports the reason; nothing here assembles a path from a slug.
 */
import { sitemapEligibility, sortEntries, type IneligibleReason, type SitemapEntry } from '../lib/sitemap'
import { readStored, pickMetadata } from '../lib/metadata'
import type { SeoHelpers, SeoUrlResolver } from '../contract'
import type { ExtensionStore } from '@tangen/cms'
import { objectUrl } from '../lib/object-url'

/** How many objects one query reads. Bounded, so a large site pages. */
export const SITEMAP_PAGE_SIZE = 500

/** A hard stop, so a runaway site cannot exhaust the process building a file. */
export const SITEMAP_MAX_OBJECTS = 200_000

/**
 * The sitemap takes its resolver as its own argument (a caller may hand one in
 * that the helpers do not name), so the URL answer must see that one.
 */
const helpersWithResolver = (input: { helpers: SeoHelpers; resolveUrl?: SeoUrlResolver }): SeoHelpers =>
  (input.resolveUrl ? { ...input.helpers, resolveUrl: input.resolveUrl } : input.helpers)

export interface SitemapObject {
  id: string
  type: string
  slug?: string | null
  /** The object's own title, for the health report; the sitemap itself never emits it. */
  title?: string | null
  updatedAt?: string | null
  publishedAt?: string | null
  /** The declared URL field's value, read by the producer (it holds the row). */
  urlFieldValue?: string | null
}

export interface SitemapBuild {
  entries: SitemapEntry[]
  /** Why objects were left out, counted. The answer to "where is my page?". */
  skipped: Record<IneligibleReason, number>
  scanned: number
  /** True when the scan stopped at its bound rather than at the end. */
  truncated: boolean
}

const emptySkipped = (): Record<IneligibleReason, number> =>
  ({ NOT_PUBLISHED: 0, NOINDEX: 0, EXCLUDED: 0, UNRESOLVED_URL: 0, TYPE_NOT_ELIGIBLE: 0 })

/**
 * Turns published objects into sitemap entries.
 *
 * The published SEO metadata for every object is read ONCE, as one prefix
 * scan of the extension's own store, and looked up in memory per object. The
 * alternative - a read per object - is the N+1 the measurements in the Phase
 * 9A report check for.
 */
export async function buildSitemap(input: {
  workspaceId: string
  locale?: string | null
  helpers: SeoHelpers
  store: ExtensionStore
  /** Pages of published objects, already bounded by the caller. */
  objects: AsyncIterable<SitemapObject[]>
  resolveUrl?: SeoUrlResolver
}): Promise<SitemapBuild> {
  const metadataByObject = await loadPublishedMetadata(input.store)
  const skipped = emptySkipped()
  const entries: SitemapEntry[] = []
  let scanned = 0
  let truncated = false

  for await (const page of input.objects) {
    for (const object of page) {
      if (scanned >= SITEMAP_MAX_OBJECTS) { truncated = true; break }
      scanned++

      const scoped = metadataByObject.get(object.id)
      const metadata = scoped ? pickMetadata(scoped, input.locale) : {}

      const url = await objectUrl({
        helpers: helpersWithResolver(input), workspaceId: input.workspaceId, type: object.type, id: object.id,
        locale: input.locale, slug: object.slug, fieldValue: object.urlFieldValue,
      })

      const verdict = sitemapEligibility({
        published: true, metadata, type: object.type, url, sitemapTypes: input.helpers.sitemapTypes,
      })
      if (!verdict.eligible) { skipped[verdict.reason]++; continue }

      const entry: SitemapEntry = { loc: url! }
      const lastModified = object.updatedAt ?? object.publishedAt
      if (lastModified) entry.lastModified = new Date(lastModified).toISOString()

      const alternates = await resolveAlternates(input, object)
      if (alternates.length) entry.alternates = alternates

      entries.push(entry)
    }
    if (truncated) break
  }

  return { entries: sortEntries(entries), skipped, scanned, truncated }
}

/**
 * Alternates only for locales that ACTUALLY resolved. A site that cannot
 * place its French page gets no `hreflang="fr"` rather than a fabricated one:
 * a wrong alternate is a worse answer than a missing one.
 */
async function resolveAlternates(
  input: { workspaceId: string; locale?: string | null; helpers: SeoHelpers; resolveUrl?: SeoUrlResolver },
  object: SitemapObject,
): Promise<Array<{ hreflang: string; href: string }>> {
  const locales = input.helpers.locales
  if (!locales?.length || !input.resolveUrl) return []
  const out: Array<{ hreflang: string; href: string }> = []
  for (const code of locales) {
    const href = await objectUrl({
      helpers: helpersWithResolver(input), workspaceId: input.workspaceId, type: object.type, id: object.id,
      locale: code, slug: object.slug, fieldValue: object.urlFieldValue,
    })
    if (href) out.push({ hreflang: code, href })
  }
  return out
}

async function safeResolve(resolver: SeoUrlResolver | undefined, args: Parameters<SeoUrlResolver>[0]): Promise<string | null> {
  if (!resolver) return null
  try { return (await resolver(args)) ?? null } catch { return null }
}

/**
 * Every object's PUBLISHED SEO snapshot, in one prefix scan. The draft is
 * deliberately not read: a sitemap is a public artifact.
 */
async function loadPublishedMetadata(store: ExtensionStore) {
  const map = new Map<string, ReturnType<typeof readStored>['draft']>()
  const rows = await store.list('obj_', { limit: SITEMAP_MAX_OBJECTS })
  for (const { key, data } of rows) {
    const stored = readStored(data)
    if (stored.published) map.set(key, stored.published)
  }
  return map
}
