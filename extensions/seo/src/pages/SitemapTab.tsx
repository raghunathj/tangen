/**
 * File Name: SitemapTab.tsx
 * Purpose: SEO Manager S2: the Sitemap tab. The report the server already
 *          keeps (entries, files, skipped, scanned, truncated), said in words,
 *          with the served URL to copy and a way to re-count.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch, toast, FormSection, Input, Button, Callout, Skeleton, Text } from '@/kit'
import { describeSitemapReport, type SitemapReport } from '../lib/sitemap-report'

export function SitemapPanel() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [report, setReport] = useState<SitemapReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setReport((await adminFetch<{ data: SitemapReport }>('/admin/ext/seo/sitemap-report')).data) }
    catch (e) { setError((e as Error).message || 'The sitemap report could not be loaded.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const url = `${window.location.origin}/api/v1/ext/seo/sitemap.xml?workspace=${encodeURIComponent(workspaceId ?? '')}`
  const described = report ? describeSitemapReport(report) : null
  return (
    <div className="max-w-2xl space-y-5">
      <FormSection title="Sitemap" description="Every published object of the types your site lists, one URL each, served as sitemap.xml (a sitemap index when it spans files).">
        {loading && <Skeleton className="h-16 w-full" />}
        {error && <Callout variant="danger" title="Could not load the report">{error}</Callout>}
        {described && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-fg">{described.headline}</p>
            {described.details.map((d) => <Text key={d} variant="help">{d}</Text>)}
            {described.warning && <Callout variant="warning">{described.warning}</Callout>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={url} className="min-w-0 flex-1 font-mono text-[11px]" aria-label="sitemap URL" />
          <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(url); toast.success('sitemap URL copied') }}>Copy</Button>
          <Button size="sm" variant="secondary" onClick={() => { void load() }} disabled={loading}>Re-count</Button>
        </div>
      </FormSection>
      <Text variant="help">Which types are listed is your site&apos;s call: `sitemapTypes` in the SEO options, else every type with a resolvable URL. Locales ride as alternates.</Text>
    </div>
  )
}
