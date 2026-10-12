/**
 * File Name: connections.ts
 * Purpose: The `connections` table (Extension Kernel K6.1): an operator's
 *          credentials for a connector, per workspace, sealed at rest. The
 *          API reads and writes it through services/connections.ts only.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const connections = pgTable(
  'connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** `ext:<extension>/<connector>`. */
    connectorId: text('connector_id').notNull(),
    label: text('label').notNull(),
    /** `oauth2` | `apiKey` | `basic`. */
    kind: text('kind').notNull(),
    /** The sealed envelope (`v1.<iv>.<tag>.<data>`), never plaintext. */
    secret: text('secret').notNull(),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    /** `active` | `revoked` | `unreadable`. */
    status: text('status').notNull().default('active'),
    health: jsonb('health'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  },
  (t) => ({ workspaceConnector: index('connections_workspace_connector_idx').on(t.workspaceId, t.connectorId) }),
)
