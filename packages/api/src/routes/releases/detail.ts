/**
 * File Name: detail.ts
 * Purpose: Elysia route plugins for release detail, add-items, and remove-item endpoints.
 *          Also exports pure helpers used by both routes and tests:
 *            - buildReleaseDetailResponse — formats the GET /:id response
 *            - buildAddItemPayload — validates POST /:id/items body
 *            - isSchemaSynced — schema-version guard for apply
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: drizzle-orm, @tangen/db; member auth required on all routes.
 */
import { assertNotInOpenRelease } from '../../services/release-membership'
import { Elysia } from 'elysia'
import { eq, and } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { releases, releaseItems, objectTypes } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { snapshotObjectFields } from '../../services/release-snapshot'
import { lifecycleExecFromDb, readReleaseHistory, type ReleaseHistoryEntry } from '../../services/release-lifecycle'

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function buildReleaseDetailResponse(
  release: Record<string, unknown>,
  items: Record<string, unknown>[],
  history: ReleaseHistoryEntry[] = [],
) {
  // Items in apply order once approved (position), else by identity; the frozen payload rides on each item.
  const ordered = [...items].sort((a, b) => (Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER)) || String(a.typeName).localeCompare(String(b.typeName)) || String(a.objectId).localeCompare(String(b.objectId)))
  return {
    data: {
      release,
      items: ordered,
      itemCount: items.length,
      /** What was approved: present on every item once the release is approved (Phase 5B, Unit 3). */
      approval: release.approvedChecksum
        ? { approvedAt: release.approvedAt ?? null, approvedBy: release.approvedBy ?? null, checksum: release.approvedChecksum, frozen: ordered.every((i) => i.frozenPayload != null) }
        : null,
      history,
    },
  }
}

export interface AddItemPayload {
  objectId: string
  typeName: string
}

export function buildAddItemPayload(body: unknown): AddItemPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError('VALIDATION_ERROR', 'Request body must be an object', 422)
  }
  const b = body as Record<string, unknown>
  const objectId = (b.objectId as string | undefined)?.trim()
  const typeName = (b.typeName as string | undefined)?.trim()
  if (!objectId) throw new RequestError('VALIDATION_ERROR', 'objectId is required', 422)
  if (!typeName) throw new RequestError('VALIDATION_ERROR', 'typeName is required', 422)
  return { objectId, typeName }
}

/**
 * Returns true when the target environment is not missing any types from the source.
 * An additive target (more types) is safe; a target missing source types is not.
 *
 * @param sourceTypeNames - Type names present in the source environment
 * @param targetTypeNames - Type names present in the target environment
 */

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/v1/releases/:id — full release detail with items */
const releaseDetailGet = (app: Elysia) =>
  app.get('/api/v1/releases/:id', async (ctx: any) => {
    const { db, workspaceId, memberId, params } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)

    const [release] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.id, params.id), eq(releases.workspaceId, workspaceId)))
      .limit(1)

    if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)

    const items = await db
      .select()
      .from(releaseItems)
      .where(eq(releaseItems.releaseId, params.id))

    const exec = lifecycleExecFromDb(db)
    return buildReleaseDetailResponse(release, items, await readReleaseHistory(exec, params.id, workspaceId))
  })

/** POST /api/v1/releases/:id/items — add an object (with snapshot) to a draft release */
const releaseItemAdd = (app: Elysia) =>
  app.post('/api/v1/releases/:id/items', async (ctx: any) => {
    const { db, workspaceId, memberId, params, body, set } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)

    const [release] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.id, params.id), eq(releases.workspaceId, workspaceId)))
      .limit(1)

    if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)
    if (release.status !== 'draft') {
      throw new RequestError('CONFLICT', `Items can only be added while the release is a draft; it is ${release.status}`, 409)
    }

    const { objectId, typeName } = buildAddItemPayload(body)
    const table = (contentTables as Record<string, any>)[typeName]
    if (!table) throw new RequestError('VALIDATION_ERROR', `Unknown type: ${typeName}`, 422)

    // Real snapshot of the current draft - an empty snapshot made every
    // later diff/review/conflict check a lie (sync-overhaul defect 6).
    const fields = await snapshotObjectFields(db, workspaceId, table, objectId)
    if (!fields) {
      throw new RequestError('VALIDATION_ERROR', 'Object not found in this workspace', 422)
    }

    // Item identity is (release, type, object): one application per object (Phase 5B, Unit 4).
    if (await releaseHasItem(db, params.id, typeName, objectId)) {
      throw new RequestError('CONFLICT', `${typeName}/${objectId} is already in this release`, 409)
    }
    // And one object belongs to at most one OPEN release.
    await assertNotInOpenRelease(db, { workspaceId, typeName, objectId, excludeReleaseId: params.id })
    const itemId = `ritem_${randomBytes(6).toString('hex')}`
    await db.insert(releaseItems).values({
      id: itemId,
      releaseId: params.id,
      objectId,
      typeName,
      fieldSnapshot: fields,
    })

    set.status = 201
    return { id: itemId, releaseId: params.id, objectId, typeName }
  })

/** Whether the release already holds an item for this object (the unique index `release_items_identity_unique` is the last line). */
export async function releaseHasItem(db: any, releaseId: string, typeName: string, objectId: string): Promise<boolean> {
  const rows = await db.select({ id: releaseItems.id }).from(releaseItems)
    .where(and(eq(releaseItems.releaseId, releaseId), eq(releaseItems.typeName, typeName), eq(releaseItems.objectId, objectId)))
    .limit(1)
  return rows.length > 0
}

/** DELETE /api/v1/releases/:id/items/:itemId — remove an item from a draft release */
const releaseItemDelete = (app: Elysia) =>
  app.delete('/api/v1/releases/:id/items/:itemId', async (ctx: any) => {
    const { db, workspaceId, memberId, params } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)

    const [release] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.id, params.id), eq(releases.workspaceId, workspaceId)))
      .limit(1)

    if (!release) throw new RequestError('NOT_FOUND', 'Release not found', 404)
    if (release.status !== 'draft') {
      throw new RequestError('CONFLICT', `Items can only be removed while the release is a draft; it is ${release.status}`, 409)
    }

    await db
      .delete(releaseItems)
      .where(and(eq(releaseItems.id, params.itemId), eq(releaseItems.releaseId, params.id)))

    return { deleted: true }
  })

export const releaseDetailRoute = (app: Elysia) =>
  releaseDetailGet(releaseItemAdd(releaseItemDelete(app)))

// ── Schema sync helper (also used by apply.ts) ───────────────────────────────

export async function loadTypeNames(db: any): Promise<string[]> {
  const rows = await db
    .select({ name: objectTypes.name })
    .from(objectTypes)
  return rows.map((r: any) => r.name as string)
}
