/**
 * File Name: health.ts
 * Purpose: Builds the Dashboard's health report (plan-seo-manager-v2 V1)
 *          from what the workspace has: the published objects the sitemap
 *          scans, their LIVE metadata read in one pass over the store, the
 *          sitemap report, the GEO switch and whether a Search Console
 *          connection exists. Stored under HEALTH_REPORT_KEY so the
 *          workspace dashboard's widget reads the last one without a scan.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ExtensionServerCtx } from '@tangen/cms'
import { SEARCH_CONSOLE_CAPABILITY } from './search-console'
import { publishedObjects, sitemapIndex, sitemapTypes } from './artifacts'
import { pickMetadata, readStored } from '../lib/metadata'
import { normalizeSettings, SEO_SETTINGS_KEY } from '../lib/settings'
import { HEALTH_REPORT_KEY, scoreObject, scoreTone, summarizeHealth, type HealthReport, type ScoredObject } from '../lib/health-report'

/** The scan stops here: a report over the first 20,000 published objects is a report, an unbounded one is an outage. */
export const HEALTH_SCAN_LIMIT = 20_000
const STORE_PAGE = 1000

/**
 * F2: whether Search Console is READABLE here, which is no longer a question
 * about one connector id. The platform's own derivation answers it - the pack
 * present, a connection made, and that connection authorized for the one
 * capability this extension needs - so the tile cannot disagree with the
 * Connections page about what is connected.
 */

/** Whether Search Console can be read here; false when anything in the chain is missing. */
export async function searchConsoleConnected(ctx: ExtensionServerCtx): Promise<boolean> {
  if (!ctx.connections) return false
  try {
    const available = await ctx.connections.availability?.(SEARCH_CONSOLE_CAPABILITY)
    return available?.state === 'ready'
  } catch { return false }
}

/**
 * The workspace dashboard's tile (V8): the LAST report this extension wrote,
 * shaped as the platform's stat-group widget. It never scans - a dashboard
 * must not pay for a content sweep - so before the first check it says so.
 */
export async function healthWidget(ctx: ExtensionServerCtx): Promise<{ stats: Array<{ label: string; value: number; tone?: 'success' | 'warning' | 'danger' | 'neutral'; href?: string }> }> {
  const report = (await ctx.store.get(HEALTH_REPORT_KEY)) as unknown as HealthReport | undefined
  if (!report || typeof report.scanned !== 'number') return { stats: [] }
  const tone = scoreTone(report.score)
  return {
    stats: [
      { label: 'Health score', value: report.score ?? 0, ...(tone ? { tone: tone === 'good' ? 'success' as const : tone === 'ok' ? 'warning' as const : 'danger' as const } : {}), href: 'extensions/seo' },
      { label: 'Needs work', value: report.counts.ok, tone: 'warning' as const, href: 'extensions/seo/titles?state=needs-work' },
      { label: 'No metadata', value: report.counts.poor, tone: 'danger' as const, href: 'extensions/seo/titles?state=missing' },
      { label: 'Published pages', value: report.scanned, tone: 'neutral' as const },
    ],
  }
}

export async function buildHealthReport(ctx: ExtensionServerCtx): Promise<HealthReport> {
  // 1. The published objects, the way the sitemap sees them (bounded).
  const objects: Array<{ id: string; type: string; title: string | null }> = []
  scan: for await (const page of publishedObjects(ctx, sitemapTypes(ctx))) {
    for (const o of page) {
      objects.push({ id: o.id, type: o.type, title: o.title ?? null })
      if (objects.length >= HEALTH_SCAN_LIMIT) break scan
    }
  }
  // 2. Their live metadata, one pass over the store rather than one read per object.
  const wanted = new Set(objects.map((o) => o.id))
  const live = new Map<string, ReturnType<typeof pickMetadata>>()
  for (let offset = 0; ; offset += STORE_PAGE) {
    const rows = await ctx.store.list('', { limit: STORE_PAGE, offset })
    for (const row of rows) {
      if (!wanted.has(row.key)) continue
      const published = readStored(row.data).published
      if (published) live.set(row.key, pickMetadata(published, null))
    }
    if (rows.length < STORE_PAGE) break
  }
  const scored: ScoredObject[] = objects.map((o) => scoreObject({ id: o.id, type: o.type, title: o.title, metadata: live.get(o.id) ?? null }))
  // 3. The services around the content.
  const settings = normalizeSettings(await ctx.store.get(SEO_SETTINGS_KEY))
  const { build, pageCount } = await sitemapIndex(ctx, null)
  const report: HealthReport = {
    generatedAt: new Date().toISOString(),
    ...summarizeHealth(scored),
    services: {
      sitemap: { entries: build.entries.length, pageCount, truncated: build.truncated },
      robots: { served: true },
      llmsTxt: { enabled: settings.geo.llmsTxtEnabled },
      searchConsole: { connected: await searchConsoleConnected(ctx) },
    },
  }
  await ctx.store.put(HEALTH_REPORT_KEY, report as unknown as Record<string, unknown>)
  return report
}
