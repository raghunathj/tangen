/**
 * File Name: GeoTab.tsx
 * Purpose: SEO Manager S2: the GEO tab - how AI answer engines see the site.
 *          Owns the llms.txt switch (moved out of Settings) and previews the
 *          manifest through the member route; the per-page pieces (FAQ, the
 *          answer summary) live in the SEO panel of each object and are
 *          explained here.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch, useCan, toast, FormSection, Toggle, Input, Button, Callout, Skeleton, Text } from '@/kit'
import type { SeoSettings } from '../lib/settings'

interface Preview { enabled: boolean; path: string; manifest: string | null }

export function GeoPanel() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { hasCapability } = useCan()
  const mayWrite = hasCapability('seo:write' as never)
  const [settings, setSettings] = useState<SeoSettings | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [s, p] = await Promise.all([
        adminFetch<{ data: SeoSettings }>('/admin/ext/seo/site-settings'),
        adminFetch<{ data: Preview }>('/admin/ext/seo/llms-preview'),
      ])
      setSettings(s.data); setPreview(p.data)
    } catch (e) { setError((e as Error).message || 'The GEO settings could not be loaded.') }
  }, [])
  useEffect(() => { void load() }, [load])

  async function setEnabled(enabled: boolean) {
    if (!settings) return
    setSaving(true); setError(null)
    try {
      // The settings write is a full replace: everything else is sent back as loaded.
      // Only the group this tab owns: the route merges by group now.
      const res = await adminFetch<{ data: SeoSettings }>('/admin/ext/seo/site-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ geo: { ...settings.geo, llmsTxtEnabled: enabled } }) })
      setSettings(res.data)
      setPreview((await adminFetch<{ data: Preview }>('/admin/ext/seo/llms-preview')).data)
      toast.success(enabled ? 'llms.txt is published' : 'llms.txt is off')
    } catch (e) { setError((e as Error).message || 'The change could not be saved.') }
    finally { setSaving(false) }
  }

  const url = `${window.location.origin}/api/v1/ext/seo/llms.txt?workspace=${encodeURIComponent(workspaceId ?? '')}`
  return (
    <div className="max-w-2xl space-y-5">
      {error && <Callout variant="danger">{error}</Callout>}
      <FormSection title="llms.txt" description="A manifest of your published content for AI answer engines (llms.txt, and llms-full.txt with summaries). Served only while this is on.">
        {!settings ? <Skeleton className="h-10 w-full" /> : (
          <Toggle label="Publish llms.txt" description="Serve the manifest at the URL below." direction="switch-first" size="sm" checked={settings.geo.llmsTxtEnabled} disabled={!mayWrite || saving} onCheckedChange={(v: boolean) => { void setEnabled(v) }} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={url} className="min-w-0 flex-1 font-mono text-[11px]" aria-label="llms.txt URL" />
          <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(url); toast.success('llms.txt URL copied') }}>Copy</Button>
          <Button size="sm" variant="secondary" onClick={() => { void load() }} disabled={saving}>Refresh preview</Button>
        </div>
        {preview && (preview.enabled && preview.manifest
          ? <pre className="max-h-80 overflow-auto rounded border border-border bg-surface-sunken p-3 text-[11px] leading-5 text-fg">{preview.manifest}</pre>
          : <Text variant="help">The manifest is off. Turn it on to preview what engines would read.</Text>)}
      </FormSection>
      <FormSection title="Per page" description="What each page tells an answer engine is set in its SEO panel.">
        <Text variant="help">The <strong>answer summary</strong> is the two or three sentences an engine may quote; <strong>FAQ</strong> pairs become FAQPage structured data. Both take an AI draft when the workspace has AI enabled, and both work without it.</Text>
      </FormSection>
    </div>
  )
}
