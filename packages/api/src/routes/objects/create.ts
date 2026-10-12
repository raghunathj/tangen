/**
 * File Name: create.ts
 * Purpose: Handles POST /api/v1/objects — validates the request body, enforces unique
 *          constraints, resolves slug collisions, inserts the new content object, and
 *          fires before/after hooks plus a domain event.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia route handler; uses Drizzle ORM against dynamically-generated
 *   content tables; integrates with the hook runner and event bus.
 */
import { randomUUID } from 'node:crypto'
import { buildPublishedValues } from '../../services/publish-snapshot'
import { eq, and, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import { RequestError } from '../../lib/errors'
import { resolveActorId, hookActor } from '../../lib/actor'
import { applyFieldDefaults } from '../../services/field-defaults'
import { validateRelationFilters } from '../../services/relation-filter'
import { ensureContainerRowKeys } from '../../services/component-relation-expansion'
import { reconcileComponentWrite } from '../../services/component-projection'
import { collapseMediaDeep } from '../../services/media-loader'
import { collapseLinksDeep } from '../../services/link-loader'
import { assertObjectPermission } from '../../lib/permissions'
import { assertStudioCssAllowed } from '../../lib/studio-css-gate'
import { projectLocalization } from '../../services/i18n'
import { fieldAccessContext, restrictedWriteFields, stripRestrictedWrites, canWriteLocale, assertGrantedWrite } from '../../lib/field-access'
import { createRevision } from '../../lib/revisions'
import { nextFreeSlug, isSlugUniqueViolation, SLUG_MAX_ATTEMPTS } from '../../lib/slugs'
import { coerceNumericFields } from '../../services/local-client'
import { validateFieldValues, normalizeDateFieldValues, normalizeRangeFieldValues, publishValidationError, isUniqueField, collectFieldWarnings } from '../../services/field-validator'
import { validateMediaConstraints } from '../../services/media-constraints'
import { createExtensionDataStore, runBeforeChange, runAfterChange, syncPublishedExtensionData } from '../../hooks/runner'
import { applyContentBeforeWrite, applyContentValidate } from '../../services/content-filters'
import { applyFieldBeforeChange, getActiveBehaviorRegistry } from '../../services/field-behavior'
import { createGlobalsStore } from '../../services/globals-store'
import { clearTypeQueryCache } from '../../services/route-cache'
import { makeEnqueue } from '../../services/task-queue'
import { customFieldTypeResolverFor } from '../../hooks/app-hooks-registry'
import { isSafeIdent } from '@tangen/types'
import { buildEvent, recordEvent, attributionOf } from '../../kernel/events'
import { publishObject } from '../../services/publish-object'

function safeColId(name: string): string {
  if (!isSafeIdent(name)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid field name: "${name}"`)
  }
  return name
}

export interface CreatePayload {
  typeName: string
  typeId: string
  title: string
  slug: string | null
  status: 'draft' | 'published' | 'archived'
  fieldValues: Record<string, unknown>
}

/**
 * Validates and normalises the raw POST body into a typed CreatePayload.
 * @param body - Raw request body (expected to be a plain object).
 * @param schema - Workspace schema definition used to look up the target type and validate fields.
 * @returns A fully-resolved CreatePayload ready for database insertion.
 */
export function buildCreatePayload(body: unknown, schema: SchemaDefinition, scope?: { workspaceId: string}): CreatePayload {
  if (!body || typeof body !== 'object') {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object')
  }

  const { type, title, slug, status, ...rest } = body as Record<string, unknown>

  if (!type || typeof type !== 'string') {
    throw new RequestError('VALIDATION_ERROR', 'Missing required field: type')
  }

  const typeDef = schema.types.find(t => t.name === type)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${type}" not found in schema`)
  }

  if (!title || typeof title !== 'string' || title.trim() === '') {
    // __title keys the admin editor's title input highlight (same as publish)
    throw new RequestError('VALIDATION_ERROR', 'Title is required', 422, { __title: 'Title is required' })
  }

  // Reject unknown field keys
  const knownFields = new Set(typeDef.fields.map(f => f.name))
  for (const key of Object.keys(rest)) {
    if (!knownFields.has(key)) {
      throw new RequestError('FIELD_NOT_FOUND', `Unknown field: "${key}" is not defined on type "${type}"`)
    }
  }

  // Validate field values against schema constraints
  const fieldErrors = validateFieldValues(typeDef.fields, rest, 'draft', scope ? customFieldTypeResolverFor(scope.workspaceId) : undefined)
  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.values(fieldErrors)[0]
    throw new RequestError('VALIDATION_ERROR', first, 422, fieldErrors)
  }

  // Build field values from schema-declared fields only
  const fieldValues: Record<string, unknown> = {}
  for (const field of typeDef.fields) {
    if (rest[field.name] !== undefined) {
      fieldValues[field.name] = rest[field.name]
    }
  }

  const validStatuses = ['draft', 'published', 'archived'] as const
  const resolvedStatus = validStatuses.includes(status as any) ? (status as typeof validStatuses[number]) : 'draft'

  return {
    typeName: type,
    typeId: typeDef.id ?? type,
    title: title.trim(),
    slug: typeof slug === 'string' && slug.trim() ? slug.trim() : null,
    status: resolvedStatus,
    fieldValues,
  }
}

