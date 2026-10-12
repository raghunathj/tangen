/**
 * File Name: realtime.ts
 * Purpose: The realtime_events table - the bounded replay window for the
 *          Postgres fan-out, and the row a NOTIFY receiver reads back.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R2 (tasks/plan-realtime.md section 4.4).
 *          One bigserial mints the order for every API process; `id` is
 *          the `<epoch>-<seq>` cursor a client resumes with; `data` holds
 *          ids, slugs and changed-field names, never a document. Pruned by
 *          the queue worker like rate_limit_counters; migration 0028 and
 *          the ensure-system-schema guard create it.
 */
import { pgTable, text, jsonb, bigint, bigserial, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'

export const realtimeEvents = pgTable('realtime_events', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  channel: text('channel').notNull(),
  id: text('id').notNull(),
  t: bigint('t', { mode: 'number' }).notNull(),
  type: text('type').notNull(),
  data: jsonb('data').notNull().default({}),
}, (t) => [
  index('realtime_events_channel_seq_idx').on(t.channel, t.seq),
  uniqueIndex('realtime_events_channel_id_idx').on(t.channel, t.id),
])

/**
 * The realtime_presence table (R3): one row per joined session per scope
 * channel, the session record as JSON and its expiry for the sweep.
 * Ephemeral by construction - pruned by the queue worker, never read by
 * the activity log; migration 0029 and the ensure-system-schema guard
 * create it.
 */
export const realtimePresence = pgTable('realtime_presence', {
  channel: text('channel').notNull(),
  sessionId: text('session_id').notNull(),
  data: jsonb('data').notNull().default({}),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.channel, t.sessionId] }),
  index('realtime_presence_expires_idx').on(t.expiresAt),
])
