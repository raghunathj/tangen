/**
 * File Name: webhook-dispatcher.ts
 * Purpose: Listens for object lifecycle events on the event bus and enqueues webhook delivery
 *          jobs for every active, matching webhook registered in the workspace.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/db (webhooks, contentTables), drizzle-orm, webhookQueue (BullMQ), EventBus
 */

import { randomBytes } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { webhooks } from '@tangen/db'
import { contentTables } from '@tangen/db/content-tables'
import type { DbClient } from '@tangen/db'
import type { EventBus } from '../services/event-bus'
import { getWebhookQueue } from '../services/webhook-queue'

const OBJECT_EVENTS = new Set([
  'object.created',
  'object.updated',
  'object.published',
  'object.unpublished',
  'object.deleted',
])

/**
 * Registers a wildcard event bus listener that queries enabled webhooks and enqueues a delivery job for each matching hook.
 * @param bus - The application event bus to subscribe to
 * @param db - The database client used to query webhooks and fetch object data
 * @param getThreshold - Callback returning the auto-pause failure threshold for a given workspace/environment
 * @param getCustomEvents - Callback returning the set of registered CUSTOM trigger
 *   event ids (`custom:*` / `ext:*`) a workspace/env may deliver. Only registered
 *   custom events pass the gate — an arbitrary `ctx.emit` that isn't a declared
 *   webhook trigger is ignored (same discoverability contract as the admin picker).
 */
export function registerWebhookDispatcherSubscriber(
  bus: EventBus,
  db: DbClient,
  getThreshold: (workspaceId: string) => number,
  getCustomEvents: (workspaceId: string) => Set<string> = () => new Set(),
): void {
  bus.on('*', async (event) => {
    const isObjectEvent = OBJECT_EVENTS.has(event.type)
    // Gate: built-in object events, or a custom event registered as a webhook
    // trigger for this workspace/env. Everything else (internal bus chatter,
    // unregistered emits) is dropped.
    if (!isObjectEvent && !getCustomEvents(event.workspaceId).has(event.type)) return

    const p = (event as any).payload as {
      objectId?: string
      typeSlug?: string
      [k: string]: unknown
    }

    const activeHooks = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.workspaceId, event.workspaceId),
          eq(webhooks.enabled, true),
        ),
      )

    const relevant = activeHooks.filter((h) => {
      if (!h.events.includes(event.type)) return false
      // typeNames scoping only applies to object events — custom events carry no
      // object type, so a type-scoped webhook simply never matches them.
      if (isObjectEvent && h.typeNames.length > 0 && !h.typeNames.includes(p.typeSlug ?? '')) return false
      return true
    })

    if (!relevant.length) return

    // Object events hydrate the current row; custom events deliver their raw
    // emit payload as `data` (no typeName/objectId).
    let objectData: Record<string, unknown> | null = null
    if (isObjectEvent) {
      if (event.type !== 'object.deleted' && p.typeSlug) {
        const table = (contentTables as Record<string, any>)[p.typeSlug]
        if (table) {
          const [row] = await db
            .select()
            .from(table)
            .where(
              and(
                eq(table.id, p.objectId ?? ''),
                eq(table.workspaceId, event.workspaceId),
                ),
            )
          objectData = row ?? null
        }
      }
    } else {
      objectData = ((event as any).payload as Record<string, unknown>) ?? {}
    }

    const threshold = getThreshold(event.workspaceId)

    await Promise.allSettled(
      relevant.map((hook) => {
        const deliveryId = `wd_${randomBytes(8).toString('hex')}`
        return getWebhookQueue().add(
          deliveryId,
          {
            deliveryId,
            webhookId: hook.id,
            workspaceId: hook.workspaceId,
            url: hook.url,
            secret: hook.secret ?? null,
            extraHeaders: typeof hook.headers === 'object' && hook.headers !== null
              ? (hook.headers as Record<string, string>)
              : {},
            threshold,
            event: event.type,
            typeName: isObjectEvent ? (p.typeSlug ?? '') : '',
            objectId: isObjectEvent ? (p.objectId ?? '') : '',
            objectData,
            timestamp: event.timestamp,
          },
          { jobId: deliveryId },
        )
      }),
    )
  })
}
