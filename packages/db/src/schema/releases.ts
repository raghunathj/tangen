/**
 * File Name: releases.ts
 * Purpose: Releases v1 (closure plan Phase 5B): a reviewed, immutable
 *          promotion from one environment to the next. `releases` carries
 *          the state machine (draft -> in_review -> approved -> applying ->
 *          applied | failed) with who did what and when, the approved
 *          payload's checksum and the failure record; `release_items` is
 *          one row per object with the review snapshot, the frozen payload
 *          approval wrote, and the per-item apply outcome;
 *          `release_history` is the operator's ledger of every transition
 *          and attempt; `promotion_log` stays the per-object trail.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Migration 0049 added the lifecycle columns, the
 *          status check, the item identity (one per object per release)
 *          and the history table, and turned legacy `pending` into `draft`.
 */
import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

export const releases = pgTable('releases', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  /** draft | in_review | approved | applying | applied | failed */
  status: text('status').notNull().default('draft'),
  createdBy: text('created_by'),
  appliedBy: text('applied_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: text('submitted_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  /** sha256 over the frozen payloads in apply order; the apply refuses when it no longer matches. */
  approvedChecksum: text('approved_checksum'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  scheduledBy: text('scheduled_by'),
  applyingStartedAt: timestamp('applying_started_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  /** { stage, itemId?, error, errorId? } of the last failure. */
  failure: jsonb('failure'),
  attempts: integer('attempts').notNull().default(0),
}, (t) => ({
  workspaceIdx: index('releases_workspace_idx').on(t.workspaceId),
}))

export const releaseItems = pgTable('release_items', {
  id: text('id').primaryKey(),
  releaseId: text('release_id').notNull().references(() => releases.id, { onDelete: 'cascade' }),
  objectId: text('object_id').notNull(),
  typeName: text('type_name').notNull(),
  /** The main row at selection time: what review and diff show. */
  fieldSnapshot: jsonb('field_snapshot').notNull(),
  comparisonState: text('comparison_state'),
  resolvedValues: jsonb('resolved_values'),
  /** Written at APPROVE: the complete source (row, i18n rows, tags, extension data) the apply uses. */
  frozenPayload: jsonb('frozen_payload'),
  /** The target's fingerprint at APPROVE; a different one at apply is a conflict. */
  targetFingerprint: text('target_fingerprint'),
  /** Deterministic apply order within the release. */
  position: integer('position'),
  /** created | overwritten | unchanged | skipped | failed, per attempt. */
  applyOutcome: text('apply_outcome'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  applyError: text('apply_error'),
}, (t) => ({
  releaseIdx: index('release_items_release_idx').on(t.releaseId),
  objectIdx: index('release_items_object_idx').on(t.objectId),
  identity: uniqueIndex('release_items_identity_unique').on(t.releaseId, t.typeName, t.objectId),
}))

export const releaseHistory = pgTable('release_history', {
  id: text('id').primaryKey(),
  releaseId: text('release_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  attempt: integer('attempt').notNull().default(0),
  /** submit | withdraw | approve | schedule | unschedule | apply | retry | preflight-failed | apply-failed | applied */
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actor: text('actor'),
  checksum: text('checksum'),
  counts: jsonb('counts'),
  errorId: text('error_id'),
  errorSummary: text('error_summary'),
  reason: text('reason'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => ({
  releaseIdx: index('release_history_release_idx').on(t.releaseId, t.startedAt),
}))

