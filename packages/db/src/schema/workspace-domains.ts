/**
 * File Name: workspace-domains.ts
 * Purpose: Defines the `workspace_domains` table, which maps verified custom domains
 *   to their owning workspace for tenant-aware routing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; domain column has a unique constraint — one
 *   domain cannot be claimed by multiple workspaces.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

/**
 * Associates a verified custom domain with a workspace, enabling domain-based tenant
 * resolution for the API and delivery layer.
 */
export const workspaceDomains = pgTable('workspace_domains', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
