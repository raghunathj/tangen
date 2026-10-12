/**
 * File Name: workspace-activity.ts
 * Purpose: Defines the `workspace_activity` table, which is an append-only audit log
 *   recording significant actions taken by members or API keys across a workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm/pg-core; actor and object fields are denormalized at
 *   write time so the log remains readable even after records are deleted.
 */
import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Append-only audit log entry capturing who did what, on which object, via which
 * interface (admin, REST, GraphQL, SDK) within a workspace or environment.
 */
export const workspaceActivity = pgTable('workspace_activity', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  category: text('category').notNull(),      // 'content' | 'schema' | 'members' | 'webhooks' | 'api-keys' | 'media'
  action: text('action').notNull(),          // 'created' | 'published' | 'unpublished' | 'deleted' | 'scheduled' | 'pushed' | 'invited' | 'revoked' | 'uploaded' | 'updated'
  actorId: text('actor_id'),
  actorName: text('actor_name'),             // denormalized at write time
  actorType: text('actor_type'),             // 'member' | 'api_key'
  source: text('source').notNull().default('admin'),  // 'admin' | 'rest' | 'graphql' | 'sdk'
  typeName: text('type_name'),               // content type slug, e.g. 'post'
  objectId: text('object_id'),
  objectTitle: text('object_title'),
  targetLabel: text('target_label'),         // human label: webhook name, member email, api key label
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxWorkspaceCreated: index('workspace_activity_workspace_created').on(t.workspaceId, t.createdAt),
  idxCreated: index('workspace_activity_created').on(t.createdAt),
}))
