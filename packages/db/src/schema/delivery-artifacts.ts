/**
 * File Name: delivery-artifacts.ts
 * Purpose: The delivery_artifacts table - where published Studio artifacts
 *          (page and stylesheet builds, route pointers) live.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Platform-owned on purpose: the public delivery route
 *          reads this table whether or not Studio is installed, which is the
 *          guarantee that a published page never goes down with the
 *          extension. Artifacts used to live in extension_data, the shared
 *          extension KV table, and were the wrong shape for it - immutable,
 *          never deleted, unbounded. One row per (workspace, env, path).
 *          Build rows (tangen/builds/<version>/...) are content-addressed
 *          and immutable; pointer rows (tangen/routes/<route>.json) are the
 *          one mutable thing and are upserted on publish. `body` is text:
 *          every artifact is CSS or JSON, and the content type is recorded
 *          beside it so a bucket or a CDN can serve it as-is. Migration
 *          0030 and the ensure-system-schema guard create it.
 */
import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core'

export const deliveryArtifacts = pgTable('delivery_artifacts', {
  workspaceId: text('workspace_id').notNull(),
  path: text('path').notNull(),
  body: text('body').notNull(),
  contentType: text('content_type').notNull().default('application/octet-stream'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.path], name: 'delivery_artifacts_pk' }),
])
