/**
 * File Name: bulk-update.ts
 * Purpose: POST /api/v1/objects/bulk-update — applies a set of flat field
 *   changes to multiple content objects of the same type in a single request,
 *   running beforeChange / afterChange lifecycle hooks per object and emitting
 *   object.updated events.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, drizzle-orm, @tangen/db, hooks/runner,
 *   globals-store, route-cache; only flat field types are bulk-editable
 */
import { randomUUID } from 'node:crypto'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { contentTables } from '@tangen/db/content-tables'
import type { SchemaDefinition } from '@tangen/types'
import { flattenFields } from '@tangen/types'
import { jsonbParam, textArrayParam } from '../../lib/sql-values'
import { RequestError } from '../../lib/errors'
import { internalErrorResponse, requestIdFor, type ErrorDetailMode } from '../../lib/internal-error'
import { resolveActorId, hookActor } from '../../lib/actor'
import { assertObjectPermission } from '../../lib/permissions'
import { canWriteLocale } from '../../lib/field-access'
import { projectLocalization } from '../../services/i18n'
import { createExtensionDataStore, runBeforeChange, runAfterChange, syncPublishedExtensionData } from '../../hooks/runner'
import { createGlobalsStore } from '../../services/globals-store'
import { clearTypeQueryCache } from '../../services/route-cache'
import { makeEnqueue } from '../../services/task-queue'
import { publishValidationError } from '../../services/field-validator'
import { isSafeIdent } from '@tangen/types'
import { createExecution } from '../../kernel/execution'
import { actorFromContext, systemActor } from '../../kernel/actor'
import { contentUpdate } from '../../domain/content/write'
import { lifecyclePublish, lifecycleUnpublish } from '../../domain/lifecycle'
import { buildEvent, emitRecorded, attributionOf } from '../../kernel/events'

// ── Constants ──────────────────────────────────────────────────────────────────

const EXCLUDED_SYSTEM_FIELDS = new Set(['id', 'title', 'slug'])
const EXCLUDED_FIELD_TYPES   = new Set(['richtext', 'repeater', 'component', 'section', 'group'])
const VALID_STATUSES         = new Set(['draft', 'published', 'archived'])

// ── Pure validation (exported for unit tests) ─────────────────────────────────

export interface BulkUpdatePayload {
  typeName: string
  typeId:   string
  ids:      string[]
  /** Only flat, bulk-editable fields (plus status). */
  fields:   Record<string, unknown>
}

/**
 * Validates a bulk-update request body and returns the resolved payload.
 * Throws `RequestError` on any validation failure.
 *
 * Allowed fields:
 * - `status` (system field — explicit allowlist: draft | published | archived)
 * - Any custom flat field: text, textarea, email, url, phone, number, date,
 *   boolean, select, multiselect, relation, media
 *
 * Always rejected:
 * - `title`, `slug`, `id`
 * - Fields with type: richtext, repeater, component, section, group
 * @param body   - Raw request body
 * @param schema - Workspace schema definition used to look up field types
 * @returns Validated BulkUpdatePayload with allowed fields only
 */
export function buildBulkUpdatePayload(
  body:   unknown,
  schema: SchemaDefinition,
): BulkUpdatePayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object')
  }
  const input = body as Record<string, unknown>

  // ── type ──
  if (typeof input.type !== 'string' || !input.type) {
    throw new RequestError('VALIDATION_ERROR', 'Missing required field: type')
  }
  const typeDef = schema.types.find(t => t.name === input.type)
  if (!typeDef || typeDef.disabled) {
    throw new RequestError('TYPE_NOT_FOUND', `Type "${input.type}" not found in schema`)
  }

  // ── ids ──
  if (!Array.isArray(input.ids) || input.ids.length === 0) {
    throw new RequestError('VALIDATION_ERROR', 'ids must be a non-empty array of strings')
  }
  if (!(input.ids as unknown[]).every(id => typeof id === 'string')) {
    throw new RequestError('VALIDATION_ERROR', 'All ids must be strings')
  }

  // ── fields ──
  if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) {
    throw new RequestError('VALIDATION_ERROR', 'fields must be an object')
  }
  const rawFields = input.fields as Record<string, unknown>

  if (Object.keys(rawFields).length === 0) {
    throw new RequestError('VALIDATION_ERROR', 'fields must not be empty')
  }

  const fieldMap = new Map(flattenFields(typeDef.fields).map(f => [f.name, f]))
  const allowedFields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(rawFields)) {
    if (EXCLUDED_SYSTEM_FIELDS.has(key)) {
      throw new RequestError('VALIDATION_ERROR', `Field "${key}" cannot be bulk-updated`)
    }

    if (key === 'status') {
      if (typeof value !== 'string' || !VALID_STATUSES.has(value)) {
        throw new RequestError(
          'VALIDATION_ERROR',
          `status must be one of: ${[...VALID_STATUSES].join(', ')}`,
        )
      }
      allowedFields.status = value
      continue
    }

    const fieldDef = fieldMap.get(key)
    if (!fieldDef) {
      throw new RequestError('FIELD_NOT_FOUND', `Field "${key}" not found in type "${input.type}"`)
    }
    if (EXCLUDED_FIELD_TYPES.has(fieldDef.fieldType)) {
      throw new RequestError(
        'VALIDATION_ERROR',
        `Field "${key}" (type: ${fieldDef.fieldType}) cannot be bulk-updated`,
      )
    }

    allowedFields[key] = value
  }

  return {
    typeName: input.type as string,
    typeId:   typeDef.id ?? (input.type as string),
    ids:      input.ids as string[],
    fields:   allowedFields,
  }
}

