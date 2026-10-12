/**
 * File Name: dashboard.ts
 * Purpose: Dashboard widget and configuration types for the Tangen admin panel;
 *   covers built-in widget overrides, custom stat/table widgets, quick actions, and activity settings.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None — standalone type definitions with no runtime imports.
 */

// ─── Activity ─────────────────────────────────────────────────────────────────

/**
 * Category tag used to classify workspace activity log entries.
 */
export type ActivityCategory =
  | 'content'
  | 'schema'
  | 'members'
  | 'webhooks'
  | 'api-keys'
  | 'media'
  | 'flows'

// ─── Built-in widget IDs ──────────────────────────────────────────────────────

/**
 * Identifier for one of the built-in dashboard widgets shipped with the admin panel.
 */
export type BuiltInWidgetId =
  | 'quick-actions'
  | 'content-overview'
  | 'recent-activity'
  | 'webhook-health'
  | 'media-snapshot'
  | 'api-keys'
  | 'members'

// ─── Widget definitions ───────────────────────────────────────────────────────

/** Override display properties of a built-in widget */
export interface BuiltInWidgetOverride {
  type: 'builtin'
  id: BuiltInWidgetId
  title?: string
  description?: string
  info?: string
  hidden?: boolean
  order?: number
}

/**
 * Data source specification for a ContentStatWidget — which type and status to count.
 */
export interface ContentStatSource {
  contentType: string
  status?: string
}

/** A custom stat card that shows a count from a content type */
export interface ContentStatWidget {
  type: 'stat'
  id: string
  title: string
  description?: string
  info?: string
  /** An @tangen/icons name (e.g. 'IconBarChart') or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
  /** Admin-relative deep link - clicking the card navigates there. */
  href?: string
  source: ContentStatSource
  order?: number
}

/**
 * Column definition for a ContentTableWidget — key, label, and optional display type.
 */
export interface ContentTableColumn {
  key: string
  label: string
  displayType?: 'text' | 'status' | 'date' | 'number' | 'boolean'
}

/**
 * Data source specification for a ContentTableWidget — type, limit, sort, and status filter.
 */
export interface ContentTableSource {
  contentType: string
  limit?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  status?: string
}

/** A custom table that shows recent items from a content type */
export interface ContentTableWidget {
  type: 'table'
  id: string
  title: string
  description?: string
  info?: string
  source: ContentTableSource
  columns: ContentTableColumn[]
  order?: number
}

/**
 * Union of all dashboard widget types that can appear in DashboardConfig.widgets.
 */
export type DashboardWidget =
  | BuiltInWidgetOverride
  | ContentStatWidget
  | ContentTableWidget

// ─── Extension widget ─────────────────────────────────────────────────────────

/** Widget declared in TangenExtensionManifest — frontend fetches its own data */
/**
 * A dashboard widget contributed by an extension manifest. The frontend
 * fetches `dataPath` (admin-authenticated) and renders by `type`; the
 * response shape MUST match the declared type:
 * - 'stat'       → `{ value: number, unit?: string }`
 * - 'stat-group' → `{ stats: Array<{ label, value, unit?, tone?, href? }> }`
 * - 'table'      → `{ rows: object[], columns: Array<{ key, label }> }`
 * `tone` colors a stat's value ('success' | 'danger' | 'warning' | 'neutral');
 * `href` (admin-relative, e.g. '/extensions/flows?tab=runs') makes the stat -
 * or, at the widget level, the whole card - a deep link.
 */
export interface ExtensionDashboardWidget {
  id: string
  title: string
  description?: string
  /** An @tangen/icons name or a custom `{ src }` image - shown before the title. */
  icon?: import('./object-types').IconRef
  type: 'stat' | 'stat-group' | 'table'
  dataPath: string
  /** Admin-relative deep link for the whole card (workspace/env prefix added). */
  href?: string
  /** Hide the widget from members lacking this capability. Gate it whenever
   *  `href` points at pages the same capability protects - never show a
   *  door the member can't open. */
  capability?: string
  /**
   * Who may see this widget's DATA - the SAME access-rule shape a page uses
   * (`{ roles?, capability? }`), so gating reads the same everywhere. Owner and
   * admin always pass; otherwise a listed role or a held capability passes.
   * Omitting the key (or an empty rule) means every role.
   *
   * Unlike a page's `access` - and unlike `capability` above, which hides the
   * widget outright - a member who fails this rule still sees the widget, as a
   * "No rights to view" placeholder, and the data path is never fetched for
   * them. Use it when the card should stay on every dashboard as a locked tile.
   */
  viewPermission?: import('./admin-extension').AdminAccessRule
  defaultOrder?: number
}

/** Value tone for a stat entry in a stat-group widget's data response. */
export type StatTone = 'success' | 'danger' | 'warning' | 'neutral'

// ─── Quick actions ────────────────────────────────────────────────────────────

/** A single button in the Quick Actions widget */
export interface QuickAction {
  /** Button label shown to the user */
  label: string
  /**
   * Destination URL.
   * - Relative paths (`/objects/post/new`) are treated as admin-internal and
   *   prepended with the current workspace/env prefix.
   * - Absolute URLs (`https://…`) open in a new tab regardless of `external`.
   */
  href: string
  /** An @tangen/icons name (e.g. 'IconBarChart') or a custom `{ src }` image. */
  icon?: import('./object-types').IconRef
  /** Force open in a new tab (implied for absolute URLs) */
  external?: boolean
}

// ─── DashboardConfig ──────────────────────────────────────────────────────────

/**
 * Settings for the activity feed widget — which categories to exclude and retention period.
 */
export interface DashboardActivityConfig {
  excludeTypes?: string[]
  excludeCategories?: ActivityCategory[]
  /** Days to retain workspace_activity rows. Default 7, max 90. */
  retentionDays?: number
}

/**
 * Top-level dashboard configuration for a workspace — widgets, order, activity, and quick actions.
 */
export interface DashboardConfig {
  /** Widget definitions — built-in overrides, custom stat/table widgets */
  widgets?: DashboardWidget[]
  /** Explicit widget render order by ID. Unspecified widgets fall after listed ones. */
  order?: string[]
  /** Activity feed settings */
  activity?: DashboardActivityConfig
  /**
   * Extra quick-action buttons appended after the auto-generated schema type
   * shortcuts. Use this to add links to external tools, reports, or custom pages.
   */
  quickActions?: QuickAction[]
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Identity helper for DashboardConfig — enables TypeScript inference in workspace config files.
 */
export function defineDashboard(config: DashboardConfig): DashboardConfig {
  return config
}
