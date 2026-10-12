/**
 * File Name: sitemap.ts
 * Purpose: The sitemap contract (closure plan Phase 9A, Unit 7): one canonical
 *          representation with thin serializers over it, eligibility that can
 *          say WHY an object is absent, and partitioning that behaves at the
 *          size real sites reach.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure. The one rule that shapes everything: a sitemap
 *          entry needs a URL, and Tangen cannot invent one - an object whose
 *          URL the application did not resolve is omitted with a reason, never
 *          guessed at from a slug.
 */
import { validateCanonical } from './canonical'
import type { SeoMetadata } from '../contract'

/** One page in a sitemap. The only representation; the XML is a view of it. */
export interface SitemapEntry {
  loc: string
  /** ISO 8601. Absent rather than invented when the object has no timestamp. */
  lastModified?: string
  /** Only locales that actually resolved. Never fabricated. */
  alternates?: Array<{ hreflang: string; href: string }>
}

/**
 * The standard's ceiling is 50,000 URLs (and 50 MB) per file. Sitting under
 * it leaves room for the alternates a localized site adds per entry.
 */
export const SITEMAP_MAX_ENTRIES = 45_000

export type IneligibleReason = 'NOT_PUBLISHED' | 'NOINDEX' | 'EXCLUDED' | 'UNRESOLVED_URL' | 'TYPE_NOT_ELIGIBLE'

export interface EligibilityInput {
  published: boolean
  metadata: SeoMetadata
  type: string
  /** What the application's resolver answered, or null when it had no answer. */
  url: string | null
  /** The site's eligible types; absent means every type. */
  sitemapTypes?: string[]
}

/**
 * Whether one object belongs in the sitemap, and when it does not, why. The
 * reason is the point: "your page is missing" is a support ticket, "excluded
 * by the editor" is an answer.
 */
export function sitemapEligibility(input: EligibilityInput): { eligible: true } | { eligible: false; reason: IneligibleReason } {
  if (!input.published) return { eligible: false, reason: 'NOT_PUBLISHED' }
  if (input.sitemapTypes && !input.sitemapTypes.includes(input.type)) return { eligible: false, reason: 'TYPE_NOT_ELIGIBLE' }
  if (input.metadata.robots?.index === false) return { eligible: false, reason: 'NOINDEX' }
  if (input.metadata.sitemapExclude === true) return { eligible: false, reason: 'EXCLUDED' }
  if (!input.url || !validateCanonical(input.url).ok) return { eligible: false, reason: 'UNRESOLVED_URL' }
  return { eligible: true }
}

/** By URL: the same content produces the same file whatever order the rows arrived in. */
export function sortEntries(entries: SitemapEntry[]): SitemapEntry[] {
  return [...entries].sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0))
}

/** Fixed-size pages, in order, so page 2 is page 2 on every regeneration. */
export function partitionEntries(entries: SitemapEntry[], size = SITEMAP_MAX_ENTRIES): SitemapEntry[][] {
  if (entries.length <= size) return [entries]
  const pages: SitemapEntry[][] = []
  for (let i = 0; i < entries.length; i += size) pages.push(entries.slice(i, i + size))
  return pages
}

/** The five XML entities. A URL carrying `&` or `<` must not break the document. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** A urlset. Thin: it renders entries and decides nothing. */
export function sitemapXml(entries: SitemapEntry[]): string {
  const hasAlternates = entries.some((e) => e.alternates?.length)
  const ns = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    ...(hasAlternates ? ['xmlns:xhtml="http://www.w3.org/1999/xhtml"'] : []),
  ].join(' ')
  const body = entries.map((e) => {
    const parts = [`    <loc>${escapeXml(e.loc)}</loc>`]
    if (e.lastModified) parts.push(`    <lastmod>${escapeXml(e.lastModified)}</lastmod>`)
    for (const alt of e.alternates ?? []) {
      parts.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>`)
    }
    return `  <url>\n${parts.join('\n')}\n  </url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${ns}>\n${body}${body ? '\n' : ''}</urlset>\n`
}

/** A sitemapindex over the pages a partitioned sitemap produced. */
export function sitemapIndexXml(pages: Array<{ loc: string; lastModified?: string }>): string {
  const body = pages.map((p) => {
    const parts = [`    <loc>${escapeXml(p.loc)}</loc>`]
    if (p.lastModified) parts.push(`    <lastmod>${escapeXml(p.lastModified)}</lastmod>`)
    return `  <sitemap>\n${parts.join('\n')}\n  </sitemap>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</sitemapindex>\n`
}
