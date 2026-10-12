/**
 * File Name: context-nav.ts
 * Purpose: Contextual navigation (UI V2 spec §15). A route family such as
 *          Settings declares a CONTEXT: a title, a way back, and its own
 *          tree. While the route is inside it, the sidebar renders that tree
 *          in the same column instead of the primary tree - context replaces
 *          context, it never stacks. Pages stop rendering their own <aside>.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure and framework-free so the resolver is unit-tested
 *          without a DOM. The built-in context (workspace Settings) and
 *          settings) live here; an extension registers its own through
 *          `registerContextNav` (exported from @/kit). First matching resolver
 *          wins; registration order is extension first, built-ins last, so an
 *          extension can never be shadowed by a built-in it does not own.
 */
import type React from 'react'
import { buildSettingsNavItems, filterSettingsNavItems, isSettingsItemActive, type NavLinks } from './settings-nav'

export interface ContextNavItem {
  id: string
  label: string
  href: string
  /** A @tangen/icons name, or a rendered icon. */
  icon?: string | React.ReactNode
  /** The item's own pages, shown as a tree under it. */
  children?: ContextNavItem[]
  /** The caption this item sits under; the panel draws a caption where it changes. */
  group?: string
  /** An outside URL, opened in a new tab. */
  external?: boolean
  /** A row that does something instead of going somewhere. */
  action?: 'sign-out'
}

export interface ContextNav {
  /** Stable id of the context (`settings`, an extension's own such as `forms:settings`). */
  id: string
  /** The caption above the tree ("Settings", "Form settings"). */
  title: string
  icon?: string | React.ReactNode
  /** Where "back" goes, and what it says. */
  backHref: string
  backLabel: string
  items: ContextNavItem[]
}

export interface ContextNavInput {
  pathname: string
  workspaceId: string
  /** Capability check for items that require one; absent means everything shows. */
  hasCapability?: (capability: string) => boolean
  role?: string
  /** admin.nav.links - what Settings shows under "Other". */
  links?: NavLinks
}

export type ContextNavResolver = (input: ContextNavInput) => ContextNav | null

const registered: ContextNavResolver[] = []

/** Registers a context resolver. Returns the unregister function. */
export function registerContextNav(resolver: ContextNavResolver): () => void {
  registered.push(resolver)
  return () => {
    const i = registered.indexOf(resolver)
    if (i >= 0) registered.splice(i, 1)
  }
}

/** Test seam: how many resolvers an extension has registered. */
export function registeredContextNavCount(): number {
  return registered.length
}

const settingsContext: ContextNavResolver = ({ pathname, workspaceId, hasCapability, role, links }) => {
  const base = `/${workspaceId}/settings`
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null
  const all = buildSettingsNavItems(workspaceId, { links })
  const items = hasCapability ? filterSettingsNavItems(all, hasCapability, role) : all
  return {
    id: 'settings',
    title: 'Settings',
    icon: 'IconSettings',
    backHref: `/${workspaceId}/dashboard`,
    backLabel: 'Back to workspace',
    items: items.map((i) => ({
      id: i.id, label: i.label, href: i.href, icon: i.icon, group: i.group,
      ...(i.external ? { external: true } : {}),
      ...(i.action ? { action: i.action } : {}),
      children: i.children?.map((c) => ({ id: c.id, label: c.label, href: c.href, icon: c.icon })),
    })),
  }
}

const BUILT_IN: ContextNavResolver[] = [settingsContext]

/** The context the route is inside, or null for the primary navigation. */
export function resolveContextNav(input: ContextNavInput): ContextNav | null {
  for (const r of [...registered, ...BUILT_IN]) {
    const found = r(input)
    if (found) return found
  }
  return null
}

/** Active when the path is the item or under it. */
export function isContextItemActive(pathname: string, item: Pick<ContextNavItem, 'href'>): boolean {
  return isSettingsItemActive(pathname, { href: item.href } as never)
}

/**
 * ONE format for a section's pages: a page that declares sub-pages (header
 * tabs with hrefs) opens in the contextual sidebar, exactly as Settings
 * does, never as a second row of navigation. The header keeps only view
 * tabs (no href). Used by the sidebar when no registered resolver matched.
 */
export function contextFromPageTabs(
  config: { title?: string; icon?: React.ReactNode; tabs?: Array<{ id: string; label: string; href?: string; icon?: React.ReactNode }> } | null | undefined,
  workspaceId: string,
): ContextNav | null {
  const pages = (config?.tabs ?? []).filter((t): t is { id: string; label: string; href: string; icon?: React.ReactNode } => typeof t.href === 'string')
  if (pages.length === 0) return null
  const title = config?.title ?? pages[0]!.label
  return {
    id: `page:${title}`,
    title,
    icon: config?.icon,
    backHref: `/${workspaceId}/dashboard`,
    backLabel: 'Back to workspace',
    items: pages.map((t) => ({ id: t.id, label: t.label, href: t.href, icon: t.icon })),
  }
}

/** Among a parent's children, the one the path is on: the LONGEST matching href wins, so a child sharing the parent's own URL never stays lit on its siblings. */
export function activeChild(pathname: string, children: ContextNavItem[]): ContextNavItem | null {
  return children
    .filter((c) => isContextItemActive(pathname, c))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null
}
