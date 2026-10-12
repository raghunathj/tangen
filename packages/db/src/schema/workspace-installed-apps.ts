/**
 * File Name: workspace-installed-apps.ts
 * Purpose: The extension installation state, one row per workspace x
 *          environment x extension (closure plan Phase 4, Unit 1): whether
 *          it is installed or retired, enabled, at which version, and when
 *          it was installed, upgraded or uninstalled. The row is the INSTALL
 *          / ENABLE / UPGRADE / UNINSTALL truth; the runtime registry reads
 *          it, never a second source.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Migration 0045 adds the environment scope and adopts
 *          the workspace-wide rows that existed before it: one row per
 *          environment of the workspace (from `environments`), enabled,
 *          version unknown until the first boot records the manifest's.
 *          `state` is `installed` or `uninstalled`; an uninstalled row is
 *          the tombstone that keeps retained extension data diagnosable and
 *          lets a reinstall adopt it. Uniqueness is (workspace, env, app).
 */
import { pgTable, text, timestamp, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const workspaceInstalledApps = pgTable(
  'workspace_installed_apps',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** The environment this installation belongs to (`env_<slug>`). */
    appId: text('app_id').notNull(),
    options: jsonb('options').notNull().default(sql`'{}'`),
    /** `installed` | `uninstalled` (retired; data retained, diagnosable, adoptable). */
    state: text('state').notNull().default('installed'),
    /** ENABLE: may contribute active behaviour in this environment. */
    enabled: boolean('enabled').notNull().default(true),
    /** The extension version this installation runs; null until recorded. */
    version: text('version'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    installedBy: text('installed_by'),
    upgradedAt: timestamp('upgraded_at', { withTimezone: true }),
    uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
    /** K5.2a: the grants an operator approved (JSON array); NULL = not reviewed, the manifest's required grants apply. */
    grantedGrants: jsonb('granted_grants'),
  },
  (t) => ({
    uniqueWorkspaceApp: uniqueIndex('workspace_installed_apps_ws_app_unique').on(t.workspaceId, t.appId),
  }),
)
