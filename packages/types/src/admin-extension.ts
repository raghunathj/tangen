/**
 * File Name: admin-extension.ts
 * Purpose: Types for registering custom admin panel pages and sidebar nav entries
 * via the AdminExtension object in tangen.config.ts or an extension manifest.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ./admin-ui (AdminUIComponent)
 */
import type { AdminUIComponent } from './admin-ui'
import type { RoleSlug } from './registry'

/**
 * A page-level component — no props injected; use React Router's useParams() for URL segments.
 * Defined without a React import so @tangen/types stays framework-agnostic;
 * React.ComponentType satisfies this type structurally.
 */
export type AdminPageComponent = () => unknown

/** Sidebar navigation entry injected by a custom admin route or extension. */
export interface AdminNavEntry {
  label: string
  /** An @tangen/icons name (e.g. 'IconPuzzle') or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
  /** Which sidebar section to inject into. Default: 'extensions'.
   *  'root' renders as a top-level item directly after Media, outside any section. */
  section?: 'content' | 'extensions' | 'workspace' | 'ai' | 'devspace' | 'root'
  /** Sort order within the section. Lower = higher. Default: 100. */
  order?: number
}

/** A custom page entry injected into the admin panel router. */
/**
 * Access rule for admin extension surfaces. Owner/admin sessions always
 * pass. Other members pass when their effective role (built-in name or
 * custom slug) is listed, or when they hold the capability.
 */
export interface AdminAccessRule {
  roles?: RoleSlug[]
  capability?: string
}

export interface AdminRouteEntry {
  /**
   * Path relative to /:workspaceId/:env/ — may include React Router params.
   * E.g. 'extensions/pincodes' → /:workspaceId/:env/extensions/pincodes
   * Must not start with '/'.
   */
  path: string
  /** Page-level component. Gets no injected props — use useParams() for URL segments. */
  component: AdminPageComponent
  /** When present, a nav entry is injected into the sidebar. */
  nav?: AdminNavEntry
  /** Who can open this page — others get the No-permission state and lose the nav item. */
  access?: AdminAccessRule
}

/** Extension contribution point for the admin panel — components and custom routes. */
export interface AdminExtension {
  /** Bulk action / modal components — slug → component. */
  components?: Record<string, AdminUIComponent>
  /** Custom pages to inject into the admin router. */
  routes?: AdminRouteEntry[]
}
