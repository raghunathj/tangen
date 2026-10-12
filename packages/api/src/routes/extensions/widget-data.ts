/**
 * File Name: widget-data.ts
 * Purpose: GET /api/v1/extensions/:extensionId/widget-data — serves whatever
 *          an extension stored in extension_data under the well-known
 *          '__widget__' key, so manifest dashboardWidgets have a data source
 *          without extensions needing their own server routes. Content hooks
 *          keep the value fresh (see extensions/kitchen-sink/src/hooks.ts).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Elysia, hooks/runner (createExtensionDataStore).
 *          workspaceId derives from the admin auth middleware. Shape is the
 *          widget contract: { value } for 'stat', { stats } for 'stat-group',
 *          { rows, columns } for 'table'; defaults to { value: 0 }.
 */
import { Elysia } from 'elysia'
import { createExtensionDataStore } from '../../hooks/runner'

/** The extension_data objectId dashboard widgets read from. */
export const WIDGET_DATA_KEY = '__widget__'

export const extensionWidgetDataRoute = (app: Elysia) =>
  app.get('/api/v1/extensions/:extensionId/widget-data', async (ctx: any) => {
    const { db, redis, workspaceId, params } = ctx
    const store = createExtensionDataStore(db, workspaceId, redis)
    const data = await store.get(params.extensionId as string, WIDGET_DATA_KEY)
    return { value: 0, ...((data as Record<string, unknown>) ?? {}) }
  })
