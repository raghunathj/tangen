/**
 * File Name: roles.ts
 * Purpose: Drizzle schema for the `roles` table — workspace-defined custom
 *          member roles. members.role references a role's slug (or a built-in
 *          role name); permissions holds a MemberPermissions bundle.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: slug is the stable identifier (unique per workspace) —
 *          field-level access lists and env-role overrides reference slugs,
 *          never DB ids, so code-first configs survive environment moves.
 */
import { pgTable, text, timestamp, jsonb, unique } from 'drizzle-orm/pg-core'

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  permissions: jsonb('permissions').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqWorkspaceSlug: unique().on(t.workspaceId, t.slug),
}))
