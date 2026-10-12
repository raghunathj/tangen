/**
 * File Name: playground.ts
 * Purpose: PG-3 — API Playground persistence: collections (folders of saved
 *          REST/GraphQL requests, private by default, shareable within the
 *          playground's own RBAC circle) and per-member variable sets
 *          ({{name}} interpolation; values never leave this table).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * A collection: an ordered jsonb list of saved requests. Requests never store
 * key ids or variable values — keys are picked and variables resolved at run
 * time. `visibility`: 'private' (creator only) | 'shared' (every member who
 * clears the playground RBAC gate).
 */
export const playgroundCollections = pgTable('playground_collections', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  /** [{ id, name, request: { kind, method?, path?, query?, headers?, body?, graphql? } }] */
  requests: jsonb('requests').notNull().default(sql`'[]'`),
  visibility: text('visibility').notNull().default('private'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  playgroundCollectionsScopeIdx: index('playground_collections_scope_idx').on(t.workspaceId),
}))

/** One variable set per member per workspace+env: { name: { value, secret? } }. */
export const playgroundVariables = pgTable('playground_variables', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  memberId: text('member_id').notNull(),
  vars: jsonb('vars').notNull().default(sql`'{}'`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  playgroundVariablesOwner: unique('playground_variables_owner').on(t.workspaceId, t.memberId),
}))
