/**
 * File Name: extension-pages.ts
 * Purpose: Pure helpers for the extension `pages:` surface — route path
 *          construction and sidebar nav derivation. The router and sidebar
 *          consume these; EXTENSION_PAGES itself comes from the
 *          virtual:tangen/extension-panels build-time module.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Kept free of React/store imports so the logic is
 *          unit-testable. Contract: when an extension declares ANY page nav
 *          entries, they replace the automatic sidebar app entry for that
 *          extension (the developer takes over their nav).
 */
import type { AdminNavEntry, AdminAccessRule, IconValue } from '@tangen/types'

export interface ResolvedExtensionPage {
  path: string
  component: unknown
  nav?: AdminNavEntry
  access?: AdminAccessRule
}

/** Router path (relative to /:ws/:env/) for an extension page. '' mounts the extension root. */
export function extensionPageRoutePath(extensionId: string, pagePath: string): string {
  return pagePath ? `extensions/${extensionId}/${pagePath}` : `extensions/${extensionId}`
}

export interface ExtensionPageNavItem {
  extensionId: string
  /** Path relative to /:ws/:env/ (extensionPageRoutePath output). */
  path: string
  label: string
  icon?: IconValue
  order: number
  access?: AdminAccessRule
  /** Target sidebar section ('extensions' default; 'ai' joins the AI section). */
  section?: string
}

/**
 * Derives sidebar nav items from resolved extension pages.
 * Only installed extensions contribute; only pages with `nav` appear.
 * Access filtering (roles/capability + member extension allow-list) is the
 * caller's job — it needs the me-bundle.
 */
export function extensionPageNavItems(
  pages: Record<string, ResolvedExtensionPage[]>,
  installedIds: string[],
): ExtensionPageNavItem[] {
  const installed = new Set(installedIds)
  const out: ExtensionPageNavItem[] = []
  for (const [extensionId, extPages] of Object.entries(pages)) {
    if (!installed.has(extensionId)) continue
    for (const page of extPages) {
      if (!page.nav) continue
      out.push({
        extensionId,
        path: extensionPageRoutePath(extensionId, page.path),
        label: page.nav.label,
        icon: page.nav.icon,
        order: page.nav.order ?? 100,
        access: page.access,
        section: page.nav.section,
      })
    }
  }
  return out.sort((a, b) => a.order - b.order)
}

export interface ExtensionNavTree {
  extensionId: string
  /** The extension's root page nav (path: ''). */
  root: ExtensionPageNavItem
  /** Sub-page nav entries, order-sorted — rendered as the second level. */
  children: ExtensionPageNavItem[]
}

/**
 * Second-level sidebar shape: when an extension declares nav on its root
 * page (path: ''), sub-page nav entries nest under it as an expandable
 * group (the taxonomy pattern). Extensions declaring nav only on sub-pages
 * stay flat top-level entries.
 */
export function extensionPageNavTrees(
  pages: Record<string, ResolvedExtensionPage[]>,
  installedIds: string[],
): { trees: ExtensionNavTree[]; topLevel: ExtensionPageNavItem[] } {
  const flat = extensionPageNavItems(pages, installedIds)
  const byExt = new Map<string, ExtensionPageNavItem[]>()
  for (const item of flat) {
    const list = byExt.get(item.extensionId) ?? []
    list.push(item)
    byExt.set(item.extensionId, list)
  }

  const trees: ExtensionNavTree[] = []
  const topLevel: ExtensionPageNavItem[] = []
  for (const [extensionId, items] of byExt) {
    const rootPath = extensionPageRoutePath(extensionId, '')
    const root = items.find((i) => i.path === rootPath)
    if (root) {
      // Pages targeting a DIFFERENT sidebar section (e.g. section: 'ai')
      // escape the tree — they join that section as top-level entries
      const rest = items.filter((i) => i !== root)
      trees.push({ extensionId, root, children: rest.filter((i) => (i.section ?? root.section) === root.section) })
      topLevel.push(...rest.filter((i) => (i.section ?? root.section) !== root.section))
    } else {
      topLevel.push(...items)
    }
  }
  trees.sort((a, b) => a.root.order - b.root.order)
  topLevel.sort((a, b) => a.order - b.order)
  return { trees, topLevel }
}

/**
 * Extensions whose automatic sidebar app entry should be suppressed because
 * their pages take over the nav (any page with a `nav` declaration).
 */
export function extensionsWithOwnNav(pages: Record<string, ResolvedExtensionPage[]>): Set<string> {
  const out = new Set<string>()
  for (const [extensionId, extPages] of Object.entries(pages)) {
    if (extPages.some((p) => p.nav)) out.add(extensionId)
  }
  return out
}
