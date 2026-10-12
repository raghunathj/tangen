/**
 * File Name: tables.ts
 * Purpose: The three tables Forms owns, as drizzle definitions for the
 *          extension's own queries through `ctx.db`. Their DDL lives in
 *          ./migrations.ts and runs where the extension is installed; core
 *          knows nothing of them (tasks/plan-core-slimming.md S3).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { pgTable, text, timestamp, jsonb, boolean, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'

export const forms = pgTable('forms', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  /** 'admin' (built in the UI) or 'code' (app/forms - read-only in the builder). */
  source: text('source').notNull().default('admin'),
  isLive: boolean('is_live').notNull().default(false),
  fields: jsonb('fields').notNull().default([]),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('forms_workspace_idx').on(t.workspaceId),
  slugUnique: uniqueIndex('forms_workspace_slug_unique').on(t.workspaceId, t.slug),
}))

export const formSubmissions = pgTable('form_submissions', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  data: jsonb('data').notNull(),
  /** IP address - used for uniqueBy: 'ip' dedup; null when the form keeps no IP. */
  ipAddress: text('ip_address'),
  /** userAgent and other request metadata. */
  metadata: jsonb('metadata'),
  /** Internal notes for lead management - never exposed to the submitter. */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('form_submissions_workspace_idx').on(t.workspaceId),
  formIdx: index('form_submissions_form_idx').on(t.formId),
}))
/** The drizzle handle an extension ctx carries, typed for these tables' queries. */
export type FormsDb = {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
  delete: (...args: any[]) => any
  execute: (...args: any[]) => any
  transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>
}