/**
 * Registers the POST /api/v1/objects route on the given Elysia app.
 * @param projects - Loaded workspace project configs used by the hook runner.
 * @returns An Elysia plugin function that mounts the create route.
 */
/** Builds the create handler; ctx.body.type carries the content type. */
export const makeCreateHandler = (projects: any[]) => async (ctx: any) => {
    const { body, db, redis, eventBus, workspaceId, apiKeyId, memberId, schema, permissions } = ctx
    if (ctx.query?.locale) {
      throw new RequestError('VALIDATION_ERROR', 'Objects are created in the default locale - add translations after creation', 422)
    }

    const { typeName, typeId, title, slug, status, fieldValues: prefilterFieldValues } = buildCreatePayload(body, schema, { workspaceId })

    // Media constraints (accept categories / mimeTypes) need the assets' MIME
    // types — async lookup, so it runs here rather than in the sync payload builder
    {
      const typeDefForMedia = schema.types.find((t) => t.name === typeName)
      if (typeDefForMedia) {
        const mediaErrors = await validateMediaConstraints(db, typeDefForMedia.fields, prefilterFieldValues)
        if (Object.keys(mediaErrors).length > 0) {
          const first = Object.values(mediaErrors)[0]
          throw new RequestError('VALIDATION_ERROR', first, 422, mediaErrors)
        }
      }
    }

    // Creating directly as published must clear the same bar as the publish
    // route — otherwise a required field could be skipped via create-as-published.
    if (status === 'published') {
      const typeDefForPublish = schema.types.find((t) => t.name === typeName)
      const err = publishValidationError(typeDefForPublish, { title, ...prefilterFieldValues })
      if (err) throw new RequestError('VALIDATION_ERROR', err, 422)
    }

    assertObjectPermission(permissions, 'write', typeName)
    // Creating directly as published IS a publish - the write action alone
    // must not mint published content (C1: publish-permission coverage).
    if (status === 'published') assertObjectPermission(permissions, 'publish', typeName)
    // Locale-restricted roles may not touch the default language / base object
    {
      const project = (ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)
      if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
        throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - base content is locked', 403)
      }
    }


    // Field-level access: strip fields the member's role may not write
    // (API keys and admin sessions unaffected — v1 contract)
    const typeDefForAccess = schema.types.find((t: any) => t.name === typeName)
    const accessCtx = fieldAccessContext(ctx)
    // K1.3: a grant allow-list refuses a field outside it (title included) before anything is stripped.
    assertGrantedWrite({ ...prefilterFieldValues, title }, typeDefForAccess, accessCtx)
    const { values: rawFieldValues, stripped: strippedFields } = stripRestrictedWrites(
      prefilterFieldValues,
      restrictedWriteFields(typeDefForAccess, accessCtx),
    )
    if (strippedFields.length > 0) {
      ctx.set.headers['X-Tangen-Restricted-Fields'] = strippedFields.join(',')
    }

    // Field-level beforeChange hooks (behavior overlay) — run before
    // everything else so normalized values hit uniqueness checks and storage
    const typeDefForHooks = schema.types.find((t: any) => t.name === typeName)
    // Fill absent fields from config.default (static or { $dynamic }) BEFORE hooks +
    // validation, so required-with-default passes and REST creates get defaults too.
    const defaultedValues = typeDefForHooks
      ? applyFieldDefaults(typeDefForHooks.fields, rawFieldValues, { actorId: resolveActorId(memberId, apiKeyId) })
      : rawFieldValues
    const fieldValues = typeDefForHooks
      ? await applyFieldBeforeChange(
          getActiveBehaviorRegistry(), workspaceId, typeDefForHooks, defaultedValues,
          { workspaceId },
        )
      : rawFieldValues

    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError('TYPE_NOT_FOUND', `Table for type "${typeName}" not yet generated - run tangen push`)
    }

    // Filtered relations (B3): written ids must match the field's config.filter
    if (typeDefForHooks) {
      const relErrors = await validateRelationFilters({ db, redis, schema, workspaceId }, typeDefForHooks.fields, fieldValues)
      if (Object.keys(relErrors).length > 0) {
        throw new RequestError('VALIDATION_ERROR', Object.values(relErrors)[0], 422, relErrors)
      }
    }

    // Check unique field constraints
    const typeDef2 = schema.types.find((t: any) => t.name === typeName)
    if (typeDef2) {
      for (const field of typeDef2.fields) {
        if (!isUniqueField(field)) continue
        const val = fieldValues[field.name]
        if (val == null || val === '') continue
        if (typeof val === 'object') continue  // skip complex types
        const col = safeColId(field.name)
        const existing = await db.select({ id: table.id }).from(table)
          .where(and(eq(table.workspaceId, workspaceId), sql`${sql.raw(`"${col}"`)} = ${val}`))
          .limit(1)
        if (existing.length > 0) {
          throw new RequestError('CONFLICT', `${field.label} already exists`, 409, { [field.name]: `${field.label} already exists` })
        }
      }
    }

    // A free slug - `slug`, then `slug-1`, `slug-2` … - found with one
    // index-backed probe rather than one SELECT per candidate. The probe is a
    // convenience; the database's unique index on (slug) is the
    // authority, and the insert below retries on its refusal.
    const execSql = async (q: any) => { const r = await db.execute(q); return (Array.isArray(r) ? r : (r as any).rows ?? []) as Array<Record<string, unknown>> }
    let finalSlug = slug ? await nextFreeSlug(execSql, { tableName: typeName, base: slug }) : slug

    const id = randomUUID()
    // A block's custom CSS (Studio's reserved `_studio.css`) needs
    // `studio:creative` from the first save (lib/studio-css-gate.ts).
    assertStudioCssAllowed({ permissions, memberId }, null, fieldValues)
    const extDataStore = createExtensionDataStore(db, workspaceId, redis)
    const globalsStore = createGlobalsStore(db, workspaceId)
    const hookCtxBase = {
    actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
      objectId: id,
      typeName,
      workspaceId,
      operation: 'create' as const,
      trigger: 'manual' as const,
      prevData: null,
      nextData: { title, slug: finalSlug, ...fieldValues },
      // C1: creating straight as published IS a publish - without this the
      // gate hooks that key off statusChange (e.g. the review extension) never
      // fire and create-as-published becomes a bypass. Nothing existed before,
      // so 'draft' is the honest baseline.
      ...(status !== 'draft' ? { statusChange: { from: 'draft', to: status } } : {}),
      extensionData: extDataStore,
      enqueue: makeEnqueue(workspaceId, ctx),
      globals: globalsStore,
    }

    // beforeChange — may mutate fields before insert
    const mutations = await runBeforeChange(db, projects, hookCtxBase)
    // K4.1: content.beforeWrite@1 - the record after hooks, before pruning and validation.
    const merged = await applyContentBeforeWrite({
      workspaceId, typeName, operation: 'create', locale: null,
      value: mutations ? { ...fieldValues, ...mutations } : fieldValues,
      context: { objectId: hookCtxBase.objectId, trigger: hookCtxBase.trigger, prevData: null, statusChange: hookCtxBase.statusChange ?? null, exec: ctx.exec ?? null },
    })
    // K4.2: content.validate@1, phase save - every active extension's findings, merged.
    await applyContentValidate({
      workspaceId, typeName, locale: null, phase: 'save', record: { title, slug, ...merged },
      context: { objectId: hookCtxBase.objectId, operation: 'create', prevData: null, exec: ctx.exec ?? null },
    })
    // date fields arrive as ISO strings over JSON — drizzle timestamp columns need Dates
    const componentRegistry = ((ctx.workspaceProjects as any[] | undefined)?.find((p) => p.workspaceId === workspaceId)?.components ?? []) as never
    // Reads expand media at every depth; a client echoing one back must store ids, not asset snapshots
    // C5: no prune. A write stores what it was given; it does not delete
    // component sub-field values whose key the current schema no longer lists.
    // There is no stored row yet, so the write rule reduces to its other half:
    // a create may only store sub-fields the current definition declares, and
    // cannot invent historical data by sending keys the schema does not list.
    // A client echoing a read stores identity again, never the facts that read
    // resolved - the same rule media follows for asset ids.
    const prunedMerged = typeDefForHooks
      ? collapseLinksDeep(collapseMediaDeep(
          reconcileComponentWrite(typeDefForHooks, componentRegistry, null,
            ensureContainerRowKeys(typeDefForHooks, componentRegistry, merged)),
          typeDefForHooks, componentRegistry), typeDefForHooks, componentRegistry)
      : merged
    const finalValues = typeDefForHooks
      ? normalizeRangeFieldValues(typeDefForHooks.fields, normalizeDateFieldValues(typeDefForHooks, prunedMerged))
      : prunedMerged

    // The content row and its first revision are ONE mutation. Before this, a
    // failing revision left the object created with no history, and the
    // response had already been shaped from the returned row. Only the core
    // mutation is inside: audit, activity, webhooks, jobs and extension events
    // keep their existing post-write semantics deliberately, so this changes
    // atomicity for exactly the pair that needed it.
    // The whole mutation retries on a slug conflict: another create took the
    // candidate between the probe and this insert. A bounded number of times,
    // re-probing each time, so a burst of identical slugs resolves to
    // slug, slug-1, slug-2 … without a single duplicate and without the
    // preflight having to be right.
    let attempt = 0
    // K4/K5: created AS published means created, then the one publish
    // (publishObject) - no inline snapshot writer here. The row is inserted
    // as a draft and published right after, so the snapshot exists before
    // the response and object.published is emitted like every publish.
    const writer = { exec: ctx.exec ?? null, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }
    const createdEvent = buildEvent({
      type: 'object.created', workspaceId, resource: { kind: 'object', type: typeName, id },
      payload: { objectId: id, typeId, typeSlug: typeName, title, createdBy: resolveActorId(memberId, apiKeyId) },
    }, writer)
    const runCreate = async () => db.transaction(async (tx: any) => {
    const rows = await tx
      .insert(table)
      .values({
        id, workspaceId, title, slug: finalSlug, status: status === 'published' ? 'draft' : status,
        createdBy: resolveActorId(memberId, apiKeyId), createdByKind: attributionOf(writer).kind, ...finalValues,
      })
      .returning()

    const inserted = rows[0] as Record<string, unknown>

    // Create initial revision so version history starts from the first save
    const schemaDef = schema.types.find((t: any) => t.name === typeName)
    const versioningEnabled = (schemaDef?.admin as any)?.versioning?.enabled !== false
    const maxVersions: number = (schemaDef?.admin as any)?.versioning?.maxVersions ?? 10
    // The revision and the search document both derive from `inserted` and
    // from nothing else, so they are issued together. On a transaction's
    // reserved connection postgres.js pipelines statements that are in flight
    // at once - sent back to back, executed in order, one network round trip
    // for the pair instead of one each. The atomicity is unchanged: both are
    // inside this transaction, and if either fails the transaction is aborted
    // and rolled back exactly as before; the tests that prove that still pass.
    // Under an eventual search engine onWrite returns false and the queue does
    // the indexing, also unchanged.
    await Promise.all([
      versioningEnabled
        ? createRevision(tx, { objectId: id, workspaceId, typeId, typeName, row: inserted, createdBy: resolveActorId(memberId, apiKeyId), maxVersions })
        : Promise.resolve(),
      ctx.searchEngineRef?.onWrite?.(ctx, tx, { workspaceId, typeName, objectId: id, row: inserted }) ?? Promise.resolve(false),
      // K5: the event record is part of the mutation.
      recordEvent(tx, createdEvent, { inTransaction: true }),
    ])
    return { row: inserted, revisionCreated: versioningEnabled }
    })
    let created: { row: Record<string, unknown>; revisionCreated: boolean }
    for (;;) {
      try { created = await runCreate(); break } catch (err) {
        if (!slug || !isSlugUniqueViolation(err) || ++attempt >= SLUG_MAX_ATTEMPTS) {
          if (slug && isSlugUniqueViolation(err)) throw new RequestError('CONFLICT', `No unique slug available for "${slug}" after ${SLUG_MAX_ATTEMPTS} attempts`, 409)
          throw err
        }
        finalSlug = await nextFreeSlug(execSql, { tableName: typeName, base: slug, spread: attempt })
      }
    }
    let { row } = created
    void created.revisionCreated

    eventBus.emit(createdEvent)
    if (status === 'published') {
      row = await publishObject({
        db, redis, eventBus, schema, workspaceId, memberId: memberId ?? null, apiKeyId: apiKeyId ?? null, memberRole: ctx.memberRole ?? null,
        permissions, projects, ctx, exec: ctx.exec ?? null,
      }, typeName, id) as Record<string, unknown>
    }

    // afterChange — fire-and-forget (errors are logged, not surfaced)
    runAfterChange(db, projects, { ...hookCtxBase, savedData: row }).catch(() => {})
    // C5: created directly as published, so its extension state is published
    // too. A beforeChange hook may have written extension rows during this
    // very request, which is why this runs after the hooks and not before.
    if (status === 'published') await syncPublishedExtensionData(db, redis, workspaceId, id, 'published')
    clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})

    // Non-blocking guidance (B4) — never fails the write, the editor renders amber
    const warnings = typeDefForHooks ? collectFieldWarnings(typeDefForHooks.fields, fieldValues) : {}
    // The row comes back from RETURNING with NUMERIC columns as strings; reads
    // coerce them, and the write's own answer must agree with the next read.
    const [responseRow] = coerceNumericFields([row as Record<string, unknown>], typeDefForHooks)
    return new Response(
      JSON.stringify({ data: { ...responseRow, type: typeName }, ...(Object.keys(warnings).length ? { warnings } : {}) }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    )
}


