/**
 * File Name: events.ts
 * Purpose: Typed event payload interfaces for all platform events (object, schema,
 *   media, member, API key, webhook, Porter, job runs, migration progress,
 *   releases, Studio publish) used by the webhook delivery layer, flows and
 *   the realtime bridge.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports MemberRole from api-keys.
 */

import type { MemberRole } from './api-keys'

/**
 * Common fields present on every platform event, used as the base for all typed event interfaces.
 */
export interface BaseEvent {
  id: string
  workspaceId: string
  timestamp: string
  actorId?: string | null
  actorType?: 'member' | 'api_key' | 'service' | 'agent' | 'extension' | null
  source?: 'admin' | 'rest' | 'graphql' | 'sdk'
  // ── The kernel's envelope (K5), additive: every field below is set by a
  // domain operation and absent on an event an older writer emitted. ──
  /** The envelope version; 2 once the kernel fields are present. */
  version?: number
  /** Whose authority the mutation exercised, for every actor kind (system and site_user included). */
  actor?: { kind: import('./kernel').ActorKind; id: string | null }
  /** Who caused it, when that differs from the actor (the member behind a Playground key, the scheduler behind a publish). */
  initiator?: { kind: import('./kernel').ActorKind; id: string | null } | null
  /** Where it ran. */
  execution?: { kind: import('./kernel').ExecutionKind; id: string }
  correlationId?: string
  causationId?: string | null
  /** What it touched. */
  resource?: { kind: string; type: string | null; id: string }
  /** The locale a localized write targeted; null or absent for the base row. */
  locale?: string | null
  /** True when the operation wrote the durable record for this event in its transaction. */
  recorded?: boolean
  /**
   * The client CONNECTION that issued the write, when one named itself
   * (X-Tangen-Origin, the realtime `connectionId`). The realtime bridge
   * copies it onto every envelope so a tab can recognise the echo of its own
   * write without comparing actors or clocks - see docs/realtime.md, "Was
   * this my own write?". Advisory: it carries no authority.
   */
  origin?: string | null
}

// ── Object events ─────────────────────────────────────────────────────────────

/**
 * Fired when a new content object is created in the workspace.
 */
export interface ObjectCreatedEvent extends BaseEvent {
  type: 'object.created'
  payload: { objectId: string; typeId: string; typeSlug: string; title: string; createdBy: string | null }
}

/**
 * Fired when an existing content object's fields are updated.
 */
export interface ObjectUpdatedEvent extends BaseEvent {
  type: 'object.updated'
  /** `locale` names the translation a localized update wrote; null or absent for the base row (K3). */
  payload: { objectId: string; typeId: string; typeSlug: string; title: string; changedFields: string[]; updatedBy: string | null; locale?: string | null }
}

/**
 * Fired when a content object transitions to 'published' status.
 */
export interface ObjectPublishedEvent extends BaseEvent {
  type: 'object.published'
  payload: { objectId: string; typeId: string; typeSlug: string; title: string; publishedBy: string | null }
}

/**
 * Fired when a published content object is reverted to draft/unpublished.
 */
export interface ObjectUnpublishedEvent extends BaseEvent {
  type: 'object.unpublished'
  payload: { objectId: string; typeId: string; typeSlug: string; title: string }
}

/**
 * Fired when a content object is archived (soft-delete) or hard-deleted.
 */
export interface ObjectDeletedEvent extends BaseEvent {
  type: 'object.deleted'
  payload: { objectId: string; typeId: string; typeSlug: string; title: string; hard: boolean }
}

/**
 * Fired when a content object is scheduled for future publish or unpublish.
 */
export interface ObjectScheduledEvent extends BaseEvent {
  type: 'object.scheduled'
  payload: { objectId: string; typeId: string; typeSlug: string; title: string; scheduledAt: string | null; scheduledBy?: string | null }
}

/** Fired when a scheduled publish is cancelled and the object returns to draft (kernel K4). */
export interface ObjectUnscheduledEvent extends BaseEvent {
  type: 'object.unscheduled'
  payload: { objectId: string; typeId: string; typeSlug: string; title: string; unscheduledBy: string | null }
}

/**
 * Fired when the scheduler could not publish a due object (kernel K4): the
 * scheduling actor lost the authority, the object no longer validates, or a
 * hook refused. The object is back in draft with the schedule cleared; the
 * refusal is recorded once and never retried.
 */
export interface ObjectPublishRefusedEvent extends BaseEvent {
  type: 'object.publish_refused'
  payload: {
    objectId: string; typeId: string; typeSlug: string; title: string
    reason: 'AUTHORITY_LOST' | 'VALIDATION' | 'HOOK' | 'ERROR'
    detail: string
    /** The actor the publish was attempted as (the scheduling member or key), null when unattributed. */
    scheduledBy: string | null
  }
}

// ── Schema events ─────────────────────────────────────────────────────────────

