/**
 * File Name: resolve.ts
 * Purpose: The resolved SEO representation (closure plan Phase 9A, Unit 11):
 *          one function that applies every precedence rule so that no frontend
 *          ever reconstructs them. Stored editorial configuration goes in;
 *          what a page should render comes out.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure - every external answer (the object's own fields,
 *          the application's URL resolver, the media URL) is passed IN, so the
 *          rules can be argued about without a database. Editorial-only state
 *          (the focus keyword, the analysis checklist) has no route into the
 *          output: it is not read here at all.
 */
import { resolveCanonical } from './canonical'
import { effectiveRobots } from './robots'
import { mergeStructuredData, validateStructuredData } from './structured-data'
import { pickMetadata, resolveText } from './metadata'
import { buildFaqSchema } from './schemas'
import type { JsonLdNode, ResolvedSeo, SeoHelpers, SeoRobots, SeoScoped, SeoUrlInput } from '../contract'

export interface ResolveInput extends SeoUrlInput {
  /** The snapshot to read: the published one for a website, the draft for a preview. */
  scoped: SeoScoped
  /** Whether the object is published. Authoritative over the robots directives. */
  published: boolean
  /** The object's own fields, as far as Core guarantees them. */
  content: { title?: string | null }
  /** What the site declared. */
  helpers: SeoHelpers
  /** The absolute media URL, already resolved by the caller (or null). */
  socialImageUrl?: string | null
  /**
   * The object's page URL, already resolved by the caller (or null) - the
   * same shape as socialImageUrl, so this pure layer never reads a field or
   * calls a site resolver itself.
   */
  pageUrl?: string | null
  /**
   * The workspace's default robots directives (from SEO settings). Used only
   * when the object sets none of its own - a per-object override still wins,
   * and publication state still overrules both.
   */
  robotsDefault?: SeoRobots
  /**
   * Site-level JSON-LD from settings (Organization, WebSite - the entity graph
   * every page carries). Merged before the site's own `helpers.structuredData`
   * and the object's nodes.
   */
  siteSchema?: JsonLdNode[]
  /**
   * The generated per-content-type node (Article, Product, ...), built from the
   * type's schema mapping. Sits after the site nodes and before the object's own
   * structured-data override, which can add to or restate it.
   */
  typeSchema?: JsonLdNode | null
}

/**
 * The precedence, applied once:
 *
 * - title: SEO override for the locale, then the base override, then the
 *   object's own title, then the site's fallback, then omitted.
 * - description: the same, minus the content step - Core guarantees a title
 *   and does not guarantee a summary field, and guessing which field is one
 *   would be inventing an application-specific default.
 * - canonical: explicit override, then the application's resolver, then omitted.
 * - robots: the editor's directives, overruled by publication state.
 * - structured data: site nodes first, the object's own after.
 */
export async function resolveSeo(input: ResolveInput): Promise<ResolvedSeo> {
  const metadata = pickMetadata(input.scoped, input.locale)
  const siteFallback = safeFallback(input)

  const title = resolveText({ override: metadata.title, content: input.content.title, fallback: siteFallback?.title })
  const description = resolveText({ override: metadata.description, content: null, fallback: siteFallback?.description })

  const canonical = await resolveCanonical({
    workspaceId: input.workspaceId,
    type: input.type,
    id: input.id,
    locale: input.locale,
    slug: input.slug,
    override: metadata.canonicalOverride,
    // The caller already asked the site (resolver, then declared field); this
    // hands that answer to the same precedence the canonical has always used.
    resolveUrl: input.pageUrl === undefined ? input.helpers.resolveUrl : async () => input.pageUrl ?? null,
  })

  // Precedence: the object's own robots, then the workspace default, then
  // index+follow - all still overruled by publication state inside effectiveRobots.
  const robots = effectiveRobots(metadata.robots ?? input.robotsDefault, { published: input.published })

  const checked = validateStructuredData(metadata.structuredData ?? [])
  const overrideNodes: JsonLdNode[] = checked.ok ? checked.nodes : []
  // Object layer = the generated per-type node, the FAQ node, then the object's
  // own override. The FAQ comes from the editor's Q/A pairs (GEO + rich results).
  const faqNode = buildFaqSchema(metadata.faqs ?? [])
  const objectNodes = [
    ...(input.typeSchema ? [input.typeSchema] : []),
    ...(faqNode ? [faqNode] : []),
    ...overrideNodes,
  ]
  // Site layer = settings entity graph, then the site-declared nodes; object
  // nodes come after, so a page can add to or restate the site's assertions.
  const siteNodes = [...(input.siteSchema ?? []), ...(input.helpers.structuredData ?? [])]
  const structuredData = mergeStructuredData(siteNodes, objectNodes)

  const out: ResolvedSeo = { robots, structuredData }
  if (title) out.title = title
  if (description) out.description = description
  if (canonical) out.canonical = canonical
  if (metadata.answerSummary) out.answerSummary = metadata.answerSummary

  const og = openGraph({ metadata, title, description, canonical, imageUrl: input.socialImageUrl })
  if (og) out.openGraph = og

  return out
}

/** A site fallback that throws must not take the page down with it. */
function safeFallback(input: ResolveInput): { title?: string; description?: string } | undefined {
  if (!input.helpers.fallback) return undefined
  try {
    return input.helpers.fallback({
      workspaceId: input.workspaceId, type: input.type, id: input.id, locale: input.locale, slug: input.slug,
    })
  } catch { return undefined }
}

/**
 * Open Graph reuses the page's own title and description unless the editor
 * overrode them. One shared set of values, not a second field system per
 * network: every network that matters reads OG.
 */
function openGraph(input: {
  metadata: { social?: { title?: string | null; description?: string | null; type?: string | null; imageAlt?: string | null } | null }
  title?: string
  description?: string
  canonical?: string
  imageUrl?: string | null
}): ResolvedSeo['openGraph'] | undefined {
  const social = input.metadata.social ?? {}
  const og: NonNullable<ResolvedSeo['openGraph']> = { type: social.type?.trim() || 'website' }
  const t = resolveText({ override: social.title, content: input.title, fallback: null }); if (t) og.title = t
  const d = resolveText({ override: social.description, content: input.description, fallback: null }); if (d) og.description = d
  if (input.imageUrl) {
    og.image = input.imageUrl
    // Alt text describes THE image: without one there is nothing it could be about.
    const alt = social.imageAlt?.trim(); if (alt) og.imageAlt = alt
  }
  if (input.canonical) og.url = input.canonical
  // Only worth emitting when it says something beyond the default type.
  return og.title || og.description || og.image || og.url ? og : undefined
}
