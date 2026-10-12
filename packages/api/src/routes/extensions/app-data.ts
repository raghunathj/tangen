/**
 * File Name: app-data.ts
 * Purpose: Routes for reading and writing per-extension, per-object draft and published data,
 *          used by extension sidebar panels to persist their state alongside content objects.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, Drizzle ORM, @tangen/db (extensionData), hooks/runner (createExtensionDataStore)
 */
import { eq, and } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { extensionData } from '@tangen/db'
import { createExtensionDataStore } from '../../hooks/runner'
import { isSuperAdmin } from '../../lib/workspace-boundary'
import { assertObjectPermission } from '../../lib/permissions'
import { RequestError } from '../../lib/errors'

/** A content object id, exactly: `randomUUID()` and nothing around it. */
const OBJECT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether `objectId` is a content object id.
 *
 * This route and an extension's own `ctx.store` are two views of ONE table:
 * createExtensionStore keys `extension_data` by
 * (extension_id, workspace_id, object_id) where object_id is the extension's
 * STORE KEY, and the unique index is (extension_id, object_id, workspace_id).
 * So a route write whose `objectId` happens to equal a store key overwrites
 * that key.
 *
 * Panel data is per-content-object by definition and a content object id is a
 * `randomUUID()`; every extension store key in the tree is prefixed instead
 * (`flow:`, `class:`, `__widget__`, `settings`, `workflows`). Confining the
 * route to the object-id shape separates the two keyspaces without changing
 * how anything is stored. Anchored, so a prefix cannot smuggle a uuid through.
 */
export function isPanelObjectId(objectId: string): boolean {
  return OBJECT_ID_RE.test(objectId)
}

/**
 * Refuses an objectId that is not a content object id. Before this it came off
 * the URL unchecked behind a bare `objects:read` / `objects:write` action, so
 * any member could name any extension and any key.
 *
 * Deliberately NOT also checking that `extensionId` is installed: that needs a
 * query on every panel read, and it would only stop a caller naming an
 * UNINSTALLED extension, whose rows an installed one could be named for
 * anyway. The keyspace confinement above is what closes the hole.
 */
export function assertPanelObjectId(objectId: string): void {
  if (!isPanelObjectId(objectId)) {
    throw new RequestError('FORBIDDEN', 'Panel data is addressed by content object id', 403)
  }
}

/**
 * The workspace and environment here come from the path and the query string,
 * not from the authenticated request, so they have to be checked against it
 * (closure plan Phase 9D, Part C). Without this, any authenticated caller -
 * an API key included, since the route is declared `access: 'authenticated'` -
 * could read and write any workspace's DRAFT extension data by naming it.
 *
 * Panel surface, so a member is required: an API key is a Delivery caller and
 * gets published extension data through GET /objects/:id, which asserts the
 * object is published before it looks. Crossing workspaces is a super-admin
 * role; crossing environments is not a role anyone has.
 */
export function assertPanelScope(ctx: any, workspaceId: string): void {
  if (!ctx.memberId) {
    throw new RequestError('FORBIDDEN', 'Extension panel data is admin-panel only', 403)
  }
  if (!isSuperAdmin(ctx.memberRole) && workspaceId !== ctx.workspaceId) {
    throw new RequestError('FORBIDDEN', 'Access denied', 403)
  }
}

/**
 * Elysia plugin that mounts GET and POST routes for extension data keyed by workspace, extension, and object ID.
 * @param app - The Elysia application instance
 * @returns The Elysia instance with the extension data routes registered
 */
export const extensionDataRoutes = (app: Elysia) =>
  app
    .get(
      '/api/v1/workspaces/:workspaceId/extensions/:extensionId/data/:objectId',
      async (ctx: any) => {
        const { params, db, redis } = ctx
        const { workspaceId, extensionId, objectId } = params
        assertPanelScope(ctx, workspaceId)
        assertObjectPermission(ctx.permissions, 'read')   // K0: draft panel data is content
        assertPanelObjectId(objectId)
        const store = createExtensionDataStore(db, workspaceId, redis)
        const draftData = await store.get(extensionId, objectId)
        const pubRows = await db
          .select({ publishedData: extensionData.publishedData })
          .from(extensionData)
          .where(
            and(
              eq(extensionData.extensionId, extensionId),
              eq(extensionData.objectId, objectId),
              eq(extensionData.workspaceId, workspaceId),
              ),
          )
          .limit(1)
        const publishedData = (pubRows[0]?.publishedData ?? null) as Record<string, unknown> | null
        return { data: draftData, publishedData }
      },
    )

    .post(
      '/api/v1/workspaces/:workspaceId/extensions/:extensionId/data/:objectId',
      async (ctx: any) => {
        const { params, body, db, redis } = ctx
        const { workspaceId, extensionId, objectId } = params
        assertPanelScope(ctx, workspaceId)
        // K0: writing an extension's panel data is a content write - before
        // this any member of any role could post any JSON for any object.
        assertObjectPermission(ctx.permissions, 'write')
        assertPanelObjectId(objectId)
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return new Response(
            JSON.stringify({ error: 'Request body must be an object' }),
            { status: 422, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const store = createExtensionDataStore(db, workspaceId, redis)
        await store.set(extensionId, objectId, body as Record<string, unknown>)
        return { ok: true }
      },
    )
