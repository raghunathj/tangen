/**
 * File Name: schedule.ts
 * Purpose: Scheduling a publish and cancelling one, as handlers the REST
 *          routes, the local client and the lifecycle operations share
 *          (kernel K4). Scheduling is a deferred publish: it needs the publish
 *          grant, base-language rights, a valid object, a cascade that can
 *          publish, and no extension policy standing in the way - refused
 *          now rather than accepted and then failing every tick. It records
 *          WHO scheduled (`scheduled_by`), the actor the scheduler publishes
 *          as. Unscheduling runs the hooks and emits its event like every
 *          other transition.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { assertObjectPermission } from '../../lib/permissions'
import { canWriteLocale } from '../../lib/field-access'
import { resolveActorId, hookActor } from '../../lib/actor'
import { projectLocalization } from '../../services/i18n'
import { publishValidationError } from '../../services/field-validator'
import { resolvePublishPlan, makeDbRowLoader } from '../../services/publish-cascade'
import { createExtensionDataStore, runBeforeChange, runAfterChange } from '../../hooks/runner'
import { createGlobalsStore } from '../../services/globals-store'
import { makeEnqueue } from '../../services/task-queue'
import { clearTypeQueryCache } from '../../services/route-cache'
import { wakeScheduler } from '../../runtime/process'
import { lifecycleActionsFor } from './resource'
import { buildEvent, emitRecorded, attributionOf } from '../../kernel/events'

export function buildScheduleContext(
  typeName: string | undefined,
  scheduledAt: string | undefined,
  schema: SchemaDefinition,
): { typeName: string; typeId: string; scheduledAt: string } {
  if (!typeName) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: type')
  }
  if (!scheduledAt) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required field: scheduledAt')
  }
  const date = new Date(scheduledAt)
  if (isNaN(date.getTime()) || date <= new Date()) {
    throw new RequestError('VALIDATION_ERROR', 'scheduledAt must be a valid future date')
  }
  const typeDef = schema.types.find(t => t.name === typeName)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
  }
  return { typeName, typeId: typeDef.id ?? typeName, scheduledAt }
}

function requireBaseLanguage(ctx: any, workspaceId: string): void {
  const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)
  if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
    throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - this action needs base-language rights', 403)
  }
}

function requireTable(typeName: string) {
  const table = (contentTables as Record<string, any>)[typeName]
  if (!table) throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
  return table
}

/** Builds the schedule handler; ctx.query.type carries the content type, ctx.body.scheduledAt the time. */
export const makeScheduleHandler = (projects: any[]) => async (ctx: any) => {
  const { params, query, body, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx
  const { id } = params
  const { scheduledAt } = (body ?? {}) as { scheduledAt?: string }
  const { typeName, typeId, scheduledAt: validAt } = buildScheduleContext(query.type as string | undefined, scheduledAt, schema)
  assertObjectPermission(permissions, 'write', typeName)
  // Scheduling IS a deferred publish (the scheduler flips it with no caller) - so it needs the publish action too (C1).
  assertObjectPermission(permissions, 'publish', typeName)
  requireBaseLanguage(ctx, workspaceId)
  const table = requireTable(typeName)

  const typeDef = schema.types.find((t: any) => t.name === typeName)
  const currentRows = await db.select().from(table).where(and(eq(table.id, id), eq(table.workspaceId, workspaceId))).limit(1)
  if (!currentRows.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
  const prev = currentRows[0] as Record<string, unknown>
  const err = publishValidationError(typeDef, prev)
  if (err) throw new RequestError('VALIDATION_ERROR', err, 422)

  const plan = await resolvePublishPlan({ schema, typeName, id, loadRow: makeDbRowLoader(db, workspaceId) })
  if (plan.blockers.length > 0) {
    throw new RequestError('CASCADE_BLOCKED', 'One or more required related objects cannot be published', 422, undefined, plan)
  }
  if (plan.needsCascade) {
    throw new RequestError('NEEDS_CASCADE', 'Required related objects are not published - publish them before scheduling', 409, undefined, plan)
  }
  // K4: an extension standing between this object and publishing refuses the
  // schedule now, instead of the scheduler failing it every tick later.
  const policy = (await lifecycleActionsFor(ctx, typeName, id)).actions.find((a) => a.id === 'publish')
  const blockedBy = policy?.blockers.filter((b) => b.code === 'POLICY') ?? []
  if (blockedBy.length > 0) {
    throw new RequestError('PUBLISH_BLOCKED', blockedBy.map((b) => b.reason).join('; '), 422, undefined, { blockers: blockedBy })
  }

  const hookCtx = {
    actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
    objectId: id, typeName, workspaceId, operation: 'update' as const, trigger: 'schedule' as const,
    statusChange: { from: String(prev.status ?? 'draft'), to: 'scheduled' },
    prevData: prev, nextData: { ...prev, status: 'scheduled' },
    extensionData: createExtensionDataStore(db, workspaceId, redis),
    enqueue: makeEnqueue(workspaceId, ctx), globals: createGlobalsStore(db, workspaceId),
  }
  await runBeforeChange(db, projects, hookCtx)

  const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
  const scheduledBy = resolveActorId(memberId, apiKeyId)
  const rows = await db
    .update(table)
    .set({ status: 'scheduled', scheduledAt: new Date(validAt), scheduledBy, updatedAt: new Date(), updatedBy: scheduledBy, updatedByKind: attributionOf(writer).kind })
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
    .returning()
  if (!rows.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
  void wakeScheduler().catch(() => {})

  await ctx?.searchEngineRef?.onWrite?.(ctx, db, { workspaceId, typeName, objectId: id, row: rows[0] as Record<string, unknown> })

  await emitRecorded(eventBus, db, buildEvent({
    type: 'object.scheduled', workspaceId, resource: { kind: 'object', type: typeName, id },
    payload: { objectId: id, typeId, typeSlug: typeName, slug: (rows[0] as Record<string, unknown>).slug ?? null, title: String(rows[0].title ?? ''), scheduledAt: validAt, scheduledBy },
  }, writer))
  runAfterChange(db, projects, { ...hookCtx, savedData: rows[0] as Record<string, unknown> }).catch(() => {})
  clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})

  return { data: { ...rows[0], type: typeName } }
}

/** Builds the unschedule handler; the object returns to draft with the schedule cleared. */
export const makeUnscheduleHandler = (projects: any[]) => async (ctx: any) => {
  const { params, query, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx
  const { id } = params
  const { typeName, typeId } = buildScheduleContext(
    query.type as string | undefined,
    new Date(Date.now() + 99999999).toISOString(), // dummy future date - only used for schema lookup
    schema,
  )
  assertObjectPermission(permissions, 'write', typeName)
  requireBaseLanguage(ctx, workspaceId)
  const table = requireTable(typeName)

  const currentRows = await db.select().from(table).where(and(eq(table.id, id), eq(table.workspaceId, workspaceId))).limit(1)
  if (!currentRows.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
  const prev = currentRows[0] as Record<string, unknown>

  // K4: unscheduling is a transition like the others - hooks may refuse it, and it is evented.
  const hookCtx = {
    actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
    objectId: id, typeName, workspaceId, operation: 'update' as const, trigger: 'manual' as const,
    statusChange: { from: String(prev.status ?? 'scheduled'), to: 'draft' },
    prevData: prev, nextData: { ...prev, status: 'draft', scheduledAt: null, scheduledBy: null },
    extensionData: createExtensionDataStore(db, workspaceId, redis),
    enqueue: makeEnqueue(workspaceId, ctx), globals: createGlobalsStore(db, workspaceId),
  }
  await runBeforeChange(db, projects, hookCtx)

  const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
  const rows = await db
    .update(table)
    .set({ status: 'draft', scheduledAt: null, scheduledBy: null, updatedAt: new Date(), updatedBy: resolveActorId(memberId, apiKeyId), updatedByKind: attributionOf(writer).kind })
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
    .returning()
  if (!rows.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)

  await ctx?.searchEngineRef?.onWrite?.(ctx, db, { workspaceId, typeName, objectId: id, row: rows[0] as Record<string, unknown> })

  await emitRecorded(eventBus, db, buildEvent({
    type: 'object.unscheduled', workspaceId, resource: { kind: 'object', type: typeName, id },
    payload: { objectId: id, typeId, typeSlug: typeName, title: String(rows[0].title ?? ''), unscheduledBy: resolveActorId(memberId, apiKeyId) },
  }, writer))
  runAfterChange(db, projects, { ...hookCtx, savedData: rows[0] as Record<string, unknown> }).catch(() => {})
  clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})

  return { data: { ...rows[0], type: typeName } }
}

/**
 * Registers POST and DELETE /api/v1/objects/:id/schedule over the handlers;
 * ctx.query.type carries the content type.
 */
export const scheduleObjectRoute = (app: Elysia) =>
  app
    .post('/api/v1/objects/:id/schedule', (ctx: any) => makeScheduleHandler((ctx.workspaceProjects as any[] | undefined) ?? [])(ctx))
    .delete('/api/v1/objects/:id/schedule', (ctx: any) => makeUnscheduleHandler((ctx.workspaceProjects as any[] | undefined) ?? [])(ctx))
