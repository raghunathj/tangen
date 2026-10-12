/**
 * File Name: settings-nav.ts
 * Purpose: Settings navigation - the ordered, grouped list of settings pages
 *   and which one is active.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One Settings (2026-09-07), grouped the way the benchmark
 *   groups it: **User** holds what belongs to the person signed in (Profile,
 *   Preferences) and needs no capability; **Workspace** holds configuration,
 *   each page behind its capability; **Other** holds the way out and the way
 *   to help - Help & Support and Documentation (Tangen's own pages unless the
 *   workspace points them elsewhere with `admin.nav.links`), and Sign out.
 *   Globals are content and live under the Content section, not here.
 */

export type SettingsNavGroup = 'User' | 'Workspace' | 'Other'

export interface NavLinks { support?: string; docs?: string }

/** Where Help & Support and Documentation go unless the workspace says otherwise (admin.nav.links). */
export const DEFAULT_NAV_LINKS: Required<NavLinks> = {
  support: 'https://tangen.app/support',
  docs: 'https://docs.tangen.app',
}

export interface SettingsNavItem {
  id: string
  label: string
  /** Where it goes. Empty for an action row (`action` says what it does). */
  href: string
  icon: string
  /** The caption the item sits under. */
  group: SettingsNavGroup
  /** Capability required to see this item (absent = everyone). */
  capability?: string
  /** Member roles allowed to see this item (absent = capability/everyone governs). */
  roles?: string[]
  /** The item's own pages, each with a URL, shown as a tree under it (Jobs: Schedules, Runs). */
  children?: Array<{ id: string; label: string; href: string; icon?: string }>
  /** An outside URL, opened in a new tab. */
  external?: true
  /** A row that does something instead of going somewhere. */
  action?: 'sign-out'
}

/** The groups in the order they are drawn. */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = ['User', 'Workspace', 'Other']

/**
 * Returns the list of settings nav items with resolved hrefs for the given workspace.
 * @param workspaceId - The workspace identifier used to build href paths
 * @param opts.links - admin.nav.links, as the bootstrap read carries them
 * @returns Ordered array of SettingsNavItem objects for the settings sidebar
 */
export function buildSettingsNavItems(workspaceId: string, opts: { links?: NavLinks } = {}): SettingsNavItem[] {
  const base = `/${workspaceId}/settings`
  // The workspace's links override the defaults key by key; an absent key keeps Tangen's page.
  const links: Required<NavLinks> = { ...DEFAULT_NAV_LINKS }
  for (const key of ['support', 'docs'] as const) { const v = opts.links?.[key]; if (v) links[key] = v }
  return [
    // User - the person signed in. No capability: everyone has a profile.
    { id: 'profile', label: 'Profile', href: `${base}/profile`, icon: 'IconUser', group: 'User' },
    { id: 'preferences', label: 'Preferences', href: `${base}/preferences`, icon: 'IconSun', group: 'User' },
    // Workspace - configuration, each page behind its capability.
    { id: 'workspace', label: 'General', href: `${base}/workspace`, icon: 'IconBuilding', group: 'Workspace', capability: 'manage:settings' },
    { id: 'members', label: 'Members', href: `${base}/members`, icon: 'IconUsers', group: 'Workspace', capability: 'manage:members' },
    { id: 'api-keys', label: 'API Manager', href: `${base}/api-keys`, icon: 'IconKey', group: 'Workspace', capability: 'manage:apiKeys' },
    // API Playground moved to Devspace (owner/admin only). /settings/playground redirects there.
    { id: 'webhooks', label: 'Webhooks', href: `${base}/webhooks`, icon: 'IconWebhook', group: 'Workspace', capability: 'manage:webhooks' },
    { id: 'search', label: 'Search', href: `${base}/search`, icon: 'IconSearch', group: 'Workspace', capability: 'manage:settings' },
    // Extension Kernel K6.2: an operator's connections to outside services, offered by the extensions' connectors.
    { id: 'connections', label: 'Connections', href: `${base}/connections`, icon: 'IconLink', group: 'Workspace', capability: 'manage:settings' },
    // Extension Kernel K7.1 (E.17): the generated settings form of every installed extension that declares settings - reachable
    // here whatever the extension's own pages do (an extension with a root page shadows its overview).
    { id: 'extensions', label: 'Extensions', href: `${base}/extensions`, icon: 'IconPuzzle', group: 'Workspace', capability: 'manage:settings' },
    {
      id: 'jobs', label: 'Jobs & Cron', href: `${base}/jobs`, icon: 'IconClock', group: 'Workspace', capability: 'manage:cron',
      children: [
        { id: 'jobs-schedules', label: 'Schedules', href: `${base}/jobs`, icon: 'IconClock' },
        { id: 'jobs-runs', label: 'Runs', href: `${base}/jobs/runs`, icon: 'IconHistory' },
      ],
    },
    { id: 'cache', label: 'Cache', href: `${base}/cache`, icon: 'IconDatabase', group: 'Workspace', capability: 'manage:settings' },
    { id: 'ai', label: 'AI', href: `${base}/ai`, icon: 'IconSparkles', group: 'Workspace', capability: 'manage:aiSettings' },
    // Read-only: the resolved configuration of this environment with its provenance (Stage 5).
    { id: 'config', label: 'Configuration', href: `${base}/config`, icon: 'IconSettings', group: 'Workspace', capability: 'manage:settings' },
    // Other - help, and the way out.
    { id: 'support', label: 'Help & Support', href: links.support, icon: 'IconQuestion', group: 'Other', external: true },
    { id: 'docs', label: 'Documentation', href: links.docs, icon: 'IconBookOpen', group: 'Other', external: true },
    { id: 'sign-out', label: 'Sign out', href: '', icon: 'IconLogout', group: 'Other', action: 'sign-out' },
  ]
}

/** Filters nav items to those the current member's capabilities allow. */
export function filterSettingsNavItems(
  items: SettingsNavItem[],
  hasCapability: (cap: string) => boolean,
  role?: string,
): SettingsNavItem[] {
  return items.filter((i) => {
    if (i.roles) return role != null && i.roles.includes(role)
    return !i.capability || hasCapability(i.capability)
  })
}

/** The items under their captions, in group order; a group with nothing left is dropped. */
export function groupSettingsNavItems(items: SettingsNavItem[]): Array<{ group: SettingsNavGroup; items: SettingsNavItem[] }> {
  return SETTINGS_NAV_GROUPS
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0)
}

/**
 * Returns true when the current pathname matches or is a descendant of the nav item's href.
 * An action row or an outside link is never the active page.
 * @param pathname - The current page pathname
 * @param item - The nav item to test for active state
 * @returns Whether this settings nav item should be highlighted as active
 */
export function isSettingsItemActive(pathname: string, item: Pick<SettingsNavItem, 'href'> & { external?: boolean; action?: string }): boolean {
  if (!item.href || item.external || item.action) return false
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
