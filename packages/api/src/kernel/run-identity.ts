/**
 * File Name: run-identity.ts
 * Purpose: Who a job runs as (kernel plan §12, K6). A queued task carries the
 *          INITIATOR (who enqueued it) and a RUN-AS choice; at execution the
 *          runner resolves the actor whose authority the run uses - the
 *          initiator's CURRENT authority, re-resolved, or Tangen's own with
 *          the job as the reason - and refuses, recording why, when that
 *          authority is gone. Nothing runs as nobody.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A task declares `runAs: 'system'` when it is site
 *          code deployed with the site (a reindex, a digest) rather than work
 *          done for the person who enqueued it; the default for a task
 *          enqueued from a request is the enqueuing actor. A payload with no
 *          initiator (queued before K6) runs as system with the reason
 *          `legacy`, said so in the log, for one release.
 */
import type { ActorContext, ActorIdentity, ExecutionContext, JobRunRef, LocalizationConfig, TaskDefinition } from '@tangen/types'
import { systemActor } from './actor'
import { createExecution } from './execution'
import { baseLocaleContext } from './locale'
import { resolveRecordedActor } from './resolve-actor'

/** The kernel fields a queued job carries beside its payload (additive on TaskJobData). */
export interface RunIdentityFields {
  /** Who enqueued: a member or key identity; null when the enqueuer was system or unknown. */
  initiator?: ActorIdentity | null
  /** Whose authority the run uses: the initiator's (re-resolved) or Tangen's own. */
  runAs?: 'initiator' | 'system'
  correlationId?: string | null
  causationId?: string | null
  locale?: string | null
}

/** The identity fields to enqueue with, from the execution doing the enqueueing. */
export function runIdentityFrom(exec: ExecutionContext | null | undefined, task?: Pick<TaskDefinition, 'runAs'> | null): RunIdentityFields {
  const actor = exec?.actor ?? null
  const initiator: ActorIdentity | null = actor && (actor.identity.kind === 'member' || actor.identity.kind === 'api_key')
    ? { kind: actor.identity.kind, id: actor.identity.id }
    : (exec?.initiator ?? null)
  const runAs: 'initiator' | 'system' = task?.runAs === 'system' || !initiator ? 'system' : 'initiator'
  return {
    initiator,
    runAs,
    correlationId: exec?.correlationId ?? null,
    causationId: exec?.id ?? null,
    locale: exec?.locale.write ?? null,
  }
}

export type RunResolution =
  | { ok: true; actor: ActorContext; reason: string | null }
  | { ok: false; reason: string }

/** The actor a job runs as, resolved NOW. */
export async function resolveRunActor(
  db: any, redis: any,
  input: { workspaceId: string; taskId: string; identity: RunIdentityFields; task?: Pick<TaskDefinition, 'runAs'> | null; project?: { roles?: import('@tangen/types').RoleSeedDefinition[] } },
): Promise<RunResolution> {
  const { identity, task } = input
  if (task?.runAs === 'system') return { ok: true, actor: systemActor({ workspaceId: input.workspaceId, reason: `job:${input.taskId}` }), reason: null }
  if (!identity.initiator) {
    // Queued before K6, or enqueued by system: Tangen's own authority, said so.
    return { ok: true, actor: systemActor({ workspaceId: input.workspaceId, reason: identity.runAs === 'system' ? `job:${input.taskId}` : 'legacy' }), reason: identity.runAs === 'system' ? null : 'no initiator recorded - running as system (legacy)' }
  }
  if (identity.runAs === 'system') return { ok: true, actor: systemActor({ workspaceId: input.workspaceId, reason: `job:${input.taskId}` }), reason: null }
  if (!db) return { ok: false, reason: 'no database to re-resolve the initiator against' }
  const resolved = await resolveRecordedActor(db, redis, { workspaceId: input.workspaceId, actorId: identity.initiator.id, project: input.project })
  return resolved.ok ? { ok: true, actor: resolved.actor, reason: null } : { ok: false, reason: resolved.reason }
}

/** The execution a job run is: kind `job`, the resolved actor, the initiator, the enqueuer's correlation. */
export function executionForRun(input: { workspaceId: string; run: JobRunRef; localization?: LocalizationConfig | null }): ExecutionContext {
  const actor = input.run.actor ?? systemActor({ workspaceId: input.workspaceId, reason: `job:${input.run.id}` })
  return createExecution({
    id: input.run.runId, kind: 'job', source: input.run.kind === 'task' ? 'job' : 'scheduler', workspaceId: input.workspaceId,
    actor,
    initiator: input.run.initiator ?? null,
    correlationId: input.run.correlationId ?? null,
    causationId: input.run.causationId ?? null,
    locale: baseLocaleContext(input.localization),
  })
}
