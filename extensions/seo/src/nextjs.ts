/**
 * File Name: nextjs.ts
 * Purpose: The SEO extension's Next.js helpers (plan-seo-next Phase 6). Turn the
 *          resolved SEO into a Next.js Metadata object and a JSON-LD script
 *          string, so a site's generateMetadata is one call. Pure functions
 *          over the extension's own `ResolvedSeo` - no core package touched, and
 *          the Metadata shape is structural (no dependency on `next`).
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ResolvedSeo } from './contract'

/** A structural subset of Next.js `Metadata` - what the SEO adapter fills. */
export interface NextSeoMetadata {
  title?: string
  description?: string
  alternates?: { canonical?: string; languages?: Record<string, string> }
  robots?: { index: boolean; follow: boolean }
  openGraph?: { title?: string; description?: string; images?: Array<string | { url: string; alt?: string }>; type?: string; url?: string }
}

/**
 * Map resolved SEO to Next.js Metadata. Absent sections are omitted (never
 * blanked); `null` (no published SEO) yields `{}` so the page's static defaults
 * apply. Structured data is NOT here - Next.js Metadata has no JSON-LD slot;
 * render it with `seoJsonLd` in a script tag.
 */
export function seoToMetadata(seo: ResolvedSeo | null | undefined): NextSeoMetadata {
  if (!seo) return {}
  const md: NextSeoMetadata = {}
  if (seo.title) md.title = seo.title
  if (seo.description) md.description = seo.description

  const alternates: NonNullable<NextSeoMetadata['alternates']> = {}
  if (seo.canonical) alternates.canonical = seo.canonical
  if (seo.alternates?.length) {
    alternates.languages = Object.fromEntries(seo.alternates.map((a) => [a.hreflang, a.href]))
  }
  if (Object.keys(alternates).length) md.alternates = alternates

  md.robots = { index: seo.robots.index, follow: seo.robots.follow }

  if (seo.openGraph) {
    const og: NonNullable<NextSeoMetadata['openGraph']> = {}
    if (seo.openGraph.title) og.title = seo.openGraph.title
    if (seo.openGraph.description) og.description = seo.openGraph.description
    // An alt text rides on the image entry (Next renders it as og:image:alt); a bare image stays the plain string form.
    if (seo.openGraph.image) og.images = [seo.openGraph.imageAlt ? { url: seo.openGraph.image, alt: seo.openGraph.imageAlt } : seo.openGraph.image]
    if (seo.openGraph.type) og.type = seo.openGraph.type
    if (seo.openGraph.url) og.url = seo.openGraph.url
    if (Object.keys(og).length) md.openGraph = og
  }

  return md
}

/**
 * The JSON-LD for a `<script type="application/ld+json">`. A single node is
 * emitted under @context; several become a @graph. Empty string when there is
 * nothing to emit, so the caller can skip the script tag.
 */
export function seoJsonLd(seo: ResolvedSeo | null | undefined): string {
  const nodes = seo?.structuredData ?? []
  if (nodes.length === 0) return ''
  const payload = nodes.length === 1
    ? { '@context': 'https://schema.org', ...nodes[0] }
    : { '@context': 'https://schema.org', '@graph': nodes }
  return JSON.stringify(payload)
}