/**
 * Describes a single schema change operation applied during a push.
 */
export interface SchemaDiff {
  operation: string
  typeName: string
  fieldName?: string
}

/**
 * Fired when a schema push is completed, listing all structural changes applied.
 */
export interface SchemaPushedEvent extends BaseEvent {
  type: 'schema.pushed'
  payload: { changeCount: number; changes: SchemaDiff[] }
}

// ── Media events ──────────────────────────────────────────────────────────────

/**
 * Fired when a file is uploaded to the workspace media library.
 */
export interface MediaUploadedEvent extends BaseEvent {
  type: 'media.uploaded'
  payload: { assetId: string; filename: string; mimeType: string; folderId: string | null }
}

/**
 * Fired when a media asset is permanently deleted from the workspace library.
 */
export interface MediaDeletedEvent extends BaseEvent {
  type: 'media.deleted'
  payload: { assetId: string }
}

// ── Member events ─────────────────────────────────────────────────────────────

/**
 * Fired when a new member is invited to the workspace.
 */
export interface MemberInvitedEvent extends BaseEvent {
  type: 'member.invited'
  payload: { memberId: string; email: string; role: MemberRole }
}

/**
 * Fired when a member record is created in the workspace (e.g. invite accepted /
 * added). Distinct from member.invited, which fires when the invite is sent.
 */
export interface MemberCreatedEvent extends BaseEvent {
  type: 'member.created'
  payload: { memberId: string; email: string; role: MemberRole }
}

/**
 * Fired when a member's role or profile changes. `changed` lists the field keys
 * that were modified so flows can branch on e.g. a role change.
 */
export interface MemberUpdatedEvent extends BaseEvent {
  type: 'member.updated'
  payload: { memberId: string; email?: string; role?: MemberRole; changed: string[] }
}

// ── Form events ───────────────────────────────────────────────────────────────

/**
 * Fired when a form is submitted successfully (after validation/spam checks).
 */
export interface FormSubmittedEvent extends BaseEvent {
  type: 'form.submitted'
  payload: { formId: string; formSlug?: string; submissionId: string; values?: Record<string, unknown> }
}

// ── API key events ────────────────────────────────────────────────────────────

/**
 * Fired when a new API key is created in the workspace.
 */
export interface ApiKeyCreatedEvent extends BaseEvent {
  type: 'apikey.created'
  payload: { keyId: string; label: string }
}

/**
 * Fired when an API key is revoked and can no longer authenticate requests.
 */
export interface ApiKeyRevokedEvent extends BaseEvent {
  type: 'apikey.revoked'
  payload: { keyId: string }
}

// ── Webhook events ────────────────────────────────────────────────────────────

/**
 * Fired when a new webhook subscription is created in the workspace.
 */
export interface WebhookCreatedEvent extends BaseEvent {
  type: 'webhook.created'
  payload: { webhookId: string; label: string }
}

/**
 * Fired when an existing webhook subscription's settings are changed.
 */
export interface WebhookUpdatedEvent extends BaseEvent {
  type: 'webhook.updated'
  payload: { webhookId: string; label: string }
}

/**
 * Fired when a webhook subscription is permanently deleted.
 */
export interface WebhookDeletedEvent extends BaseEvent {
  type: 'webhook.deleted'
  payload: { webhookId: string }
}

// ── Porter events ─────────────────────────────────────────────────────────────

/**
 * Fired whenever a Porter run (promote, export, import, remote transfer)
 * changes state: created, claimed by the worker, progressed by a chunk, or
 * finished. Runs are workspace-scoped;
 * the source env, for subscribers that filter. Payload carries counters and
 * status only, never the moved content.
 */
export interface PorterRunChangedEvent extends BaseEvent {
  type: 'porter.run.changed'
  payload: {
    runId: string
    kind: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    totalItems: number
    processedItems: number
    error: string | null
  }
}

// ── Job run events (realtime R2) ──────────────────────────────────────────────

/** Which runner executed a job run; matches `job_runs.kind`. */
export type JobRunKind = 'task' | 'scheduled' | 'cron'

/**
 * Fired when a task, scheduled job or cron job starts executing. Carries the
 * job's kind and name only; the run row is written when it finishes.
 */
export interface JobRunStartedEvent extends BaseEvent {
  type: 'job.run.started'
  payload: { kind: JobRunKind; name: string }
}

/** Fired when a job run completes without throwing. */
export interface JobRunFinishedEvent extends BaseEvent {
  type: 'job.run.finished'
  payload: { kind: JobRunKind; name: string; durationMs: number }
}

/** Fired when a job run throws; `error` is the message the run row records. */
export interface JobRunFailedEvent extends BaseEvent {
  type: 'job.run.failed'
  payload: { kind: JobRunKind; name: string; durationMs: number; error: string }
}

// ── Migration progress (realtime R2) ──────────────────────────────────────────

