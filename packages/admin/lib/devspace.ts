/**
 * File Name: devspace.ts
 * Purpose: The Devspace access rule in one place — the developer-reference
 *          section (Schema, Kitchen Sink, the REST + GraphQL playgrounds)
 *          is for owners and admins only. Both the sidebar block and the
 *          page guards import this so the nav and the route can never drift.
 *
 * Author: Raghunath J
 * License: MIT
 */

/** Roles allowed into Devspace — an impersonation/introspection surface. */
export const DEVSPACE_ROLES = ['owner', 'admin', 'superadmin'] as const

/** True when the member's effective role may see/use Devspace. */
export function canAccessDevspace(role: string | null | undefined): boolean {
  return role != null && (DEVSPACE_ROLES as readonly string[]).includes(role)
}

export interface DevspaceNavEntry {
  /** Absolute route path. */
  path: string
  label: string
  /** @tangen/icons export name (resolved by DynamicIcon). */
  icon: string
  /** Pages nested under this entry (rendered as an expandable parent). */
  children?: DevspaceNavEntry[]
}

/** Every entry, parents and children alike, in nav order. */
export function flattenDevspacePages(entries: DevspaceNavEntry[]): DevspaceNavEntry[] {
  return entries.flatMap((e) => [e, ...(e.children ?? [])])
}

/**
 * The platform (non-extension) nav entries for the Devspace section. `base`
 * is `/<workspaceId>/<env>`. Schema keeps its own `/schema` route — only its
 * nav home moves here. The GraphQL entry appears only when GraphQL is enabled
 * for the environment (per-entry enablement).
 */
export function devspacePlatformPages(input: { base: string; graphqlEnabled?: boolean }): DevspaceNavEntry[] {
  const { base } = input
  // No Overview (the user, 2026-09-12): it was a grid of cards linking to the
  // entries below, a hub with nothing of its own. /devspace redirects to Schema.
  return [
    { path: `${base}/schema`, label: 'Schema', icon: 'IconCode' },
    // REST Playground — moved here from Settings (owner/admin only). Its route
    // now lives under Devspace; /settings/playground redirects for old links.
    // PG-1: one merged entry — REST and GraphQL live inside the playground takeover.
    { path: `${base}/devspace/playground`, label: 'API Playground', icon: 'IconPlayCircle' },
    // Telemetry - what has been HAPPENING - with the Performance Monitor
    // (what one request did; route slug stays query-monitor for old links)
    // nested under it: one developer-observability entry, two pages.
    {
      path: `${base}/devspace/telemetry`, label: 'Telemetry', icon: 'IconHistory',
      children: [{ path: `${base}/devspace/query-monitor`, label: 'Performance Monitor', icon: 'IconBarChart' }],
    },
  ]
}
