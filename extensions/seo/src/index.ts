/**
 * File Name: index.ts
 * Purpose: The SEO extension's client entry - what the Admin's extension
 *          registry resolves panel and page components from, and what a site
 *          developer imports to declare its URL boundary.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { registerContextNav } from '@/kit'
import { isSeoManagerPath, readyNav, seoManagerHref } from './lib/seo-manager-nav'

export * from './contract'
export * from './lib/seo-analysis'
export { SeoPanel } from './components/SeoPanel'
export type { SeoPanelProps } from './components/SeoPanel'
export { SeoManagerPage } from './pages/SeoManagerPage'
export { SeoAnalyticsPage } from './pages/AnalyticsTab'
export { SeoNotFoundPage } from './pages/NotFoundTab'
export { SeoTitlesPage } from './pages/TitlesTab'
export { SeoToolsPage } from './pages/ToolsTab'
export { SeoSchemaPage, SeoSitemapPage, SeoRedirectsPage, SeoSettingsPage } from './pages/manager-pages'
export { SeoAiGeoPage } from './pages/AiGeoTab'
export { RedirectsPanel } from './pages/redirects'
export { SettingsPanel } from './pages/SettingsTab'
export { SchemasPanel } from './pages/SchemasTab'

// The SEO Manager is one sidebar entry; inside it the sidebar becomes its own
// menu (plan-seo-manager-v2 V0), the pattern Forms uses. Only shipped pages
// are listed; each later slice adds its own in lib/seo-manager-nav.ts.
registerContextNav(({ pathname, workspaceId }) => {
  if (!isSeoManagerPath(pathname, workspaceId)) return null
  return {
    id: 'seo',
    title: 'SEO Manager',
    icon: 'IconSearch',
    backHref: `/${workspaceId}/dashboard`,
    backLabel: 'Back to workspace',
    items: readyNav().map((i) => ({ id: i.id, label: i.label, href: seoManagerHref(workspaceId, i.path), icon: i.icon })),
  }
})
