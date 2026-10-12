/**
 * File Name: index.ts
 * Purpose: The canonical lifecycle operations (kernel plan §2, K4): publish,
 *          unpublish, stage, schedule, unschedule and the preflight, each
 *          taking an ExecutionContext and running the ONE implementation.
 *          publishObject is the publish; the transition handlers are the
 *          others. The REST routes, the local client (and so GraphQL, MCP,
 *          custom routes and jobs), bulk update, the PATCH-to-published path,
 *          the scheduler and release apply are all callers of these.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Like domain/content/write.ts, the handler bodies are
 *          the implementation and the operations hand them a context built
 *          from the execution. The preflight answers what the action policy
 *          knows: the cascade plan, whether the actor may publish now, and
 *          every reason it may not.
 */
import type { ExecutionContext, PublishPlan, SchemaDefinition, WorkspaceProject, LifecycleBlocker } from '@tangen/types'
import { legacyIdentityOf } from '../../kernel/actor'
import { eventBus as processEventBus } from '../../services/event-bus'
import { RequestError } from '../../lib/errors'
import { publishObject } from '../../services/publish-object'
import { resolvePublishPlan, cascadePublish, CascadeBlockedError, makeDbRowLoader } from '../../services/publish-cascade'
import { makeUnpublishHandler, makeStageHandler } from '../../routes/objects/publish'
import { makeScheduleHandler, makeUnscheduleHandler } from '../../routes/objects/schedule'
import { lifecycleActionsFor } from '../../routes/objects/resource'

export interface LifecycleDeps {
  db: any
  redis: any
  schema: SchemaDefinition
  projects: WorkspaceProject[] | any[]
  eventBus?: { emit(event: unknown): void }
  searchEngineRef?: unknown
  transport?: { request?: Request; set?: { headers: Record<string, string>; status?: number } }
}

/** The preflight this name deserves: the cascade plan plus whether THIS actor may publish now, and why not. */
export interface PublishPreflight extends PublishPlan {
  publishAvailable: boolean
  refusals: LifecycleBlocker[]
}

function contextFor(exec: ExecutionContext, deps: LifecycleDeps, extra: Record<string, unknown>): Record<string, unknown> {
  if (!exec?.actor) throw new Error('A lifecycle operation needs an execution with an actor')
  return {
    ...legacyIdentityOf(exec.actor),
    exec,
    workspaceId: exec.workspaceId,
    db: deps.db, redis: deps.redis, schema: deps.schema,
    eventBus: deps.eventBus ?? processEventBus,
    workspaceProjects: deps.projects,
    searchEngineRef: deps.searchEngineRef,
    request: deps.transport?.request,
    set: deps.transport?.set ?? { headers: {} },
    ...extra,
  }
}

/** Publishes one object (and, with `cascade`, the required relations that are still drafts). */
export async function lifecyclePublish(
  exec: ExecutionContext,
  input: { typeName: string; id: string; cascade?: boolean },
  deps: LifecycleDeps,
): Promise<{ data: Record<string, unknown> }> {
  const identity = legacyIdentityOf(exec.actor)
  const publishDeps = {
    db: deps.db, redis: deps.redis, eventBus: deps.eventBus ?? processEventBus, schema: deps.schema, workspaceId: exec.workspaceId,
    memberId: identity.memberId, apiKeyId: identity.apiKeyId, memberRole: identity.memberRole, permissions: identity.permissions,
    projects: deps.projects as never, ctx: deps.searchEngineRef ? { searchEngineRef: deps.searchEngineRef, schema: deps.schema } : undefined,
    exec,
  }
  const loadRow = makeDbRowLoader(deps.db, exec.workspaceId)
  if (input.cascade) {
    let rootData: Record<string, unknown> | null = null
    try {
      await cascadePublish({ schema: deps.schema, typeName: input.typeName, id: input.id, loadRow, publishOne: async (t, i) => {
        const r = await publishObject(publishDeps, t, i)
        if (t === input.typeName && i === input.id) rootData = r
      } })
    } catch (e) {
      if (e instanceof CascadeBlockedError) throw new RequestError('CASCADE_BLOCKED', 'One or more required related objects cannot be published', 422, undefined, e.plan)
      throw e
    }
    return { data: rootData! }
  }
  const plan = await resolvePublishPlan({ schema: deps.schema, typeName: input.typeName, id: input.id, loadRow })
  if (plan.needsCascade) {
    throw new RequestError('NEEDS_CASCADE', 'Required related objects are not published - re-publish with cascade=true to publish them too', 409, undefined, plan)
  }
  return { data: await publishObject(publishDeps, input.typeName, input.id) }
}

export async function lifecycleUnpublish(exec: ExecutionContext, input: { typeName: string; id: string }, deps: LifecycleDeps): Promise<{ data: Record<string, unknown> }> {
  return (await makeUnpublishHandler(deps.projects)(contextFor(exec, deps, { params: { id: input.id }, query: { type: input.typeName } }))) as { data: Record<string, unknown> }
}

export async function lifecycleStage(exec: ExecutionContext, input: { typeName: string; id: string }, deps: LifecycleDeps): Promise<{ data: Record<string, unknown> }> {
  return (await makeStageHandler(deps.projects)(contextFor(exec, deps, { params: { id: input.id }, query: { type: input.typeName } }))) as { data: Record<string, unknown> }
}

export async function lifecycleSchedule(exec: ExecutionContext, input: { typeName: string; id: string; at: string | Date }, deps: LifecycleDeps): Promise<{ data: Record<string, unknown> }> {
  const at = input.at instanceof Date ? input.at.toISOString() : input.at
  return (await makeScheduleHandler(deps.projects)(contextFor(exec, deps, { params: { id: input.id }, query: { type: input.typeName }, body: { scheduledAt: at } }))) as { data: Record<string, unknown> }
}

export async function lifecycleUnschedule(exec: ExecutionContext, input: { typeName: string; id: string }, deps: LifecycleDeps): Promise<{ data: Record<string, unknown> }> {
  return (await makeUnscheduleHandler(deps.projects)(contextFor(exec, deps, { params: { id: input.id }, query: { type: input.typeName } }))) as { data: Record<string, unknown> }
}

/** The cascade plan, and whether this actor may publish the object now with every reason it may not. */
export async function lifecyclePreflight(exec: ExecutionContext, input: { typeName: string; id: string }, deps: LifecycleDeps): Promise<{ data: PublishPreflight }> {
  const plan = await resolvePublishPlan({ schema: deps.schema, typeName: input.typeName, id: input.id, loadRow: makeDbRowLoader(deps.db, exec.workspaceId) })
  const actions = await lifecycleActionsFor(contextFor(exec, deps, {}), input.typeName, input.id)
  const publish = actions.actions.find((a) => a.id === 'publish')
  return { data: { ...plan, publishAvailable: publish?.available ?? false, refusals: publish?.blockers ?? [] } }
}
