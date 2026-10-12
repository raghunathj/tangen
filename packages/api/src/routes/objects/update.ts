/**
 * File Name: update.ts
 * Purpose: Elysia route plugin for PATCH /api/v1/objects/:id, handling partial field updates with
 *          type-safe SQL generation, uniqueness checks, revision/auto-save tracking, and hook execution.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires @tangen/db contentTables, field-validator, revisions lib, hook runner,
 *                     and Redis for cache invalidation. Supports ?noRevision=1 for auto-save mode.
 */
import { coerceNumericFields } from '../../services/local-client'
import { randomUUID } from 'node:crypto'
import { buildPublishedValues } from '../../services/publish-snapshot'
import { eq, and, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { jsonbParam, textArrayParam } from '../../lib/sql-values'
import { resolveActorId, hookActor } from '../../lib/actor'
import { assertObjectPermission } from '../../lib/permissions'
import { assertStudioCssAllowed } from '../../lib/studio-css-gate'
import { fieldAccessContext, restrictedWriteFields, stripRestrictedWrites, canWriteLocale, assertGrantedWrite } from '../../lib/field-access'
import { createRevision, upsertAutoSave } from '../../lib/revisions'
import { isSlugUniqueViolation } from '../../lib/slugs'
import { validateFieldValues, isUniqueField, collectFieldWarnings, normalizeRangeFieldValues } from '../../services/field-validator'
import { validateRelationFilters } from '../../services/relation-filter'
import { ensureContainerRowKeys } from '../../services/component-relation-expansion'
import { reconcileComponentWrite } from '../../services/component-projection'
import { collapseMediaDeep } from '../../services/media-loader'
import { collapseLinksDeep } from '../../services/link-loader'
import { validateMediaConstraints } from '../../services/media-constraints'
import { createExtensionDataStore, extractPanelData, buildExtensionDataSnapshot, runBeforeChange, runAfterChange, syncPublishedExtensionData } from '../../hooks/runner'
import { applyContentBeforeWrite, applyContentValidate } from '../../services/content-filters'
import { createGlobalsStore } from '../../services/globals-store'
import { resolveLocaleParam, projectLocalization, buildLocalizedUpdate, upsertI18nRow, fetchI18nRows, localizeRow, pruneContainerOverlays } from '../../services/i18n'
import { clearTypeQueryCache } from '../../services/route-cache'
import { applyFieldBeforeChange, getActiveBehaviorRegistry } from '../../services/field-behavior'
import { makeEnqueue } from '../../services/task-queue'
import { customFieldTypeResolverFor } from '../../hooks/app-hooks-registry'
import { conditionalWrite, staleObjectError } from '../../lib/concurrency'
import { readUpdatedAtText, attachObjectEtag } from '../../lib/object-etag'
import { isSafeIdent } from '@tangen/types'
import { projectToTableColumns } from '../../services/local-client'
import { publishObject } from '../../services/publish-object'
import { buildEvent, emitRecorded, attributionOf } from '../../kernel/events'

function safeId(name: string): string {
  if (!isSafeIdent(name)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid identifier: "${name}"`)
  }
  return name
}

export interface UpdatePayload {
  typeName: string
  typeId: string
  updates: Record<string, unknown>
  changedFields: string[]
}

/**
 * Parses and validates the PATCH request body, extracting updatable field values for a content object.
 * @param typeName - Raw type query param (may be undefined)
 * @param body - Raw request body
 * @param schema - Active workspace schema definition
 * @returns Validated UpdatePayload containing resolved type identifiers, an update map, and changed field names
 */
export function buildUpdatePayload(
  typeName: string | undefined,
  body: unknown,
  schema: SchemaDefinition,
): UpdatePayload {
  if (!typeName) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required query parameter: type')
  }

  const typeDef = schema.types.find(t => t.name === typeName)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${typeName}" not found in schema`)
  }

  if (!body || typeof body !== 'object') {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object')
  }

  const input = body as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  const changedFields: string[] = []

  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new RequestError('VALIDATION_ERROR', 'title must be a non-empty string')
    }
    updates.title = input.title.trim()
    changedFields.push('title')
  }

  if (input.slug !== undefined && typeof input.slug === 'string' && input.slug.trim()) {
    updates.slug = input.slug.trim()
    changedFields.push('slug')
  }

  for (const field of flattenFields(typeDef.fields)) {
    if (input[field.name] !== undefined) {
      updates[field.name] = input[field.name]
      changedFields.push(field.name)
    }
  }

  if (changedFields.length === 0) {
    throw new RequestError('VALIDATION_ERROR', 'No updatable fields provided')
  }

  return { typeName, typeId: typeDef.id ?? typeName, updates, changedFields }
}

