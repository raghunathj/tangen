/**
 * File Name: audit-log.ts
 * Purpose: Drizzle schema for the `audit_log` table, which records an immutable
 *          chronological trail of significant events across the workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A GIN index
 *                     on payload->>'object_id' should be applied via gin-indexes.sql.
 */
import { pgTable, text, timestamp, jsonb, index, boolean } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Append-only log of workspace events (content changes, schema pushes, member actions, etc.)
 * indexed by workspace and creation time for chronological queries.
 */
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  eventType: text('event_type').notNull(),
  eventId: text('event_id').notNull(),             // cuid2 of the event itself
  actorId: text('actor_id'),
  actorType: text('actor_type'),                   // 'member' | 'api_key' (the bus envelope's word)
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // ── The kernel's event record (K5): the row the domain operations write in their transaction ──
  /** 'member' | 'api_key' | 'system' | 'site_user' */
  actorKind: text('actor_kind'),
  initiatorId: text('initiator_id'),
  initiatorKind: text('initiator_kind'),
  /** request | job | flow | scheduler | release | porter | cli | agent */
  executionKind: text('execution_kind'),
  executionId: text('execution_id'),
  correlationId: text('correlation_id'),
  causationId: text('causation_id'),
  /** 'object' | 'media' | 'global' | ... */
  resourceKind: text('resource_kind'),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  locale: text('locale'),
  /** The transport: admin | rest | sdk | graphql | mcp | extension | scheduler | ... */
  source: text('source'),
  /** True when a domain operation wrote this row inside its transaction (false: the bus subscriber's best-effort copy). */
  recordedInTransaction: boolean('recorded_in_transaction').notNull().default(false),
}, (t) => ({
  idxWorkspace: index('audit_log_workspace').on(t.workspaceId, t.createdAt),
  idxResource: index('audit_log_resource').on(t.workspaceId, t.resourceId, t.createdAt),
  idxCorrelation: index('audit_log_correlation').on(t.correlationId),
  // Expression index on payload->>'object_id' — expressed as raw SQL because Drizzle's
  // IndexBuilderOn.on() expects column refs; a drizzle-kit migration is the canonical
  // way to add this index in production.
}))
