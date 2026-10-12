/**
 * File Name: publish-object.ts
 * Purpose: The one publish path: validates the draft, runs the hooks, writes
 *          the published values, records a revision, emits the event and
 *          syncs the extension data. The publish route and a Release both
 *          call it, so publishing through a Release is exactly publishing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Extracted from routes/objects/publish.ts (stage R4 of
 *          tasks/remove-environments-programme.md). Cascade planning stays in
 *          the route: a Release lists its members explicitly.
 */
import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { resolveActorId, hookActor } from '../lib/actor'
import { disabledRelationPublishBlockers } from './relation-integrity'
import { resolveComponentFieldRefs, validateFieldValues } from './field-validator'
import { fetchI18nRows, buildI18nMap } from './i18n'
import { assertObjectPermission } from '../lib/permissions'
import { createRevision } from '../lib/revisions'
import { createExtensionDataStore, buildExtensionDataSnapshot, syncPublishedExtensionData, runBeforeChange, runAfterChange } from '../hooks/runner'
import { applyContentValidate, applyContentPublish } from './content-filters'
import { createGlobalsStore } from './globals-store'
import { clearTypeQueryCache } from './route-cache'
import { applyFieldBeforeChange, applyFieldValidate, getActiveBehaviorRegistry } from './field-behavior'
import { makeEnqueue } from './task-queue'
import { customFieldTypeResolverFor } from '../hooks/app-hooks-registry'
import { buildEvent, recordEvent, attributionOf, type RecordedEvent } from '../kernel/events'

export interface PublishDeps {
  db: any; redis: any; eventBus: any; schema: SchemaDefinition
  workspaceId: string
  memberId: string | null; apiKeyId: string | null
  /** The member's role, so hooks see the same actor a plain update shows them (K0). */
  memberRole?: string | null
  /** The execution this publish runs in (K5): its actor, kind and correlation ride the event record. */
  exec?: import('@tangen/types').ExecutionContext | null
  /** Omit to skip the permission check (a Release checked `releases:apply`). */
  permissions?: any; projects: any[]
  /** The request context, for the search engine's write hook; optional outside a request. */
  ctx?: any
}

async function withTx<T>(db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  return typeof db?.transaction === 'function' ? await db.transaction(fn) : await fn(db)
}

export function requireContentTable(typeName: string) {
  const table = (contentTables as Record<string, any>)[typeName]
  if (!table) throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
  return table
}

