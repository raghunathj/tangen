/**
 * File Name: porter-transfer.ts
 * Purpose: Arc R gatekeeper storage. Transfer CODES are the human front
 *   door (single-use, short TTL, hashed at rest - the receiving admin
 *   reads one out to the sender); transfer TOKENS are what a redeemed code
 *   becomes (scoped to porter ingest endpoints and ONE run, never admin
 *   access). Both are directional: they grant write-IN only.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'

export const porterTransferCodes = pgTable('porter_transfer_codes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** The RECEIVING environment the code grants write-in to. */
  /** sha256 of the normalized code - the plaintext exists only in the
   *  generating response and the receiver's screen. */
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
}, (t) => ({
  hashIdx: index('porter_codes_hash_idx').on(t.codeHash),
  workspaceIdx: index('porter_codes_workspace_idx').on(t.workspaceId),
}))

export const porterTransferTokens = pgTable('porter_transfer_tokens', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  /** The code this token was redeemed from (audit trail). */
  codeId: text('code_id').notNull(),
  /** The ONE receiver-side run this token is allowed to feed (set when the
   *  transfer starts; a token never feeds two runs). */
  runId: text('run_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Sender-declared audit info ({url, label} - informational only). */
  senderInfo: jsonb('sender_info').notNull().default({}),
}, (t) => ({
  hashIdx: index('porter_tokens_hash_idx').on(t.tokenHash),
}))
