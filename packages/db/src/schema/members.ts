/**
 * File Name: members.ts
 * Purpose: Drizzle schema for the `members` and `refresh_tokens` tables, which store
 *          workspace admin accounts and their session refresh tokens respectively.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Members are the human operators of the CMS admin UI, distinct
 *                     from end-users stored in auth_users. passwordHash uses argon2id
 *                     (see seed/skeleton.ts). refresh_tokens supports revocation via
 *                     revokedAt; expired/revoked tokens should be pruned periodically.
 */
import { pgTable, text, timestamp, unique, index } from 'drizzle-orm/pg-core'

/**
 * Stores workspace admin member accounts with email/password credentials and role;
 * email must be unique within a workspace.
 */
export const members = pgTable('members', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  email: text('email').notNull(),
  name: text('name'),
  /** Job title shown on the profile / member list (self-editable). */
  designation: text('designation'),
  /** Avatar image URL (self-editable). Members are workspace-scoped, so a plain
   *  URL avoids the env-scoped media coupling. */
  avatar: text('avatar'),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('editor'),
  /** 'active' | 'suspended' — suspended members cannot log in or refresh. */
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => ({
  uniqWorkspaceEmail: unique().on(t.workspaceId, t.email),
}))

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => members.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({
  memberIdx: index('refresh_tokens_member_idx').on(t.memberId),
}))