/** Publishes one object: the draft becomes the published state. Throws a RequestError when it cannot. */
export async function publishObject(deps: PublishDeps, typeName: string, id: string): Promise<Record<string, unknown>> {
  const { db, redis, eventBus, schema, workspaceId, memberId, apiKeyId, memberRole, permissions, projects, ctx, exec } = deps
  const writer = { exec: exec ?? null, memberId, apiKeyId, memberRole, permissions, workspaceId }
  const typeDef = schema.types.find(t => t.name === typeName)
  if (!typeDef || typeDef.disabled) throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
  const typeId = typeDef.id ?? typeName
  if (permissions) assertObjectPermission(permissions, 'publish', typeName)
  const table = requireContentTable(typeName)
  const currentRows = await db
    .select().from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
    .limit(1)
  if (!currentRows.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
  const cr0 = currentRows[0] as Record<string, unknown>
  const behaviorCtx = { workspaceId }
  const cr = await applyFieldBeforeChange(getActiveBehaviorRegistry(), workspaceId, typeDef, cr0, behaviorCtx)
  const hookChangedFields: Record<string, unknown> = {}
  for (const f of typeDef.fields) {
    if (cr[f.name] !== cr0[f.name]) hookChangedFields[f.name] = cr[f.name]
  }
  if (!cr.title || String(cr.title).trim() === '') {
    throw new RequestError('VALIDATION_ERROR', 'Title is required', 422, { __title: 'Title is required' })
  }
  const fieldErrors = {
    ...validateFieldValues(resolveComponentFieldRefs(typeDef.fields, projects, workspaceId), cr, 'publish', customFieldTypeResolverFor(workspaceId)),
    ...disabledRelationPublishBlockers(schema, typeDef),
    ...applyFieldValidate(getActiveBehaviorRegistry(), workspaceId, typeDef, cr, behaviorCtx),
  }
  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.values(fieldErrors)[0]
    throw new RequestError('VALIDATION_ERROR', first, 422, fieldErrors)
  }
  // K4.2: content.validate@1, phase publish - the row as it stands, every active extension's findings merged.
  await applyContentValidate({ workspaceId, typeName, locale: null, phase: 'publish', record: cr, context: { objectId: id, operation: 'publish', exec: deps.exec ?? null } })
  let publishedValues: Record<string, unknown> = { title: cr.title, slug: cr.slug }
  for (const f of typeDef.fields) publishedValues[f.name] = cr[f.name]
  const i18nRows = await fetchI18nRows(db, typeName, [id], 'all')
  if (i18nRows.length > 0) publishedValues.i18n = buildI18nMap(i18nRows, typeDef as never)
  // K4.2: content.publish@1 - the snapshot every transform shaped; a REJECT vetoes the publish here.
  publishedValues = await applyContentPublish({ workspaceId, typeName, snapshot: publishedValues, context: { objectId: id, row: cr, dryRun: false, exec: deps.exec ?? null } })
  const extDataStore = createExtensionDataStore(db, workspaceId, redis)
  const globalsStore = createGlobalsStore(db, workspaceId)
  const hookCtx = {
    actor: hookActor(memberId, apiKeyId, memberRole),
    objectId: id, typeName, workspaceId, operation: 'update' as const, trigger: 'manual' as const,
    statusChange: { from: cr.status as string, to: 'published' },
    prevData: cr, nextData: { ...publishedValues, status: 'published' },
    extensionData: extDataStore, enqueue: makeEnqueue(workspaceId, writer), globals: globalsStore,
  }
  await runBeforeChange(db, projects, hookCtx)
  let publishedEvent: RecordedEvent | null = null
  const rows = await withTx(db, async (tx: any) => {
    const r = await tx
      .update(table)
      .set({ status: 'published', publishedAt: new Date(), publishedBy: resolveActorId(memberId, apiKeyId), publishedByKind: attributionOf(writer).kind, scheduledAt: null, scheduledBy: null, updatedAt: new Date(), publishedValues, ...hookChangedFields })
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .returning()
    if (!r.length) throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
    await ctx?.searchEngineRef?.onWrite?.(ctx, tx, { workspaceId, typeName, objectId: id, row: r[0] as Record<string, unknown> })
    // K5: the event record is part of the mutation.
    publishedEvent = buildEvent({
      type: 'object.published', workspaceId, resource: { kind: 'object', type: typeName, id },
      payload: { objectId: id, typeId, typeSlug: typeName, slug: (r[0] as Record<string, unknown>).slug ?? null, title: String(r[0].title ?? ''), publishedBy: resolveActorId(memberId, apiKeyId), locales: Object.keys((publishedValues.i18n as Record<string, unknown> | undefined) ?? {}) },
    }, writer)
    await recordEvent(tx, publishedEvent, { inTransaction: true })
    return r
  })
  const versioningEnabled = (typeDef?.admin as any)?.versioning?.enabled !== false
  const maxVersions: number = (typeDef?.admin as any)?.versioning?.maxVersions ?? 10
  if (versioningEnabled) {
    const extDataSnapshot = await buildExtensionDataSnapshot(db, workspaceId, id)
    await createRevision(db, {
      objectId: id, workspaceId, typeId, typeName,
      row: rows[0] as Record<string, unknown>, createdBy: memberId ?? apiKeyId ?? null,
      maxVersions, versionType: 'published', extDataSnapshot, dropAutosave: true,
      // K5: the published revision carries the translations the snapshot froze.
      i18n: (publishedValues.i18n as Record<string, unknown> | undefined) ?? null,
    })
  }
  eventBus.emit(publishedEvent!)
  await runAfterChange(db, projects, { ...hookCtx, savedData: rows[0] as Record<string, unknown> })
  await syncPublishedExtensionData(db, redis, workspaceId, id, 'published')
  clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})
  return { ...rows[0], type: typeName }
}
