/**
 * File Name: create.ts
 * Purpose: POST /api/v1/releases - a named Release in this workspace with an
 *          initial set of objects (their current draft fields snapshotted for
 *          the detail view). A Release is an in-place change set: it names
 *          objects of this workspace and publishes them together.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { Elysia } from 'elysia'
import { releases, releaseItems } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import { RequestError } from '../../lib/errors'
import { findAndSnapshotObject } from '../../services/release-snapshot'
import { assertNotInOpenRelease } from '../../services/release-membership'

export interface CreateReleasePayload {
  name: string
  objectIds: string[]
}

export function buildCreateReleasePayload(body: unknown): CreateReleasePayload {
  const b = body as Record<string, unknown>
  const name = (b?.name as string | undefined)?.trim()
  const objectIds = b?.objectIds
  if (!name) throw new RequestError('VALIDATION_ERROR', 'name is required', 422)
  if (!Array.isArray(objectIds) || objectIds.length === 0) {
    throw new RequestError('VALIDATION_ERROR', 'objectIds must be a non-empty array', 422)
  }
  return { name, objectIds: objectIds as string[] }
}

export const releaseCreateRoute = (app: Elysia) =>
  app.post('/api/v1/releases', async (ctx: any) => {
    const { body, db, workspaceId, memberId, set } = ctx
    if (!memberId) throw new RequestError('FORBIDDEN', 'Member authentication required', 403)
    const payload = buildCreateReleasePayload(body)
    // Every object is looked up and checked BEFORE anything is written: a
    // refusal creates no half-filled release.
    const found: Array<{ objectId: string; typeName: string; fields: Record<string, unknown> }> = []
    for (const objectId of payload.objectIds) {
      const hit = await findAndSnapshotObject(db, workspaceId, objectId, contentTables as Record<string, any>)
      if (!hit) continue
      await assertNotInOpenRelease(db, { workspaceId, typeName: hit.typeName, objectId })
      found.push({ objectId, typeName: hit.typeName, fields: hit.fields as Record<string, unknown> })
    }
    const releaseId = `rel_${randomBytes(8).toString('hex')}`
    await db.insert(releases).values({ id: releaseId, name: payload.name, workspaceId, status: 'draft', createdBy: memberId })
    const snapshotted: string[] = []
    for (const item of found) {
      await db.insert(releaseItems).values({ id: `ritem_${randomBytes(6).toString('hex')}`, releaseId, objectId: item.objectId, typeName: item.typeName, fieldSnapshot: item.fields })
      snapshotted.push(item.objectId)
    }
    ctx.eventBus?.emit({
      id: randomUUID(), type: 'release.created', workspaceId, timestamp: new Date().toISOString(), actorId: memberId, actorType: 'member',
      payload: { releaseId, itemCount: snapshotted.length },
    })
    set.status = 201
    return { id: releaseId, name: payload.name, status: 'draft', itemCount: snapshotted.length, snapshotted }
  })
