/**
 * File Name: entity-tags.ts
 * Purpose: System tags — a single polymorphic table holding free-form tags for ANY
 *   entity (content records, form submissions, members, media). One queryable place
 *   so admin users, extensions, the API, and MCP can all tag + filter uniformly,
 *   without a per-entity column/migration. Env-scoped (instances are env-scoped).
 *   `entity_type` is namespaced: 'content:<typeName>' | 'submission' | 'member' |
 *   'media'. `source` records who added it ('user' | 'system' | 'ext:<id>' | ...).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core'

export const entityTags = pgTable('entity_tags', {
  workspaceId: text('workspace_id').notNull(),
  /** 'content:<typeName>' | 'submission' | 'member' | 'media' */
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  /** Normalized tag (trim + collapsed whitespace). */
  tag: text('tag').notNull(),
  /** Who added it: 'user' | 'system' | 'ext:<id>' | 'mcp' | 'api'. */
  source: text('source').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Member id / key id / null (audit). */
  createdBy: text('created_by'),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.entityType, t.entityId, t.tag] }),
  // filter a type by tag + distinct-tag autocomplete
  filterIdx: index('entity_tags_filter_idx').on(t.workspaceId, t.entityType, t.tag),
  // list one entity's tags / batch-list for a list view
  entityIdx: index('entity_tags_entity_idx').on(t.workspaceId, t.entityType, t.entityId),
}))
