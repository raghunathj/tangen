/**
 * File Name: api-resources.ts
 * Purpose: The API manager's discovery contract — how custom routes and
 * site/extension code declare named, key-gated resources that appear in
 * the admin's API-key permission UI.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Served by GET /api/v1/route-resources as
 * `{ groups: RouteResourceGroup[], features: FeatureResource[] }`. Groups
 * come from inline CustomRoute.apiGroup declarations; features come from
 * built-in platform resources (Forms) and site-declared ApiResourceDefinitions.
 */

/** A custom-route permission group discovered from CustomRoute.apiGroup. */
export interface RouteResourceGroup {
  id: string
  label: string
  description?: string
  actions: string[]
}

/** A selectable item inside a feature resource (e.g. one form). */
export interface ApiResourceItem {
  id: string
  name: string
  slug?: string
  /** Present when the item is environment-scoped (built-in Forms sets it). */
}

/**
 * A feature resource shown in the API manager with optional per-item
 * scoping — keys can be granted actions on all items or specific ones.
 */
export interface FeatureResource {
  id: string
  label: string
  /** Set when the resource is an extension's `apiKeyScope`; its grants live under `permissions.extensions[id]`. */
  extensionId?: string
  description?: string
  actions: string[]
  items: ApiResourceItem[]
}

/** Context handed to an ApiResourceDefinition items loader. */
export interface ApiResourceItemsContext {
  workspaceId: string
  /** Drizzle database instance — cast to your schema types in site code. */
  db: unknown
}

/**
 * A key-gated resource declared by site or extension code via
 * defineApiResource(). Registered through TangenConfig.apiResources, it
 * appears in the API manager automatically; routes reference it with the
 * apiGroup string shorthand (`apiGroup: '<id>'`).
 */
export interface ApiResourceDefinition {
  /** Permission key — stored under permissions.customRoutes[id]. Slug-safe. */
  id: string
  /** Display name in the API manager. */
  label: string
  description?: string
  /** Actions a key can be granted, e.g. ['read', 'write'] or ['Search']. */
  actions: string[]
  /**
   * Optional item loader — when present, the API manager offers "all items
   * or specific items" scoping (per-item grants live in
   * permissions.resources[id]). Failures are logged and yield no items.
   */
  items?: (ctx: ApiResourceItemsContext) => Promise<ApiResourceItem[]> | ApiResourceItem[]
}