/**
 * Fired as a Porter/migration run advances `processedItems`, throttled by the
 * emitter to at most one per second per run (the final count always fires).
 * Distinct from `porter.run.changed`, which marks every state transition:
 * this one exists for a progress bar that follows ONE run.
 */
export interface MigrationProgressEvent extends BaseEvent {
  type: 'migration.progress'
  payload: {
    runId: string
    kind: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    totalItems: number
    processedItems: number
  }
}

// ── Release events (realtime R2) ──────────────────────────────────────────────

/** Fired when a release is created with its item snapshots. Workspace-scoped. */
export interface ReleaseCreatedEvent extends BaseEvent {
  type: 'release.created'
  payload: { releaseId: string; itemCount: number }
}

/** Fired when a release is published in place, whether every item made it or not. */
export interface ReleasePublishedEvent extends BaseEvent {
  type: 'release.published'
  payload: { releaseId: string; status: 'applied' | 'failed'; published: number; unchanged: number; failed: number }
}

// ── Studio publish events (realtime R2; emitted by the Studio extension) ──────

/** Fired when a Studio publish of one object begins. */
export interface PublishStartedEvent extends BaseEvent {
  type: 'publish.started'
  payload: { objectId: string; typeSlug: string }
}

/**
 * Fired when a Studio publish wrote its artifact. `version` is the artifact
 * version when known - a content hash (string) for a Studio page artifact, so
 * the type admits both shapes. `route` is the delivery route the artifact was
 * published under, so a consumer can fetch the pointer without asking Studio.
 */
export interface PublishCompletedEvent extends BaseEvent {
  type: 'publish.completed'
  payload: { objectId: string; typeSlug: string; version?: number | string; route?: string }
}

/**
 * Fired when a Studio publish failed. `error` is a short CODE (e.g.
 * `artifact_write_failed`), never the text of a thrown error: the message
 * stays in the server log, and the bridge forwards only `failed: true`.
 */
export interface PublishFailedEvent extends BaseEvent {
  type: 'publish.failed'
  payload: { objectId: string; typeSlug: string; error: string }
}

// ── Studio design changes (realtime R3; emitted by the Studio extension) ──────

/**
 * Fired when a Studio class (a named style) is written. `objectId` is set
 * when the change belongs to one page's draft; absent for the workspace
 * class library. `rev` is the revision after the write, so an editor can
 * tell "changed elsewhere" from its own write coming back.
 */
export interface StudioClassChangedEvent extends BaseEvent {
  type: 'studio.class.changed'
  /** `rev` is the row's version token as Studio's stale-write guard stores it (a string); numeric revs are admitted for older emitters. */
  payload: { objectId?: string; name: string; rev: string | number; actorId: string }
}

/** Fired when a Studio tag default is written; the same shape as a class change. */
export interface StudioTagChangedEvent extends BaseEvent {
  type: 'studio.tag.changed'
  payload: { objectId?: string; name: string; rev: string | number; actorId: string }
}

/**
 * Fired when a workspace theme entry is written from Studio's Variables
 * panel (T-T1): one token value (`name` is the variable as the runtime reads
 * it, `bg-brand`) or one font (`font:<name>`). A theme has no page, so there
 * is no `objectId`; the bridge fans it to the workspace class library topic,
 * and names the actor the way it does for a class change. `rev` is the row's
 * version token after the write, empty when the write removed the row (a
 * reset to the config value).
 */
export interface StudioThemeChangedEvent extends BaseEvent {
  type: 'studio.theme.changed'
  payload: { name: string; rev: string | number; actorId: string }
}

// ── Union ─────────────────────────────────────────────────────────────────────

/**
 * Discriminated union of every event type that Tangen can emit to webhooks or internal subscribers.
 */
export type TangenEvent =
  | ObjectCreatedEvent
  | ObjectUpdatedEvent
  | ObjectPublishedEvent
  | ObjectUnscheduledEvent
  | ObjectPublishRefusedEvent
  | ObjectUnpublishedEvent
  | ObjectDeletedEvent
  | ObjectScheduledEvent
  | SchemaPushedEvent
  | MediaUploadedEvent
  | MediaDeletedEvent
  | MemberInvitedEvent
  | MemberCreatedEvent
  | MemberUpdatedEvent
  | FormSubmittedEvent
  | ApiKeyCreatedEvent
  | ApiKeyRevokedEvent
  | WebhookCreatedEvent
  | WebhookUpdatedEvent
  | WebhookDeletedEvent
  | PorterRunChangedEvent
  | JobRunStartedEvent
  | JobRunFinishedEvent
  | JobRunFailedEvent
  | MigrationProgressEvent
  | ReleaseCreatedEvent
  | ReleasePublishedEvent
  | PublishStartedEvent
  | PublishCompletedEvent
  | PublishFailedEvent
  | StudioClassChangedEvent
  | StudioTagChangedEvent
  | StudioThemeChangedEvent
