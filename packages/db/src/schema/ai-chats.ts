/**
 * File Name: ai-chats.ts
 * Purpose: Drizzle schema for the `ai_chats` table — Gen AI conversation
 *          threads. A member can keep several threads per content object
 *          (workspace + env + type + id), listed by recency in the panel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: messages is a capped jsonb array; threads per scope are
 *          capped and member-private (see routes/ai/chats.ts).
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Gen AI conversation threads — several rows per content object per member.
 */
export const aiChats = pgTable(
  'ai_chats',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    /** Conversations are private — every query is member-scoped. */
    memberId: text('member_id').notNull(),
    /** Thread label shown in the picker; derived from the first user message. */
    title: text('title'),
    messages: jsonb('messages').notNull().default(sql`'[]'`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    aiChatsScopeIdx: index('ai_chats_scope_idx').on(t.workspaceId, t.objectType, t.objectId, t.memberId),
  }),
)
