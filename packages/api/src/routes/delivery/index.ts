/**
 * File Name: index.ts
 * Purpose: Mounts the public delivery route.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This route is deliberately NOT part of the Studio
 *          extension. Disabling or uninstalling Studio must never make an
 *          already-published page unavailable, and extension routes come from
 *          the installed manifest - so a route living there would vanish with
 *          the extension whatever happened to its data.
 *
 *          The store it reads is resolved directly rather than through the
 *          extension runtime, for the same reason: `delivery_artifacts` is a
 *          platform table (and a bucket, when configured, is platform
 *          config), and reading either must not require the extension that
 *          wrote it to still be installed. Pages published before the move
 *          off `extension_data` still resolve - the resolver answers a miss
 *          from the old rows and copies the artifact across on first read.
 *
 *          The workspace and environment are explicit in the query because a
 *          browser fetching a stylesheet sends no key and no headers. Nothing
 *          here is a secret: these bytes are already on a published page.
 */
import { Elysia } from 'elysia'
import type { WorkspaceProject } from '@tangen/types'
import { resolveDeliveryProvider } from '../../services/delivery-store'
import { deliveryPath, deliveryResponse } from './serve'

/** The raw driver call the stores speak. */
type SqlUnsafe = (text: string, params?: unknown) => Promise<unknown>

export const deliveryRoute = (app: Elysia) =>
  app.get('/api/v1/delivery/*', async (ctx: any) => {
    const url = new URL(ctx.request.url)
    const path = deliveryPath(url.pathname)
    if (!path) return new Response('Not found', { status: 404 })

    const workspaceId = url.searchParams.get('workspace')
    if (!workspaceId) {
      return new Response('workspace is required', { status: 400 })
    }

    // Reading platform storage directly - the extension need not be
    // installed, which is the entire point of this route existing here. The
    // raw client is used rather than a Drizzle query because the stores
    // speak plain SQL, the same way the extension runtime builds them.
    const db = ctx.db as { $rawClient?: { unsafe: SqlUnsafe }; session?: { client: { unsafe: SqlUnsafe } } }
    const raw = db?.$rawClient ?? db?.session?.client
    if (!raw) return new Response('Delivery is unavailable', { status: 503 })
    const exec = (text: string, params?: unknown[]) =>
      raw.unsafe(text, (params ?? []) as never) as Promise<Array<Record<string, unknown>>>

    // The workspace's config decides the backend (table by default, a
    // bucket when `studio.delivery.storage` says so). A workspace this
    // process does not know still gets the table: the ids are public
    // routing identifiers, and an unknown one simply finds nothing.
    const projects = (ctx.workspaceProjects ?? []) as WorkspaceProject[]
    const project = projects.find((p) => p.workspaceId === workspaceId)
    const provider = resolveDeliveryProvider({ project, workspaceId, exec })
    return deliveryResponse(provider, path)
  })