// ── What actually changed ─────────────────────────────────────────────────────
//
// The admin editor PATCHes the whole form on every save, so "the key was in
// the body" named every field as changed and the realtime "changed elsewhere"
// notice listed title, body, author, categories, ... for a one-word edit.
// The event's changedFields (and the prevData it carries) are now the
// requested fields whose value differs between the row before the write and
// the row the write returned. Both rows come from the driver, so the
// database's own normalisation (jsonb key order, numeric text, text[]) is
// already applied to both sides; what is left to equalise is what the editor
// and the write layer do on top: the empty family, dates as Date or ISO text,
// and the `_key` the write backfills on container rows.

/** null, undefined, '' and [] are one absence to an editor. */
const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)

/** The instant of a Date or an ISO string; null for anything else. */
const instantOf = (v: unknown): number | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v === 'string' && v.length > 0) { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  return null
}

const isNumericText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))

/** The write's own row identity for locale overlays (ensureContainerRowKeys); never user content. */
const ROW_KEY = '_key'

/**
 * Are two stored values the same to the person who edits them? Deep, with
 * the empty family folded, dates by instant, numeric text by number, object
 * keys in any order, and container `_key`s ignored.
 */
export function valuesEqualForChange(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (isEmptyValue(a) || isEmptyValue(b)) return isEmptyValue(a) && isEmptyValue(b)
  if (a instanceof Date || b instanceof Date) {
    const ta = instantOf(a)
    const tb = instantOf(b)
    return ta !== null && ta === tb
  }
  if ((typeof a === 'number' && isNumericText(b)) || (typeof b === 'number' && isNumericText(a))) {
    return Number(a) === Number(b)
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => valuesEqualForChange(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    keys.delete(ROW_KEY)
    for (const k of keys) if (!valuesEqualForChange(a[k], b[k])) return false
    return true
  }
  return false
}

/**
 * The requested fields whose value differs between the row before the write
 * and the row after it, in the requested order. With no row before (nothing
 * to compare with) every requested field counts.
 * @param requested - The fields the body named, after access stripping.
 * @param prev - The row before the write, as the driver returned it; null when unknown.
 * @param next - The row the write returned.
 */
export function diffChangedFields(
  requested: readonly string[],
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string[] {
  if (!prev) return [...requested]
  return requested.filter((f) => !valuesEqualForChange(prev[f], next[f]))
}

/**
 * Elysia plugin providing PATCH /api/v1/objects/:id for partial updates, auto-save, and versioning.
 * @param projects - Array of project extension definitions used by hook runners
 * @returns Elysia plugin function
 */
/** Builds the update handler; ctx.query.type carries the content type. */
export const makeUpdateHandler = (projects: any[]) => async (ctx: any) => {
    const { params, query, body, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions, workspaceProjects } = ctx
    const { id } = params
    const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
    // ?noRevision=1 is sent by auto-save to avoid polluting version history
    const skipRevision = query.noRevision === '1'
    const trigger = skipRevision ? 'autosave' as const : 'manual' as const

    // ── Locale-scoped write: translations go to the <type>_i18n side row ──────
    const project = (workspaceProjects as any[])?.find((p: any) => p.workspaceId === workspaceId)
    const writeLocale = resolveLocaleParam(query.locale as string | undefined, projectLocalization(project), Boolean(memberId))
    if (writeLocale === 'all') {
      throw new RequestError('VALIDATION_ERROR', 'locale=all is read-only - write one locale at a time', 422)
    }
    const defaultLocale = projectLocalization(project)?.defaultLocale
    if (!canWriteLocale(ctx, writeLocale, defaultLocale)) {
      throw new RequestError('FORBIDDEN',
        writeLocale
          ? `Your role cannot edit ${writeLocale} content`
          : 'Your role can only edit specific languages - the default language is locked', 403)
    }
    if (writeLocale) {
      const localizedTypeName = query.type as string | undefined
      const localizedTypeDef = schema.types.find((t: any) => t.name === localizedTypeName)
      if (!localizedTypeDef) {
        throw new RequestError('TYPE_NOT_FOUND', `Type "${localizedTypeName}" not found in schema`, 404)
      }
      assertObjectPermission(permissions, 'write', localizedTypeName!)

      const localeRegistry = ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never
      const { sideValues, changedFields: localizedChanged } = buildLocalizedUpdate(localizedTypeDef, body as Record<string, unknown>, localeRegistry)
      // K1.3: a grant allow-list covers every locale's fields alike.
      assertGrantedWrite(sideValues, localizedTypeDef, fieldAccessContext(ctx))

      // Validate translated values against the same field rules as the default locale
      const changedDefs = localizedTypeDef.fields.filter((f: any) => f.name in sideValues)
      if (changedDefs.length > 0) {
        const partial: Record<string, unknown> = {}
        for (const f of changedDefs) partial[f.name] = sideValues[f.name]
        const fieldErrors = validateFieldValues(changedDefs, partial, 'draft', customFieldTypeResolverFor(workspaceId))
        if (Object.keys(fieldErrors).length > 0) {
          const first = Object.values(fieldErrors)[0]
          throw new RequestError('VALIDATION_ERROR', first, 422, fieldErrors)
        }
      }

      const localizedTable = (contentTables as Record<string, any>)[localizedTypeName!]
      const mainRows = await db.select().from(localizedTable)
        .where(and(eq(localizedTable.id, id), eq(localizedTable.workspaceId, workspaceId)))
        .limit(1)
      if (!mainRows.length) {
        throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
      }

      // K3: a localized update is an update. The hooks see the localized view
      // (base row + this locale's translations) with `locale` set, may refuse,
      // and may mutate this locale's values; the event names the locale.
      const mainRow = mainRows[0] as Record<string, unknown>
      const prevSide = (await fetchI18nRows(db, localizedTypeName!, [id], writeLocale))[0] ?? null
      const prevLocalized = localizeRow(mainRow, prevSide, localizedTypeDef)
      const nextLocalized = localizeRow(mainRow, { ...(prevSide ?? { objectId: id, locale: writeLocale }), ...sideValues } as never, localizedTypeDef)
      const localizedHookCtx = {
        actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
        objectId: id, typeName: localizedTypeName!, workspaceId,
        operation: 'update' as const, trigger, locale: writeLocale,
        prevData: prevLocalized, nextData: nextLocalized,
        extensionData: createExtensionDataStore(db, workspaceId, redis),
        enqueue: makeEnqueue(workspaceId, ctx), globals: createGlobalsStore(db, workspaceId),
      }
      const localizedMutations = await runBeforeChange(db, projects, localizedHookCtx)
      if (localizedMutations) {
        for (const [k, v] of Object.entries(localizedMutations)) {
          if (localizedTypeDef.fields.some((f: any) => f.name === k) || k === 'title') sideValues[k === 'title' ? '__title' : k] = v
        }
      }
      // K4.1: content.beforeWrite@1 for this locale - the translated fields after hooks.
      {
        const filtered = await applyContentBeforeWrite({
          workspaceId, typeName: localizedTypeName!, operation: 'update', locale: writeLocale, value: sideValues,
          context: { objectId: id, prevData: localizedHookCtx.prevData ?? null, exec: ctx.exec ?? null },
        })
        if (filtered !== sideValues) { for (const k of Object.keys(sideValues)) delete sideValues[k]; Object.assign(sideValues, filtered) }
        await applyContentValidate({
          workspaceId, typeName: localizedTypeName!, locale: writeLocale, phase: 'save', record: { ...((localizedHookCtx.prevData as Record<string, unknown> | null) ?? {}), ...sideValues },
          context: { objectId: id, operation: 'update', changed: Object.keys(sideValues), prevData: localizedHookCtx.prevData ?? null, exec: ctx.exec ?? null },
        })
      }

      await upsertI18nRow(db, localizedTypeName!, id, writeLocale, sideValues)
      await db.update(localizedTable)
        .set({ updatedAt: new Date(), updatedBy: resolveActorId(memberId, apiKeyId), updatedByKind: attributionOf(writer).kind })
        .where(eq(localizedTable.id, id))

      const sideRows = await fetchI18nRows(db, localizedTypeName!, [id], writeLocale)
      const localizedView = coerceNumericFields([localizeRow(mainRow, sideRows[0] ?? null, localizedTypeDef)], localizedTypeDef as never)[0]!
      // K5: a manual localized save is a revision of that locale.
      if (!skipRevision && (localizedTypeDef.admin as any)?.versioning?.enabled !== false) {
        await createRevision(db, {
          objectId: id, workspaceId, typeId: localizedTypeDef.id ?? localizedTypeName!, typeName: localizedTypeName!,
          row: localizedView, createdBy: resolveActorId(memberId, apiKeyId), maxVersions: (localizedTypeDef.admin as any)?.versioning?.maxVersions ?? 10,
          versionType: 'draft', locale: writeLocale,
        })
      }
      await emitRecorded(eventBus, db, buildEvent({
        type: 'object.updated', workspaceId, resource: { kind: 'object', type: localizedTypeName!, id }, locale: writeLocale,
        payload: {
          objectId: id, typeId: localizedTypeDef.id ?? localizedTypeName, typeSlug: localizedTypeName, slug: mainRow.slug ?? null,
          title: String(localizedView.title ?? mainRow.title ?? ''), changedFields: localizedChanged, locale: writeLocale, trigger,
          prevData: Object.fromEntries(localizedChanged.map((f) => [f, (prevLocalized as Record<string, unknown>)[f]])),
          updatedBy: resolveActorId(memberId, apiKeyId),
        },
      }, writer))
      runAfterChange(db, projects, { ...localizedHookCtx, savedData: localizedView }).catch(() => {})
      clearTypeQueryCache(redis, workspaceId, localizedTypeName!).catch(() => {})
      return { data: { ...localizedView, type: localizedTypeName, locale: writeLocale, changedFields: localizedChanged } }
    }

    const { typeName, typeId, updates: prefilterUpdates, changedFields: prefilterChanged } = buildUpdatePayload(
      query.type as string | undefined,
      body,
      schema,
    )

    assertObjectPermission(permissions, 'write', typeName)

    // Field-level access: a grant allow-list refuses (K1.3); a role list strips.
    const accessCtx = fieldAccessContext(ctx)
    const typeDefForAccess = schema.types.find((t: any) => t.name === typeName)
    assertGrantedWrite(prefilterUpdates, typeDefForAccess, accessCtx)
    const restrictedW = restrictedWriteFields(typeDefForAccess, accessCtx)
    const { values: updates, stripped: strippedFields } = stripRestrictedWrites(prefilterUpdates, restrictedW)
    // The fields the body named; which of them actually changed is decided after the write.
    const requestedFields = prefilterChanged.filter((f: string) => !restrictedW.has(f))
    if (strippedFields.length > 0) {
      ctx.set.headers['X-Tangen-Restricted-Fields'] = strippedFields.join(',')
    }

    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
    }

    // Field-level beforeChange hooks (behavior overlay) — normalize values
    // before validation, uniqueness checks, and storage
    const typeDef2 = schema.types.find((t: any) => t.name === typeName)
    const componentRegistryForWrite = ((ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)?.components ?? []) as never
    if (typeDef2) {
      const hooked = await applyFieldBeforeChange(
        getActiveBehaviorRegistry(), workspaceId, typeDef2, updates,
        { workspaceId },
      )
      if (hooked !== updates) Object.assign(updates, hooked)
      const componentRegistry = componentRegistryForWrite
      // BL-3: legacy repeater rows gain a stable _key (locale overlays address rows by it)
      Object.assign(updates, ensureContainerRowKeys(typeDef2, componentRegistry, updates))
      // C5: no prune here either. The admin sends the whole form on every save,
      // so pruning on update meant every unrelated edit deleted the values of
      // any sub-field that had been renamed or removed.
      // Reads expand media at every depth; an editor echoing one back must store ids, not asset snapshots
      Object.assign(updates, collapseMediaDeep(updates, typeDef2, componentRegistry))
      // Same for links: the editor echoes the resolved read back on autosave.
      Object.assign(updates, collapseLinksDeep(updates, typeDef2, componentRegistry))
      Object.assign(updates, normalizeRangeFieldValues(typeDef2.fields, updates))
    }

    // Validate changed custom field values
    if (typeDef2) {
      const changedCustomFields = typeDef2.fields.filter((f: any) => f.name in updates)
      if (changedCustomFields.length > 0) {
        const partial: Record<string, unknown> = {}
        for (const f of changedCustomFields) partial[f.name] = updates[f.name]
        const fieldErrors = validateFieldValues(changedCustomFields, partial, 'draft', customFieldTypeResolverFor(workspaceId))
        // Media constraints (accept categories / mimeTypes) need the assets' MIME types
        Object.assign(fieldErrors, await validateMediaConstraints(db, changedCustomFields, partial))
        if (Object.keys(fieldErrors).length > 0) {
          const first = Object.values(fieldErrors)[0]
          throw new RequestError('VALIDATION_ERROR', first, 422, fieldErrors)
        }
      }

      // Filtered relations (B3): changed relation values must match config.filter
      {
        const relErrors = await validateRelationFilters({ db, redis, schema, workspaceId }, typeDef2.fields as any[], updates)
        if (Object.keys(relErrors).length > 0) {
          throw new RequestError('VALIDATION_ERROR', Object.values(relErrors)[0], 422, relErrors)
        }
      }

      // Unique field checks (exclude self)
      for (const field of typeDef2.fields as any[]) {
        if (!isUniqueField(field) || !(field.name in updates)) continue
        const val = updates[field.name]
        if (val == null || val === '') continue
        if (typeof val === 'object') continue
        const col = safeId(field.name)
        const existing = await db.select({ id: table.id }).from(table)
          .where(and(eq(table.workspaceId, workspaceId), sql`${sql.raw(`"${col}"`)} = ${val}`, sql`id != ${id}`))
          .limit(1)
        if (existing.length > 0) {
          throw new RequestError('CONFLICT', `${field.label} already exists`, 409, { [field.name]: `${field.label} already exists` })
        }
      }
    }

    // Check slug uniqueness (exclude the current object itself)
    if (updates.slug) {
      const existing = await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.workspaceId, workspaceId), sql`"slug" = ${updates.slug as string}`, sql`id != ${id}`))
        .limit(1)
      if (existing.length > 0) {
        throw new RequestError('CONFLICT', `Slug "${updates.slug}" is already in use`, 409)
      }
    }

    // Fetch prev data for hook context, then run beforeChange
    const prevRows = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.workspaceId, workspaceId)))
      .limit(1)
    const prevData = (prevRows[0] ?? null) as Record<string, unknown> | null

    // A block's custom CSS (Studio's reserved `_studio.css`) is gated at the
    // store: a non-blank value the row did not already hold needs
    // `studio:creative`, whoever is writing (lib/studio-css-gate.ts).
    assertStudioCssAllowed({ permissions, memberId }, prevData, updates)

    const { cleanNextData, panelData } = extractPanelData(body as Record<string, unknown>)
    const extDataStore = createExtensionDataStore(db, workspaceId, redis)
    const globalsStore = createGlobalsStore(db, workspaceId)
    const hookCtxBase = {
    actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
      objectId: id,
      typeName,
      workspaceId,
      operation: 'update' as const,
      trigger,
      prevData,
      nextData: cleanNextData,
      panelData,
      extensionData: extDataStore,
      enqueue: makeEnqueue(workspaceId, ctx),
      globals: globalsStore,
    }
    const mutations = await runBeforeChange(db, projects, hookCtxBase)
    if (mutations) Object.assign(updates, mutations)
    // K4.1: content.beforeWrite@1 - the changed fields after hooks, before pruning and validation.
    {
      const filtered = await applyContentBeforeWrite({
        workspaceId, typeName, operation: 'update', locale: null, value: updates,
        context: { objectId: id, trigger, prevData, statusChange: hookCtxBase.statusChange ?? null, exec: ctx.exec ?? null },
      })
      if (filtered !== updates) { for (const k of Object.keys(updates)) delete updates[k]; Object.assign(updates, filtered) }
      // K4.2: content.validate@1, phase save, over the record as it will be.
      await applyContentValidate({
        workspaceId, typeName, locale: null, phase: 'save', record: { ...(prevData ?? {}), ...updates },
        context: { objectId: id, operation: 'update', changed: Object.keys(updates), prevData, exec: ctx.exec ?? null },
      })
    }

    // C5 write side. A normal schema-aware write may change what the CURRENT
    // definition presents; it may neither manufacture nor mutate historical
    // data. Stored keys the definition no longer lists are carried through
    // untouched (so a projected read/edit/write cycle cannot delete them), and
    // payload keys the definition does not list are dropped (so storage is not
    // a hidden writable API). A current field the payload omits still means
    // "cleared", exactly as before.
    if (typeDef2) Object.assign(updates, reconcileComponentWrite(typeDef2, componentRegistryForWrite, prevData, updates))

    // Transitioning to published via plain PATCH (the admin's status modal /
    // list actions do this) must write the snapshot like the publish route -
    // status='published' with no publishedValues serves LIVE draft columns
    // to the public view.
    // K4: a PATCH that flips to published is an update FOLLOWED BY the one
    // publish (publishObject), not a second publish implementation. The
    // status leaves the update; the publish runs on the saved row below.
    let publishAfter = false
    if (updates.status === 'published') {
      // Even when a hook decided the transition, the CALLER is performing a
      // publish - require the publish action (C1: no write-only publishes).
      if (prevData?.status !== 'published') assertObjectPermission(permissions, 'publish', typeName)
      publishAfter = true
      delete updates.status
    }

    // System columns (title, slug) use Drizzle column references.
    // Custom field columns are dynamic — use sql template with safeId-validated names.
    const systemSet: Record<string, unknown> = {}
    const customSetClauses: ReturnType<typeof sql>[] = []

    // text[] columns: only multiselect; everything else (repeater, component, json, object/many) is jsonb
    const multiselectFields = new Set(
      (typeDef2?.fields ?? []).filter((f: any) => f.fieldType === 'multiselect').map((f: any) => f.name)
    )
    // JSONB-backed columns, keyed by FIELD TYPE (not value shape). A richtext
    // body can legitimately be a bare string, which must still be written as
    // jsonb — binding it as a plain parameter makes Postgres reject it.
    const jsonbFields = new Set(
      (typeDef2?.fields ?? [])
        .filter((f: any) => f.fieldType === 'richtext' || f.fieldType === 'component' || f.fieldType === 'repeater' || f.fieldType === 'json')
        .map((f: any) => f.name)
    )

    for (const [col, val] of Object.entries(updates)) {
      if (col === 'title' || col === 'slug' || col === 'status' || col === 'publishedAt' || col === 'publishedBy') {
        systemSet[col] = val
      } else if (col === 'publishedValues') {
        // jsonb - goes through the raw-JSON clause path below
        customSetClauses.push(sql`${sql.raw('"published_values"')} = ${jsonbParam(val)}`)
      } else if (Array.isArray(val)) {
        const arr = val as unknown[]
        const isTextArray = multiselectFields.has(col)
        const isPrimitiveArray = arr.length > 0 && arr.every(v => v === null || typeof v !== 'object')
        if (isTextArray || isPrimitiveArray) {
          // TEXT[] columns (multiselect): ARRAY['a','b']::text[]
          customSetClauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${textArrayParam(arr)}`)
        } else {
          // JSONB array columns (repeater, component, json, object many): cast to jsonb
          customSetClauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${jsonbParam(arr)}`)
        }
      } else if (jsonbFields.has(col) || (val !== null && typeof val === 'object')) {
        // JSONB columns (richtext/component/repeater/json — by field type) AND any
        // other object value: JSON-encode + cast, so a bare string/number/null in
        // a jsonb column (e.g. a plain-string richtext body) is written correctly.
        // An empty value ('' / undefined) stores as null, never the jsonb string
        // "" (which would break array-typed editors like the block editor).
        const jsonVal = val === '' || val === undefined ? null : val
        customSetClauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${jsonbParam(jsonVal)}`)
      } else {
        customSetClauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${val}`)
      }
    }
    systemSet.updatedAt = new Date()
    // K3: the base-row update attributes who wrote it, as the localized branch and bulk always did.
    systemSet.updatedBy = resolveActorId(memberId, apiKeyId)
    systemSet.updatedByKind = attributionOf(writer).kind

    // Optimistic concurrency (Phase 6B, Unit 6): an `If-Match` makes this
    // write conditional on the version the caller read, and the condition is
    // the DATABASE's - part of the UPDATE, not a check before it - so two
    // writers racing cannot both win. No header means a blind write, which is
    // what every internal and pre-6B caller does.
    const expectedUpdatedAt = conditionalWrite(ctx.request?.headers)

    let rows: Record<string, unknown>[]
    try {
    if (customSetClauses.length === 0) {
      rows = await db
        .update(table)
        .set(systemSet)
        .where(and(
          eq(table.id, id), eq(table.workspaceId, workspaceId), ...(expectedUpdatedAt ? [sql`${table.updatedAt} = ${expectedUpdatedAt}::timestamptz`] : []),
        ))
        .returning()
    } else {
      // Mix system columns + custom field SET via raw SQL for the custom parts
      // updatedAt uses NOW() directly — passing a Date object through sql`` causes a serialization error
      const systemClauses = Object.entries(systemSet).map(([k, v]) => {
        if (k === 'updatedAt') return sql.raw('"updated_at" = NOW()')
        // Dates serialize badly through sql`` params - and camelCase keys must
        // hit their snake_case columns on this raw path.
        if (k === 'publishedAt') return sql.raw('"published_at" = NOW()')
        if (k === 'publishedBy') return sql`${sql.raw('"published_by"')} = ${v}`
        if (k === 'updatedBy') return sql`${sql.raw('"updated_by"')} = ${v}`
        if (k === 'updatedByKind') return sql`${sql.raw('"updated_by_kind"')} = ${v}`
        return sql`${sql.raw(`"${safeId(k)}"`)} = ${v}`
      })
      const allClauses = sql.join([...systemClauses, ...customSetClauses], sql.raw(', '))
      const result = await db.execute(
        expectedUpdatedAt
          ? sql`UPDATE ${table} SET ${allClauses} WHERE ${table.id} = ${id} AND ${table.workspaceId} = ${workspaceId} AND ${table.updatedAt} = ${expectedUpdatedAt}::timestamptz RETURNING *`
          : sql`UPDATE ${table} SET ${allClauses} WHERE ${table.id} = ${id} AND ${table.workspaceId} = ${workspaceId} RETURNING *`,
      )
      rows = (Array.isArray(result) ? result : (result as any).rows ?? []) as Record<string, unknown>[]
    }
    } catch (err) {
      // The preflight above is advisory; the database's unique index on
      // (slug) is the authority, and a race that slips past the
      // preflight surfaces here as the same 409 the preflight would have given.
      if (isSlugUniqueViolation(err)) throw new RequestError('CONFLICT', `Slug "${updates.slug}" is already in use`, 409)
      throw err
    }

    // The new version's token, so a client that just wrote can write again
    // without rereading (Phase 6B, Unit 6).
    if (rows.length > 0) await attachObjectEtag(ctx, db, table, { id, workspaceId })

    if (!rows.length) {
      // Nothing matched. With a condition, that is either a gone object or -
      // the case worth naming - one that moved on since the caller read it.
      if (expectedUpdatedAt) {
        const current = await readUpdatedAtText(db, table, { id, workspaceId })
        if (current !== null) throw staleObjectError(typeName, id, current)
      }
      throw new RequestError('NOT_FOUND', `Object "${id}" not found`, 404)
    }

    // The update path has no transaction of its own - a pre-existing shape,
    // recorded and deliberately not changed here - so this cannot be atomic
    // with the row the way a create is. It is still one statement, and still
    // the same engine, so search stays in step; it just cannot promise the two
    // committed together. That is a reason to give update a transaction, not a
    // reason to leave search stale.
    await ctx.searchEngineRef?.onWrite?.(ctx, db, { workspaceId, typeName, objectId: id, row: rows[0] as Record<string, unknown> })

    // Only what genuinely changed reaches the event (and the prevData it carries).
    const changedFields = diffChangedFields(requestedFields, prevData, rows[0] as Record<string, unknown>)
    const schemaDef = schema.types.find((t: any) => t.name === typeName)
    const versioningEnabled = (schemaDef?.admin as any)?.versioning?.enabled !== false
    const maxVersions: number = (schemaDef?.admin as any)?.versioning?.maxVersions ?? 10
    if (versioningEnabled) {
      const extDataSnapshot = await buildExtensionDataSnapshot(db, workspaceId, id)
      if (skipRevision) {
        // Auto-save: keep one rolling autosave revision (upsert in place)
        await upsertAutoSave(db, {
          objectId: id, workspaceId, typeId, typeName,
          row: rows[0], createdBy: memberId ?? apiKeyId ?? null, extDataSnapshot,
        })
      } else {
        // Manual save: promote to a real checkpoint; autosave is now redundant
        await createRevision(db, {
          objectId: id, workspaceId, typeId, typeName,
          row: rows[0], createdBy: memberId ?? apiKeyId ?? null, maxVersions,
          versionType: 'draft', extDataSnapshot, dropAutosave: true,
        })
      }
    }

    // Extension panel data rides on this save and is persisted by the
    // extensions' after-change hooks. When the save carries any, those hooks
    // run BEFORE the event goes out, so a listener that refreshes on the
    // event reads the panel data the save meant (2026-09-13); a save with no
    // panel data keeps after-change off the request's critical path.
    const changedPanels = Object.keys(panelData ?? {})
    if (changedPanels.length > 0) {
      await runAfterChange(db, projects, { ...hookCtxBase, savedData: rows[0] }).catch(() => {})
    }

    // K5: the record, then the bus. (This write is not transactional today;
    // the record follows the row - see the kernel plan's K5 closure notes.)
    await emitRecorded(eventBus, db, buildEvent({
      type: 'object.updated', workspaceId, resource: { kind: 'object', type: typeName, id },
      payload: {
        objectId: id, typeId, typeSlug: typeName, slug: (rows[0] as Record<string, unknown>).slug ?? null, title: String(rows[0].title ?? ''), changedFields, changedPanels, trigger,
        // Old values of just the changed fields - flow conditions/templates
        // read them as trigger.prev.<field> (kept lean on purpose).
        prevData: prevData ? Object.fromEntries(changedFields.map((f) => [f, (prevData as Record<string, unknown>)[f]])) : {},
        updatedBy: resolveActorId(memberId, apiKeyId),
      },
    }, writer))

    if (changedPanels.length === 0) runAfterChange(db, projects, { ...hookCtxBase, savedData: rows[0] }).catch(() => {})
    if (publishAfter) {
      // The update is saved, revisioned and evented; now the one publish
      // (validation, hooks, snapshot, revision, event, attribution).
      const published = await publishObject({
        db, redis, eventBus, schema, workspaceId, memberId: memberId ?? null, apiKeyId: apiKeyId ?? null, memberRole: ctx.memberRole ?? null,
        permissions, projects, ctx,
      }, typeName, id)
      rows = [published as Record<string, unknown>]
    }
    // C5: a PATCH that moves status moves the extension state with it. Both
    // directions matter here - the admin's status modal publishes and
    // unpublishes through this route, not only through /publish.
    if (typeof updates.status === 'string' && updates.status !== prevData?.status) {
      await syncPublishedExtensionData(db, redis, workspaceId, id, updates.status as string)
    }
    clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})

    // BL-3: structure edits orphan per-locale overlay entries — GC them now
    if (typeDef2) {
      const containerUpdates: Record<string, unknown> = {}
      for (const f of typeDef2.fields as Array<{ name: string; fieldType: string }>) {
        if ((f.fieldType === 'component' || f.fieldType === 'repeater') && f.name in updates) {
          containerUpdates[f.name] = updates[f.name]
        }
      }
      if (Object.keys(containerUpdates).length > 0) {
        pruneContainerOverlays(db, typeName, id, containerUpdates).catch(() => {})
      }
    }

    const warnings = collectFieldWarnings((typeDef2?.fields ?? []) as any[], updates)
    // RETURNING hands NUMERIC columns back as strings; the answer must agree with a read.
    // It also hands back every column the TABLE has, including one a destructive
    // push guarded aside - which is a recovery artifact, not content (Unit 8).
    const [projected] = projectToTableColumns([rows[0] as Record<string, unknown>], table as never)
    const [responseRow] = coerceNumericFields([projected as Record<string, unknown>], typeDef2 as never)
    return { data: { ...responseRow, type: typeName }, ...(Object.keys(warnings).length ? { warnings } : {}) }
}