/**
 * When a bulk update publishes an object, it must clear the same bar as the
 * dedicated publish route: a non-empty title and all publish-mode field rules
 * (required, format) against the MERGED record (existing row + bulk change).
 * Returns the first error message, or null when the object may be published.
 * `merged` keys are field names (drizzle row columns match field names).
 */
export function bulkPublishError(
  typeDef: { fields: unknown[] } | undefined,
  merged: Record<string, unknown>,
): string | null {
  return publishValidationError(typeDef as never, merged)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates that a column name is a safe SQL identifier to prevent injection
 * when constructing raw SQL SET clauses.
 * @param name - Column name to validate
 * @returns The unchanged name if valid
 */
function safeId(name: string): string {
  if (!isSafeIdent(name)) {
    throw new RequestError('VALIDATION_ERROR', `Invalid identifier: "${name}"`)
  }
  return name
}

/**
 * Builds the SQL SET clauses for the allowed fields, correctly encoding
 * text arrays (multiselect), JSONB arrays (repeaters), JSONB objects, and
 * scalar values. Mirrors the equivalent logic in update.ts.
 * @param fields           - Field name-to-value map to apply
 * @param multiselectNames - Set of field names whose values are text arrays
 * @returns Array of drizzle sql-tagged SET clause fragments
 */
function buildSetClauses(
  fields:           Record<string, unknown>,
  multiselectNames: Set<string>,
  jsonbNames:       Set<string> = new Set(),
): ReturnType<typeof sql>[] {
  const clauses: ReturnType<typeof sql>[] = []

  for (const [col, val] of Object.entries(fields)) {
    if (col === 'status') {
      clauses.push(sql`"status" = ${val as string}`)
      continue
    }
    if (Array.isArray(val)) {
      const arr = val as unknown[]
      const isTextArray = multiselectNames.has(col)
      const isPrimArray = arr.length > 0 && arr.every(v => v === null || typeof v !== 'object')
      if (isTextArray || isPrimArray) {
        clauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${textArrayParam(arr)}`)
      } else {
        clauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${jsonbParam(arr)}`)
      }
    } else if (jsonbNames.has(col) || (val !== null && typeof val === 'object')) {
      const jsonVal = val === '' || val === undefined ? null : val
      clauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${jsonbParam(jsonVal)}`)
    } else {
      clauses.push(sql`${sql.raw(`"${safeId(col)}"`)} = ${val}`)
    }
  }

  return clauses
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * Registers POST /api/v1/objects/bulk-update.
 * Processes each object ID sequentially: runs the beforeChange hook (which may
 * mutate fields), executes a raw UPDATE RETURNING, emits an object.updated
 * event, and fires the afterChange hook fire-and-forget. Per-object failures
 * are collected in the errors array rather than aborting the entire batch.
 * @param projects - Array of workspace project configs providing hook definitions
 * @returns An Elysia plugin function that mounts the route
 */
/**
 * One item's failure in the bulk response. A RequestError is the caller's to
 * read (validation, permission); anything else is an unmapped exception and
 * follows the INTERNAL contract - redacted on a production-like deployment,
 * logged under the request id, the id in the item so it can be reported.
 */
export function bulkItemError(err: unknown, mode?: ErrorDetailMode): { message: string; code?: string; errorId?: string } {
  if (err instanceof Error && err.name === 'RequestError') return { message: err.message, code: (err as RequestError).code }
  const id = requestIdFor(undefined)
  const internal = internalErrorResponse(err, { id, route: 'objects.bulk-update', mode })
  return { message: internal.error.message, code: internal.error.code, errorId: id }
}

export const bulkUpdateObjectsRoute = (projects: any[]) => (app: Elysia) =>
  app.post('/api/v1/objects/bulk-update', async (ctx: any) => {
    if (ctx.query?.locale || (ctx.body as any)?.locale) {
      throw new RequestError('VALIDATION_ERROR', 'Bulk update works on the default locale only', 422)
    }
    const { body, db, redis, eventBus, schema, workspaceId, apiKeyId, memberId, permissions } = ctx

    const { typeName, typeId, ids, fields } = buildBulkUpdatePayload(body, schema)

    assertObjectPermission(permissions, 'write', typeName)
    // A bulk status flip to published is a publish (C1) - gate it up front so
    // a write-only role cannot mass-publish.
    if ((fields as Record<string, unknown>).status === 'published') {
      assertObjectPermission(permissions, 'publish', typeName)
    }
      // Locale-scoped roles cannot publish/restore/bulk-write — base rights required
      {
        const project = (ctx.workspaceProjects as any[] | undefined)?.find((p: any) => p.workspaceId === workspaceId)
        if (!canWriteLocale(ctx, null, projectLocalization(project)?.defaultLocale)) {
          throw new RequestError('FORBIDDEN', 'Your role can only edit specific languages - this action needs base-language rights', 403)
        }
      }


    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) {
      throw new RequestError(
        'TYPE_NOT_FOUND',
        `Table for type "${typeName}" not yet generated - run tangen push`,
      )
    }

    const typeDef   = schema.types.find((t: any) => t.name === typeName)
    const msFields  = new Set<string>(
      (typeDef?.fields ?? [])
        .filter((f: any) => f.fieldType === 'multiselect')
        .map((f: any) => f.name as string),
    )
    // JSONB-backed columns by field type (richtext/component/repeater are excluded
    // from bulk edits above, so this is effectively `json` — but keep it robust).
    const jsonbFields = new Set<string>(
      (typeDef?.fields ?? [])
        .filter((f: any) => ['richtext', 'component', 'repeater', 'json'].includes(f.fieldType))
        .map((f: any) => f.name as string),
    )

    const setClauses = buildSetClauses(fields, msFields, jsonbFields)

    // Fetch all prev rows in one query for hook context.
    const prevRows: Record<string, unknown>[] = await db
      .select()
      .from(table)
      .where(and(eq(table.workspaceId, workspaceId), inArray(table.id, ids)))

    const prevMap = new Map<string, Record<string, unknown>>(
      prevRows.map(r => [r.id as string, r]),
    )

    const extDataStore  = createExtensionDataStore(db, workspaceId, redis)
    const globalsStore  = createGlobalsStore(db, workspaceId)

    /** The requested status flip, if any - drives the hooks' statusChange. */
    const bulkStatus = (fields as Record<string, unknown>).status

    // K4: bulk is a loop over the canonical operations. A flip to published is
    // the one publish (publishObject: validation, hooks, snapshot, revision,
    // event, attribution); a flip from published to draft is the one
    // unpublish. Other fields in the same request are applied first as one
    // update; the transition then runs on the saved row.
    const transition = bulkStatus === 'published' ? 'publish' : bulkStatus === 'draft' ? 'unpublish' : null
    const fieldsWithoutStatus = transition ? Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'status')) : fields
    const lifecycleDeps = { db, redis, schema, projects, eventBus, searchEngineRef: ctx.searchEngineRef }
    const execution = ctx.exec ?? createExecution({
      kind: 'request', source: memberId ? 'admin' : 'rest', workspaceId,
      actor: actorFromContext(ctx) ?? systemActor({ workspaceId, reason: 'bulk-update' }),
    })

    let updated = 0
    let failed  = 0
    const errors: Array<{ id: string; message: string }> = []

    for (const id of ids) {
      try {
        const prevData = prevMap.get(id) ?? null
        if (transition) {
          if (!prevData) throw new RequestError('NOT_FOUND', 'Object not found', 404)
          if (Object.keys(fieldsWithoutStatus).length > 0) {
            await contentUpdate(execution, { typeName, id, updates: fieldsWithoutStatus }, lifecycleDeps)
          }
          if (transition === 'publish') await lifecyclePublish(execution, { typeName, id }, lifecycleDeps)
          else if (String(prevData.status ?? 'draft') !== 'draft') await lifecycleUnpublish(execution, { typeName, id }, lifecycleDeps)
          updated++
          continue
        }

        const hookCtxBase = {
    actor: hookActor(memberId, apiKeyId, ctx.memberRole, ctx.exec),
          objectId:       id,
          typeName,
          workspaceId,
          operation:      'update' as const,
          trigger:        'manual' as const,
          prevData,
          // On a publish, nextData is the CONTENT BEING PUBLISHED (the whole
          // effective row) exactly as the publish route and local client send
          // it - a gate comparing a content hash cannot work off a partial.
          nextData:       { ...fields },
          // C1: a bulk status flip IS a publish/unpublish - without this the
          // gate hooks that key off statusChange (e.g. the review extension)
          // never fire and bulk-update becomes a mass-publish bypass.
          ...(typeof bulkStatus === 'string' && bulkStatus !== String(prevData?.status ?? 'draft')
            ? { statusChange: { from: String(prevData?.status ?? 'draft'), to: bulkStatus } }
            : {}),
          panelData:      {},
          extensionData:  extDataStore,
          enqueue: makeEnqueue(workspaceId, ctx),
          globals:        globalsStore,
        }

        const mutations = await runBeforeChange(db, projects, hookCtxBase)
        const effectiveFields = mutations ? { ...fields, ...mutations } : fields

        // K4: a hook that decides the transition to published does not get a
        // second publish implementation either - the flip leaves this write
        // and the one publish runs on the saved row below.
        const hookPublishes = effectiveFields.status === 'published'
        if (hookPublishes) delete (effectiveFields as Record<string, unknown>).status
        const publishClauses: ReturnType<typeof sql.raw>[] = []

        const effectiveClauses = mutations
          ? buildSetClauses(effectiveFields, msFields, jsonbFields)
          : setClauses

        const allClauses = sql.join(
          [...effectiveClauses, ...publishClauses, sql.raw('"updated_at" = NOW()')],
          sql.raw(', '),
        )

        const result = await db.execute(
          sql`UPDATE ${table} SET ${allClauses}
              WHERE ${table.id} = ${id}
                AND ${table.workspaceId} = ${workspaceId}
              RETURNING *`,
        )
        const rows = (Array.isArray(result) ? result : (result as any).rows ?? []) as Record<string, unknown>[]

        if (!rows.length) {
          failed++
          errors.push({ id, message: 'Object not found' })
          continue
        }

        await emitRecorded(eventBus, db, buildEvent({
          type: 'object.updated', workspaceId, resource: { kind: 'object', type: typeName, id },
          payload: {
            objectId:      id,
            typeId,
            typeSlug:      typeName,
            slug:          (rows[0] as Record<string, unknown>).slug ?? null,
            title:         String((rows[0] as Record<string, unknown>).title ?? ''),
            changedFields: Object.keys(effectiveFields),
            updatedBy:     resolveActorId(memberId, apiKeyId),
            updatedByKind: attributionOf({ exec: execution, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }).kind,
          },
        }, { exec: execution, memberId, apiKeyId, memberRole: ctx.memberRole, permissions, workspaceId }))

        runAfterChange(db, projects, { ...hookCtxBase, savedData: rows[0] }).catch(() => {})
        // C5: a bulk status flip IS a publish or an unpublish (the same reason
        // the gate hooks fire above), so the extension state moves with it.
        if (hookPublishes) {
          await lifecyclePublish(execution, { typeName, id }, lifecycleDeps)
        } else if (typeof effectiveFields.status === 'string' && effectiveFields.status !== String(prevData?.status ?? 'draft')) {
          await syncPublishedExtensionData(db, redis, workspaceId, id, effectiveFields.status as string)
        }

        updated++
      } catch (err) {
        failed++
        errors.push({ id, ...bulkItemError(err) })
      }
    }

    clearTypeQueryCache(redis, workspaceId, typeName).catch(() => {})
    return { updated, failed, errors }
  })
