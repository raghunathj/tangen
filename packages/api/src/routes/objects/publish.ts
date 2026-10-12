/**
 * File Name: publish.ts
 * Purpose: Elysia route plugin for publishing, unpublishing, and staging content objects.
 *          Runs the hook lifecycle, validates required fields, snapshots published values, and emits domain events.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db contentTables, hook runner, revision helpers, and Redis for cache invalidation.
 */
import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition, ObjectTypeDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { publishObject, type PublishDeps } from '../../services/publish-object'
import { resolveActorId, hookActor } from '../../lib/actor'
import { assertObjectPermission } from '../../lib/permissions'
import { canWriteLocale } from '../../lib/field-access'
import { projectLocalization } from '../../services/i18n'
import { createRevision } from '../../lib/revisions'
import { createExtensionDataStore, buildExtensionDataSnapshot, syncPublishedExtensionData, runBeforeChange, runAfterChange } from '../../hooks/runner'
import { createGlobalsStore } from '../../services/globals-store'
import { clearTypeQueryCache } from '../../services/route-cache'
import { makeEnqueue } from '../../services/task-queue'
import { resolvePublishPlan, cascadePublish, CascadeBlockedError, makeDbRowLoader } from '../../services/publish-cascade'
import { lifecycleActionsFor } from './resource'
import { buildEvent, recordEvent, attributionOf, type RecordedEvent } from '../../kernel/events'

/**
 * Resolves and validates the content type from the query parameter, returning identifiers needed by publish routes.
 * @param typeName - Raw type query param value (may be undefined)
 * @param schema - Active workspace schema definition
 * @returns Object containing resolved typeName, typeId, and typeDef
 */
export function buildPublishContext(
  typeName: string | undefined,
  schema: SchemaDefinition,
): { typeName: string; typeId: string; typeDef: ObjectTypeDefinition } {
  if (!typeName) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: type')
  }
  const typeDef = schema.types.find(t => t.name === typeName)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
  }
  return { typeName, typeId: typeDef.id ?? typeName, typeDef }
}

/**
 * Run `fn` in a transaction when the handle supports one.
 *
 * Content routes are handed a real drizzle db in production and a stand-in in
 * tests; the stand-in has no `transaction`, and a publication change is not
 * worth refusing over that. Where a transaction exists the content write and
 * the search write are atomic, which is the point.
 */
async function withTx<T>(db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  return typeof db?.transaction === 'function' ? await db.transaction(fn) : await fn(db)
}

function requireTable(typeName: string) {
  const table = (contentTables as Record<string, any>)[typeName]
  if (!table) throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
  return table
}

/** Everything `publishOne` needs, gathered from the request context once. */
export const makePublishHandler = (projects: any[]) => async (ctx: any) => {
      const { params, query, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx
      const { id } = params
      const { typeName } = buildPublishContext(query.type as string | undefined, schema)
      // Locale-scoped roles cannot publish/restore/bulk-write — base rights required
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)
        if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
          throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - this action needs base-language rights', 403)
        }
      }

      const deps: PublishDeps = { db, redis, eventBus, schema, workspaceId, memberId: memberId ?? null, apiKeyId: apiKeyId ?? null, memberRole: ctx.memberRole ?? null, permissions, projects, ctx }
      const loadRow = makeDbRowLoader(db, workspaceId)
      const cascade = query.cascade === 'true' || query.cascade === true

      if (cascade) {
        let rootData: Record<string, unknown> | null = null
        try {
          await cascadePublish({ schema, typeName, id, loadRow, publishOne: async (t, i) => {
            const r = await publishObject(deps, t, i)
            if (t === typeName && i === id) rootData = r
          } })
        } catch (e) {
          if (e instanceof CascadeBlockedError) {
            throw new RequestError('CASCADE_BLOCKED', 'One or more required related objects cannot be published', 422, undefined, e.plan)
          }
          throw e
        }
        return { data: rootData }
      }

      // No cascade requested: if required relations point at drafts, refuse and
      // return the plan so the caller can confirm (instead of silently publishing
      // an object with dangling draft references).
      const plan = await resolvePublishPlan({ schema, typeName, id, loadRow })
      if (plan.needsCascade) {
        throw new RequestError('NEEDS_CASCADE', 'Required related objects are not published - re-publish with cascade=true to publish them too', 409, undefined, plan)
      }
      return { data: await publishObject(deps, typeName, id) }
}

/** Preflight: returns the publish plan (dependencies + blockers) without writing. */
export const makePreflightHandler = () => async (ctx: any) => {
      const { params, query, db, schema, workspaceId, permissions } = ctx
      const { id } = params
      const { typeName } = buildPublishContext(query.type as string | undefined, schema)
      assertObjectPermission(permissions, 'publish', typeName)
      const loadRow = makeDbRowLoader(db, workspaceId)
      const plan = await resolvePublishPlan({ schema, typeName, id, loadRow })
      // K4: the preflight this name deserves - the cascade plan, whether the
      // caller may publish now, and every reason it may not (validation, the
      // cascade, an extension's policy, base-language rights).
      const publish = (await lifecycleActionsFor(ctx, typeName, id)).actions.find((a) => a.id === 'publish')
      return { data: { ...plan, publishAvailable: publish?.available ?? false, refusals: publish?.blockers ?? [] } }
}

