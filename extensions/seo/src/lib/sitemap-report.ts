/**
 * File Name: sitemap-report.ts
 * Purpose: SEO Manager S2: the sitemap report in words. The server's report
 *          is numbers (entries, files, skipped, scanned, truncated); the
 *          Sitemap tab shows what they mean, and a truncated sitemap is a
 *          warning an editor can act on, not a silent cap.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface SitemapReport {
  entries: number
  pageCount: number
  skipped: number
  scanned: number
  truncated: boolean
}

export interface SitemapDescription {
  headline: string
  details: string[]
  warning: string | null
}

const n = (v: number) => v.toLocaleString('en-US')
const plural = (v: number, one: string, many: string) => (v === 1 ? one : many)

export function describeSitemapReport(r: SitemapReport): SitemapDescription {
  if (r.entries === 0) return { headline: 'No URLs yet', details: [], warning: r.scanned > 0 ? `${n(r.scanned)} published ${plural(r.scanned, 'object', 'objects')} scanned, none resolved to a URL - declare resolveUrl for their types` : null }
  const details = [`${n(r.scanned)} published ${plural(r.scanned, 'object', 'objects')} scanned`]
  if (r.skipped > 0) details.push(`${n(r.skipped)} skipped (no URL could be resolved for ${plural(r.skipped, 'it', 'them')})`)
  return {
    headline: `${n(r.entries)} URLs in ${n(r.pageCount)} sitemap ${plural(r.pageCount, 'file', 'files')}`,
    details,
    warning: r.truncated ? 'The sitemap was cut short at its size limit: not every published URL is listed. Narrow sitemapTypes or split by type.' : null,
  }
}
