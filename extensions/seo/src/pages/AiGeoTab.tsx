/**
 * File Name: AiGeoTab.tsx
 * Purpose: AI & GEO (plan-seo-manager-v2 V6): how AI answer engines read the
 *          site (the llms.txt manifest, from the GEO panel) and what this
 *          installation's AI can do for SEO - writing a page's metadata as a
 *          draft for review, and describing a share image. Each ability says
 *          whether it is available and, when it is not, exactly what is
 *          missing. No bulk control is shown, because none is built.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdminPage, FormSection, Panel, Text, adminFetch, TEXT_LINK } from '@/kit'
import { GeoPanel } from './GeoTab'
import { seoManagerHref } from '../lib/seo-manager-nav'

interface Ability { available: boolean; provider?: string; reason?: string }

export function SeoAiGeoPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const [status, setStatus] = useState<{ generate: Ability; vision: Ability } | null>(null)

  useEffect(() => {
    let alive = true
    adminFetch<{ data: { generate: Ability; vision: Ability } }>('/admin/ext/seo/ai-status')
      .then((r) => { if (alive) setStatus(r.data) })
      .catch(() => { if (alive) setStatus(null) })
    return () => { alive = false }
  }, [])

  return (
    <AdminPage
      title="AI & GEO"
      description="How AI answer engines read the site, and what your AI provider can write for it."
      access={{ capability: 'seo:read' }}
    >
      <div className="space-y-6">
        <GeoPanel />
        <FormSection title="What AI can do here" description="Each ability needs a permission and a provider. Where one is missing, the control is absent rather than broken.">
          <div className="space-y-3">
            <Ability
              title="Write a page's metadata"
              body={<>Proposes an SEO title, meta description and answer summary for one page. The proposal is a <strong>draft</strong>: it reaches visitors only when the page is published. Use it from <Link className={TEXT_LINK} to={seoManagerHref(workspaceId, 'titles')}>Titles & Meta</Link> or the page's own SEO panel.</>}
              ability={status?.generate}
            />
            <Ability
              title="Describe a share image"
              body={<>Writes the alt text for a page's Open Graph image from the image itself, in the page's SEO panel.</>}
              ability={status?.vision}
            />
          </div>
          <Text variant="help">
            Running either over many pages at once is not built yet. When it is, it will run this same action per page and leave every result as a draft for review.
          </Text>
        </FormSection>
      </div>
    </AdminPage>
  )
}

function Ability({ title, body, ability }: { title: string; body: React.ReactNode; ability?: Ability }) {
  const state = ability === undefined ? 'unknown' : ability.available ? 'on' : 'off'
  return (
    <Panel>
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${state === 'on' ? 'bg-success' : state === 'off' ? 'bg-fg-faint' : 'bg-border-strong'}`} aria-hidden="true" />
        <p className="text-sm font-semibold text-fg">{title}</p>
        <span className="ml-auto text-[11px] font-semibold text-fg-subtle">
          {state === 'on' ? `Ready · ${ability!.provider}` : state === 'off' ? 'Unavailable' : 'Checking'}
        </span>
      </div>
      <p className="mt-1.5 text-ui-xs text-fg-subtle">{body}</p>
      {state === 'off' && <p className="mt-1.5 text-ui-xs text-fg-muted">{ability!.reason}</p>}
    </Panel>
  )
}