/** Builds the unpublish handler; ctx.query.type carries the content type. */
export const makeUnpublishHandler = (projects: any[]) => async (ctx: any) => {
      const { params, query, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx
      const { id } = params
      const { typeName, typeId } = buildPublishContext(query.type as string | undefined, schema)
      // K4: taking content off the published web is a publish decision, not a write.
      assertObjectPermission(permissions, 'publish', typeName)
      // Locale-scoped roles cannot publish/restore/bulk-write — base rights required
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)
        if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
          throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - this action needs base-language rights', 403)
        }
      }

      const table = requireTable(typeName)

      const currentRows = await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
        .limit(1)
      const cr = (currentRows[0] ?? {}) as Record<string, unknown>

      const extDataStore = createExtensionDataStore(db, workspaceId, redis)
      const globalsStore = createGlobalsStore(db, workspaceId)
      const hookCtx = {
        actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
        objectId: id,
        typeName,
        workspaceId,
        operation: 'update' as const,
        trigger: 'manual' as const,
        statusChange: { from: cr.status as string ?? 'published', to: 'draft' },
        prevData: cr,
        nextData: { ...cr, status: 'draft', publishedAt: null, publishedValues: null },
        extensionData: extDataStore,
        enqueue: makeEnqueue(workspaceId, ctx),
        globals: globalsStore,
      }
      await runBeforeChange(db, projects, hookCtx)

      // Clears publishedValues so the content is fully offline
      // Taking content offline has to take it out of public search in the same
      // breath, or unpublished content stays findable - so, one transaction.
      const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
      let unpublishedEvent: RecordedEvent | null = null
      const rows = await withTx(db, async (tx: any) => {
        const r = await tx
          .update(table)
          .set({ status: 'draft', publishedAt: null, publishedValues: null, updatedAt: new Date(), updatedBy: resolveActorId(memberId, apiKeyId), updatedByKind: attributionOf(writer).kind })
          .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
          .returning()
        if (!r.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
        await ctx?.searchEngineRef?.onWrite?.(ctx, tx, { workspaceId, typeName, objectId: id, row: r[0] as Record<string, unknown> })
        // K5: the event record is part of the mutation.
        unpublishedEvent = buildEvent({
          type: 'object.unpublished', workspaceId, resource: { kind: 'object', type: typeName, id },
          payload: { objectId: id, typeId, typeSlug: typeName, slug: (r[0] as Record<string, unknown>).slug ?? null, title: String(r[0].title ?? ''), unpublishedBy: resolveActorId(memberId, apiKeyId) },
        }, writer)
        await recordEvent(tx, unpublishedEvent, { inTransaction: true })
        return r
      })

      eventBus.emit(unpublishedEvent!)

      runAfterChange(db, projects, { ...hookCtx, savedData: rows[0] as Record<string, unknown> }).catch(() => {})
      // C5: taking content offline takes its extension state offline with it.
      // The row above clears published_values for the same reason - a snapshot
      // left behind keeps serving an object that is no longer published.
      await syncPublishedExtensionData(db, redis, workspaceId, id, 'draft')
      clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})

      return { data: { ...rows[0], type: typeName } }
}

/** Builds the stage handler; ctx.query.type carries the content type. */
export const makeStageHandler = (projects: any[]) => async (ctx: any) => {
      const { params, query, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx
      const { id } = params
      const { typeName, typeId, typeDef } = buildPublishContext(query.type as string | undefined, schema)
      // K4: staging is a step of the publish lifecycle - the publish grant, as for publish and unpublish.
      assertObjectPermission(permissions, 'publish', typeName)
      // Locale-scoped roles cannot publish/restore/bulk-write — base rights required
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)
        if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
          throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - this action needs base-language rights', 403)
        }
      }

      const table = requireTable(typeName)

      // Does NOT clear publishedValues — live snapshot stays up if previously published
      // Staged is not published, so search has to learn that too.
      const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
      let stagedEvent: RecordedEvent | null = null
      const rows = await withTx(db, async (tx: any) => {
        const r = await tx
          .update(table)
          .set({ status: 'staged', updatedAt: new Date(), updatedBy: resolveActorId(memberId, apiKeyId), updatedByKind: attributionOf(writer).kind })
          .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
          .returning()
        if (!r.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
        await ctx?.searchEngineRef?.onWrite?.(ctx, tx, { workspaceId, typeName, objectId: id, row: r[0] as Record<string, unknown> })
        stagedEvent = buildEvent({
          type: 'object.staged', workspaceId, resource: { kind: 'object', type: typeName, id },
          payload: { objectId: id, typeId, typeSlug: typeName, title: String(r[0].title ?? ''), stagedBy: resolveActorId(memberId, apiKeyId) },
        }, writer)
        await recordEvent(tx, stagedEvent, { inTransaction: true })
        return r
      })

      const versioningEnabled = (typeDef?.admin as any)?.versioning?.enabled !== false
      const maxVersions: number = (typeDef?.admin as any)?.versioning?.maxVersions ?? 10
      if (versioningEnabled) {
        const extDataSnapshot = await buildExtensionDataSnapshot(db, workspaceId, id)
        await createRevision(db, {
          objectId: id, workspaceId, typeId, typeName,
          row: rows[0] as Record<string, unknown>, createdBy: memberId ?? apiKeyId ?? null,
          maxVersions, versionType: 'staged', extDataSnapshot, dropAutosave: true,
        })
      }

      eventBus.emit(stagedEvent!)

      return { data: { ...rows[0], type: typeName } }
}

/**
 * Elysia plugin exposing publish, unpublish, and stage endpoints for a content object.
 * @param projects - Array of project extension definitions used by hook runners
 * @returns Elysia plugin function
 */

