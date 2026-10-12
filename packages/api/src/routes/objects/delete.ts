/**
 * File Name: delete.ts
 * Purpose: Handles DELETE /api/v1/objects/:id — soft-deletes a content object by setting
 *          its status to "archived" and fires before/after delete hooks and a domain event.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; uses Drizzle ORM; "delete" is implemented as
 *   an archive (status update) rather than a hard row removal.
 */
import { randomUUID } from 'node:crypto'
import { hookActor } from '../../lib/actor'
import { eq, and } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { enforceOnDelete } from '../../services/relation-integrity'
import { assertObjectPermission } from '../../lib/permissions'
import { canWriteLocale } from '../../lib/field-access'
import { projectLocalization } from '../../services/i18n'
import { createExtensionDataStore, runBeforeDelete, runAfterDelete } from '../../hooks/runner'
import { applyContentBeforeDelete } from '../../services/content-filters'
import { createGlobalsStore } from '../../services/globals-store'
import { clearTypeQueryCache } from '../../services/route-cache'
import { makeEnqueue } from '../../services/task-queue'
import { buildEvent, emitRecorded, attributionOf } from '../../kernel/events'
import { resolveActorId } from '../../lib/actor'

/**
 * Resolves and validates the type name from a delete request, returning its typeId.
 * @param typeName - The ?type query parameter value from the request.
 * @param schema - Workspace schema definition used to look up the type.
 * @returns An object containing the validated typeName and resolved typeId.
 */
export function buildDeleteContext(
  typeName: string | undefined,
  schema: SchemaDefinition,
): { typeName: string; typeId: string } {
  if (!typeName) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: type')
  }
  const typeDef = schema.types.find(t => t.name === typeName)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
  }
  return { typeName, typeId: typeDef.id ?? typeName }
}

/**
 * Registers the DELETE /api/v1/objects/:id route on the given Elysia app.
 * @param projects - Loaded workspace project configs used by the hook runner.
 * @returns An Elysia plugin function that mounts the delete route.
 */
/** Builds the delete handler; ctx.query.type carries the content type. */
export const makeDeleteHandler = (projects: any[]) => async (ctx: any) => {
    const { params, query, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx
    const { id } = params
    const { typeName, typeId } = buildDeleteContext(query.type as string | undefined, schema)

    assertObjectPermission(permissions, 'delete', typeName)
    // Locale-restricted roles may not touch the default language / base object
    {
      const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
      if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
        throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - base content is locked', 403)
      }
    }


    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
    }

    // Fetch object data for hook context before archiving
    const currentRows = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .limit(1)
    const objectData = (currentRows[0] ?? {}) as Record<string, unknown>

    const extDataStore = createExtensionDataStore(db, workspaceId)
    const globalsStore = createGlobalsStore(db, workspaceId)
    const hookCtx = {
    actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
      objectId: id,
      typeName,
      workspaceId,
      operation: 'archive' as const,
      objectData,
      extensionData: extDataStore,
      enqueue: makeEnqueue(workspaceId, ctx),
      globals: globalsStore,
    }

    // Relation integrity (B3): restrict blocks with the referring entries; the
    // default setNull clears references in other types' relation fields.
    {
      const blockers = await enforceOnDelete(db, contentTables as Record<string, any>, schema, { typeName, id, workspaceId })
      if (blockers.length > 0) {
        throw new RequestError(
          'CONFLICT',
          `Cannot delete - ${blockers.length}${blockers.length === 10 ? '+' : ''} entr${blockers.length === 1 ? 'y references' : 'ies reference'} this item`,
          409,
          { blockers },
        )
      }
    }

    // K4.4: content.beforeDelete@1 - a REJECT vetoes the archive, attributed.
    await applyContentBeforeDelete({ workspaceId, typeName, id, row: objectData, context: { exec: ctx.exec ?? null } })
    await runBeforeDelete(db, projects, hookCtx)

    const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
    const rows = await db
      .update(table)
      // K5: an archive is attributed like every other write.
      .set({ status: 'archived', updatedAt: new Date(), updatedBy: resolveActorId(memberId, apiKeyId), updatedByKind: attributionOf(writer).kind })
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .returning()

    if (!rows.length) {
      throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
    }

    // A delete here archives rather than removes the row, so the document is
    // rewritten as archived - not published, and out of public search - rather
    // than dropped. Reconciling to current state is exactly what the engine
    // contract promises.
    await ctx.searchEngineRef?.onWrite?.(ctx, db, { workspaceId, typeName, objectId: id, row: rows[0] as Record<string, unknown> })

    await emitRecorded(eventBus, db, buildEvent({
      type: 'object.deleted', workspaceId, resource: { kind: 'object', type: typeName, id },
      payload: { objectId: id, typeId, typeSlug: typeName, slug: (rows[0] as Record<string, unknown>).slug ?? null, title: String(rows[0].title ?? ''), deletedBy: resolveActorId(memberId, apiKeyId) },
    }, writer))

    runAfterDelete(db, projects, hookCtx).catch(() => {})
    clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})

    return { data: { ...rows[0], type: typeName } }
}


