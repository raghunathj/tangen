/**
 * File Name: seo-manager-nav.ts
 * Purpose: The SEO Manager's child menu (plan-seo-manager-v2 V0): one
 *          sidebar entry whose context nav lists the mockup's pages in the
 *          mockup's order. A page is listed only once its slice has shipped
 *          (`ready`), so the menu never leads to an empty screen; the old
 *          `?tab=` links of the v1 hub map onto the child paths. Pure and
 *          React-free so the nav is testable and the resolver in index.ts
 *          stays a one-liner.
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * Rows per page on the manager's own pages (Redirects, 404 Monitor). 25 is the
 * kit's list-screen default, so these read like every other full-page table.
 */
export const MANAGER_PAGE_SIZE = 25

/**
 * Rows per page inside a DASHBOARD card. A card shares the page with the
 * health ring and the coverage table, so it pages at the DataList default
 * rather than growing to a full screen of rows.
 */
export const DASHBOARD_PAGE_SIZE = 10

export interface SeoManagerNavItem {
  id: string
  label: string
  /** The page path under `extensions/seo`; '' is the root (Dashboard). */
  path: string
  /** A @tangen/icons name. */
  icon: string
  /** `planned` pages are declared here for order and tests, and hidden from the menu until their slice lands. */
  status: 'ready' | 'planned'
}

export const SEO_MANAGER_NAV: readonly SeoManagerNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '', icon: 'IconLayoutGrid', status: 'ready' },
  { id: 'analytics', label: 'Analytics', path: 'analytics', icon: 'IconBarChart', status: 'ready' },
  { id: 'titles', label: 'Titles & Meta', path: 'titles', icon: 'IconText', status: 'ready' },
  { id: 'schema', label: 'Schema', path: 'schema', icon: 'IconCode', status: 'ready' },
  { id: 'sitemap', label: 'Sitemap', path: 'sitemap', icon: 'IconFileList', status: 'ready' },
  { id: 'redirects', label: 'Redirects', path: 'redirects', icon: 'IconArrowLeftRight', status: 'ready' },
  { id: 'not-found', label: '404 Monitor', path: 'not-found', icon: 'IconWarning', status: 'ready' },
  { id: 'ai-geo', label: 'AI & GEO', path: 'ai-geo', icon: 'IconSparkles', status: 'ready' },
  { id: 'tools', label: 'Tools', path: 'tools', icon: 'IconStack', status: 'ready' },
  { id: 'settings', label: 'Settings', path: 'settings', icon: 'IconSettings', status: 'ready' },
]

/** What the menu shows. */
export const readyNav = (): SeoManagerNavItem[] => SEO_MANAGER_NAV.filter((i) => i.status === 'ready')

/** The Admin URL of one page. */
export function seoManagerHref(workspaceId: string, path: string): string {
  const base = `/${workspaceId}/extensions/seo`
  return path ? `${base}/${path}` : base
}

/** Whether a pathname is inside the SEO Manager (the context nav's own test). */
export function isSeoManagerPath(pathname: string, workspaceId: string): boolean {
  const base = seoManagerHref(workspaceId, '')
  return pathname === base || pathname.startsWith(`${base}/`)
}

const LEGACY_TABS: Record<string, string> = { overview: '', settings: 'settings', schemas: 'schema', redirects: 'redirects', sitemap: 'sitemap', geo: 'ai-geo' }

/** The child path an old `?tab=` link of the v1 hub means; null when it is not one. */
export function legacyTabPath(tab: string | null | undefined): string | null {
  return tab !== null && tab !== undefined && Object.hasOwn(LEGACY_TABS, tab) ? LEGACY_TABS[tab]! : null
}
