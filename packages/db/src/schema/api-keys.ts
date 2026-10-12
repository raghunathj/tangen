/**
 * File Name: api-keys.ts
 * Purpose: Drizzle schema for the `api_keys` table, which stores hashed API credentials
 *          used by external clients to authenticate against the Tangen REST/GraphQL APIs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Keys are stored as SHA-256 hashes (keyHash); only the prefix is
 *                     stored in plaintext for display. An index on keyHash enables fast
 *                     lookup during request authentication.
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Stores hashed API keys scoped to a workspace and environment, with permission
 * grants, optional expiry, and revocation tracking.
 */
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  label: text('label').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  permissions: jsonb('permissions').notNull().default(sql`'{}'`),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  /** The identity this key is a credential of (K8); null for a key that acts as itself. */
  identityId: text('identity_id'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({
  keyHashIdx: index('api_keys_key_hash_idx').on(t.keyHash),
  identityIdx: index('api_keys_identity_idx').on(t.identityId),
}))
