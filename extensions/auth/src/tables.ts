/**
 * File Name: tables.ts
 * Purpose: The extension's own tables, as drizzle handles over the deployment
 *          database `ctx.db` provides. Created by ./migrations.ts where the
 *          extension is installed; core declares none of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Profile fields are real columns on auth_users that the
 *          push hook adds (./push.ts); they are read by name, never declared
 *          here.
 */
import { sql } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const authUsers = pgTable('auth_users', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  email: text('email'),
  /** E.164, for one-time codes by SMS. */
  phone: text('phone'),
  name: text('name'),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('user'),
  status: text('status').notNull().default('active'),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => ({
  workspaceIdx: index('auth_users_workspace_idx').on(t.workspaceId),
  anonIdx: index('auth_users_anon_idx').on(t.workspaceId, t.isAnonymous),
  uniqueEmail: uniqueIndex('auth_users_workspace_email_idx').on(t.workspaceId, t.email).where(sql`${t.email} IS NOT NULL`),
  uniquePhone: uniqueIndex('auth_users_workspace_phone_idx').on(t.workspaceId, t.phone).where(sql`${t.phone} IS NOT NULL`),
}))

export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('auth_sessions_user_idx').on(t.userId),
  workspaceIdx: index('auth_sessions_workspace_idx').on(t.workspaceId),
}))

/** Which sign-in methods a user has: 'password', 'otp', or an SSO provider's name. */
export const authIdentities = pgTable('auth_identities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  /** The email or phone for password/otp; the provider's subject for SSO. */
  providerUserId: text('provider_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userProviderUniq: uniqueIndex('auth_identities_user_provider_idx').on(t.userId, t.provider),
  providerUidUniq: uniqueIndex('auth_identities_provider_uid_idx').on(t.workspaceId, t.provider, t.providerUserId),
  userIdx: index('auth_identities_user_idx').on(t.userId),
}))

/** An SSO provider's tokens for a user, encrypted at rest (./token-crypto.ts). */
export const authSsoAccounts = pgTable('auth_sso_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueProviderUser: uniqueIndex('auth_sso_accounts_provider_user_idx').on(t.workspaceId, t.provider, t.providerUserId),
}))

/**
 * Short-lived secrets the flows hand out and take back: one-time codes,
 * password reset tokens, SSO state. Hashed, expiring, consumed once; the
 * hourly sweep drops what expired. No Redis needed.
 */
export const authChallenges = pgTable('auth_challenges', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** 'otp' | 'password_reset' | 'sso_state' */
  kind: text('kind').notNull(),
  /** Who it is for: an email, a phone, a user id; the state itself for SSO. */
  subject: text('subject').notNull(),
  secretHash: text('secret_hash').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  attempts: text('attempts').notNull().default('0'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subjectIdx: index('auth_challenges_subject_idx').on(t.workspaceId, t.kind, t.subject),
  expiresIdx: index('auth_challenges_expires_idx').on(t.expiresAt),
}))
