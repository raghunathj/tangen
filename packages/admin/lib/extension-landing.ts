/**
 * File Name: extension-landing.ts
 * Purpose: The guarantee that every extension has an admin landing page. A
 *          sidebar entry always points at /extensions/<id>; that path resolves
 *          either to the extension's OWN declared root page or, failing that,
 *          to the platform's default overview route. This module makes the
 *          resolution explicit and testable so a panel/field-type extension
 *          (like SEO) can never dead-end at a redirect again.
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * The set of admin route paths (relative to /:ws/:env) that render an
 * extension's OWN landing page — its root `extensions/<id>`. Built from the
 * site-dev app routes (ADMIN_EXTENSION.routes) and package manifest root pages
 * (EXTENSION_PAGES entries with `path: ''`).
 */
export function declaredExtensionRootPaths(
  appRoutes: { path: string }[],
  extensionPages: Record<string, { path: string }[]>,
): Set<string> {
  const roots = new Set<string>()
  for (const r of appRoutes) {
    if (/^extensions\/[^/]+$/.test(r.path)) roots.add(r.path)
  }
  for (const [extId, pages] of Object.entries(extensionPages)) {
    if (pages.some((p) => p.path === '')) roots.add(`extensions/${extId}`)
  }
  return roots
}

/**
 * How an extension's sidebar entry resolves:
 *  - `'declared'` — it ships its own root page (custom screen).
 *  - `'default'`  — no custom page, but the platform's default overview route
 *                   is mounted, so it still has a real landing page.
 *  - `'none'`     — no custom page AND no default route: the entry dead-ends.
 *                   This is the failure the default overview exists to prevent;
 *                   the enforcement test asserts it never happens in the app.
 */
export function extensionLandingKind(
  appId: string,
  declaredRoots: Set<string>,
  defaultOverviewMounted: boolean,
): 'declared' | 'default' | 'none' {
  if (declaredRoots.has(`extensions/${appId}`)) return 'declared'
  if (defaultOverviewMounted) return 'default'
  return 'none'
}

/** True when the extension's sidebar entry resolves to a real page. */
export function extensionHasLandingPage(
  appId: string,
  declaredRoots: Set<string>,
  defaultOverviewMounted: boolean,
): boolean {
  return extensionLandingKind(appId, declaredRoots, defaultOverviewMounted) !== 'none'
}
