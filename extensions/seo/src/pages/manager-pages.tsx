/**
 * File Name: manager-pages.tsx
 * Purpose: The SEO Manager's child pages (plan-seo-manager-v2 V0): each is
 *          one AdminPage around a panel the v1 hub used to show behind a tab,
 *          on its own URL so the context nav, the command palette and a
 *          bookmark all reach it directly. Behaviour lives in the panels.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdminPage } from '@/kit'
import type { AdminPageProps } from '@/kit'
import { RedirectsPanel } from './redirects'
import { SettingsPanel } from './SettingsTab'
import { SchemasPanel } from './SchemasTab'
import { SitemapPanel } from './SitemapTab'

function ManagerPage({ title, description, width, children }: { title: string; description: string; width?: AdminPageProps['width']; children: ReactNode }) {
  return (
    <AdminPage title={title} description={description} width={width} access={{ capability: 'seo:read' }}>
      {children}
    </AdminPage>
  )
}

export function SeoSchemaPage() {
  return <ManagerPage title="Schema" description="Structured data per content type: the schema.org kind and which fields fill it."><SchemasPanel /></ManagerPage>
}
export function SeoSitemapPage() {
  return <ManagerPage title="Sitemap" description="What the sitemap serves, what it skipped, and the URL to submit to search engines."><SitemapPanel /></ManagerPage>
}
export function SeoRedirectsPage() {
  // `?source=` arrives from the 404 Monitor: open the form with that path filled in.
  const [params] = useSearchParams()
  return (
    <ManagerPage title="Redirects" description="Old addresses that still work. Tangen stores the rule; your site performs the redirect.">
      <RedirectsPanel initialSource={params.get('source') ?? undefined} />
    </ManagerPage>
  )
}
export function SeoSettingsPage() {
  // `form` centres the column: settings read as a stack of cards down the middle of the page.
  return <ManagerPage title="Settings" description="The defaults an editor changes without a code deploy, stored per workspace." width="form"><SettingsPanel /></ManagerPage>
}
