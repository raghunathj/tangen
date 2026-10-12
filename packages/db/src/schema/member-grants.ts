/**
 * File Name: member-grants.ts
 * Purpose: Drizzle schema for `member_grants` - per-member ADDITIVE permission
 *          grants layered on top of a member's role (extra admin capabilities
 *          and extra extension-page access). One row per member; a row in this
 *          database is a grant in THIS deployment (environments are removed, so
 *          the database boundary is the environment boundary).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Grants only ever ADD - they never remove a role right
 *          (see tasks/plan-per-user-grants.md). `capabilities` and `extensions`
 *          are string arrays (Capability[] / ExtensionId[]). `expires_at` is an
 *          optional time-box; an expired grant is ignored at read time.
 */
import { pgTable, text, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core'

export const memberGrants = pgTable('member_grants', {
  workspaceId: text('workspace_id').notNull(),
  memberId: text('member_id').notNull(),
  /** Extra admin-area capabilities (Capability[]). */
  capabilities: jsonb('capabilities').notNull().default([]),
  /** Extra extension-page ids this member may open (ExtensionId[]). */
  extensions: jsonb('extensions').notNull().default([]),
  /** Member id of whoever granted it, for provenance. */
  grantedBy: text('granted_by'),
  reason: text('reason'),
  /** Optional expiry; a past value means the grant no longer applies. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.memberId] }),
}))
