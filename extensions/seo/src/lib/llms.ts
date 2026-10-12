/**
 * File Name: llms.ts
 * Purpose: The llms.txt / llms-full.txt manifest (plan-seo-next Phase 4, GEO).
 *          A pure Markdown renderer that turns published content into the
 *          AI-crawler manifest generative engines read - the GEO equivalent of
 *          a sitemap. Structure only; the server supplies the content.
 *
 * Author: Raghunath J
 * License: MIT
 */

export interface LlmsItem {
  title: string
  url: string
  /** A short summary, shown only in the -full manifest. */
  summary?: string
}

export interface LlmsGroup {
  label: string
  items: LlmsItem[]
}

export interface LlmsInput {
  siteName?: string
  siteDescription?: string
  groups: LlmsGroup[]
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Render the manifest. `full` includes each item's summary after the link; the
 * default (llms.txt) is titles and links only. Empty groups are skipped.
 */
export function buildLlmsTxt(input: LlmsInput, opts: { full?: boolean } = {}): string {
  const lines: string[] = []
  lines.push(`# ${clean(input.siteName) || 'Site'}`)
  const desc = clean(input.siteDescription)
  if (desc) { lines.push(''); lines.push(`> ${desc}`) }

  for (const group of input.groups) {
    const items = group.items.filter((i) => clean(i.title) && clean(i.url))
    if (items.length === 0) continue
    lines.push('')
    lines.push(`## ${clean(group.label) || 'Content'}`)
    lines.push('')
    for (const item of items) {
      const summary = opts.full ? clean(item.summary) : ''
      lines.push(`- [${clean(item.title)}](${clean(item.url)})${summary ? `: ${summary}` : ''}`)
    }
  }

  return lines.join('\n') + '\n'
}
