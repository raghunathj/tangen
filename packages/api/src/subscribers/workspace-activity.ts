/**
 * File Name: workspace-activity.ts
 * Purpose: Records human-readable workspace activity entries for the dashboard feed and invalidates
 *          relevant Redis dashboard cache keys whenever a noteworthy event occurs.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/db (workspaceActivity, members, apiKeys), ioredis, @tangen/types, EventBus
 */

import { randomUUID } from 'node:crypto'
import { getExtensionManifest } from '../hooks/app-hooks-registry'
import { eq } from 'drizzle-orm'
import { workspaceActivity, members, apiKeys } from '@tangen/db'
import type { DbClient } from '@tangen/db'
import type { Redis } from 'ioredis'
import type { DashboardActivityConfig } from '@tangen/types'
import type { EventBus } from '../services/event-bus'

// ─── Cache key helpers ────────────────────────────────────────────────────────

/**
 * Builds a namespaced Redis key for a specific dashboard widget cache entry.
 * @param widget - The dashboard widget identifier (e.g. "recent-activity", "content-overview")
 * @param workspaceId - The workspace identifier
 * @returns Namespaced Redis key string
 */
export function dashboardCacheKey(widget: string, workspaceId: string): string {
  return `tangen:dashboard:${widget}:${workspaceId}`
}

// ─── Config alias ─────────────────────────────────────────────────────────────

type ActivityConfig = DashboardActivityConfig

// ─── Event → category + action mapping ───────────────────────────────────────

type Row = {
  category: string
  action: string
  typeName?: string | null
  targetLabel?: string | null
  objectId?: string | null
  objectTitle?: string | null
}

/**
 * Maps an event type and its payload to a human-readable activity category and action, returning null for unrecognised events.
 * @param type - The event type string (e.g. "object.created")
 * @param payload - The event payload containing context-specific fields
 * @returns Classified Row with category/action metadata, or null if the event should be ignored
 */
function classify(type: string, payload: Record<string, unknown>): Row | null {
  const title = (payload.title as string | null | undefined) || null
  switch (type) {
    case 'object.created':
      return { category: 'content', action: 'created', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    // K5: the feed shows edits, staging, cancelled schedules and refused publishes.
    case 'object.updated':
      // An autosave is not an edit anyone made on purpose; a manual save is.
      if (payload.trigger === 'autosave') return null
      return { category: 'content', action: payload.locale ? `edited (${String(payload.locale)})` : 'edited', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.staged':
      return { category: 'content', action: 'staged', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.unscheduled':
      return { category: 'content', action: 'unscheduled', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.publish_refused':
      return { category: 'content', action: `publish refused (${String(payload.reason ?? 'ERROR').toLowerCase().replace('_', ' ')})`, typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.published':
      return { category: 'content', action: 'published', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.unpublished':
      return { category: 'content', action: 'unpublished', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.deleted':
      return { category: 'content', action: 'deleted', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'object.scheduled':
      return { category: 'content', action: 'scheduled', typeName: payload.typeSlug as string, objectId: payload.objectId as string, objectTitle: title }
    case 'schema.pushed':
      return { category: 'schema', action: 'pushed' }
    case 'media.uploaded':
      return { category: 'media', action: 'uploaded', targetLabel: payload.filename as string }
    case 'media.deleted':
      return { category: 'media', action: 'deleted' }
    case 'member.invited':
      return { category: 'members', action: 'invited', targetLabel: payload.email as string }
    case 'apikey.created':
      return { category: 'api-keys', action: 'created', targetLabel: payload.label as string }
    case 'apikey.revoked':
      return { category: 'api-keys', action: 'revoked' }
    case 'webhook.created':
      return { category: 'webhooks', action: 'created', targetLabel: payload.label as string }
    case 'webhook.updated':
      return { category: 'webhooks', action: 'updated', targetLabel: payload.label as string }
    case 'webhook.deleted':
      return { category: 'webhooks', action: 'deleted' }
    case 'ext:flows:flow.created':
      return { category: 'flows', action: 'created', targetLabel: payload.name as string }
    case 'ext:flows:flow.updated':
      return { category: 'flows', action: 'updated', targetLabel: payload.name as string }
    case 'ext:flows:flow.enabled':
      return { category: 'flows', action: 'turned on', targetLabel: payload.name as string }
    case 'ext:flows:flow.disabled':
      return { category: 'flows', action: 'turned off', targetLabel: payload.name as string }
    case 'ext:flows:flow.deleted':
      return { category: 'flows', action: 'deleted', targetLabel: payload.name as string }
    default:
      return null
  }
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Returns the list of dashboard cache keys that must be invalidated for a given activity category.
 * @param category - The activity category (e.g. "content", "media", "webhooks")
 * @param workspaceId - The workspace identifier
 * @returns Array of Redis keys to delete
 */
function getCacheKeysToInvalidate(category: string, workspaceId: string): string[] {
  const keys = [dashboardCacheKey('recent-activity', workspaceId)]
  if (category === 'content')  keys.push(dashboardCacheKey('content-overview', workspaceId))
  if (category === 'webhooks') keys.push(dashboardCacheKey('webhook-health', workspaceId))
  if (category === 'media')    keys.push(dashboardCacheKey('media-snapshot', workspaceId))
  if (category === 'api-keys') keys.push(dashboardCacheKey('api-keys', workspaceId))
  if (category === 'members')  keys.push(dashboardCacheKey('members', workspaceId))
  return keys
}

// ─── Actor name resolution ────────────────────────────────────────────────────

/**
 * Resolves a display name for the actor who triggered an event, looking up members or API keys as appropriate.
 * @param db - The database client
 * @param actorId - The actor's ID (member or API key), or null/undefined if anonymous
 * @param actorType - Either "member" or "api_key", or null/undefined
 * @returns The resolved display name, or null if not found or on lookup failure
 */
async function resolveActorName(
  db: DbClient,
  actorId: string | null | undefined,
  actorType: string | null | undefined,
): Promise<string | null> {
  if (!actorId || !actorType) return null
  try {
    if (actorType === 'member') {
      const [row] = await db.select().from(members).where(eq(members.id, actorId)).limit(1)
      return row?.name ?? null
    }
    if (actorType === 'api_key') {
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, actorId)).limit(1)
      return row?.label ?? null
    }
    // K8.5: an extension is named by its manifest, the id when none is loaded; no lookup.
    if (actorType === 'extension') return getExtensionManifest(actorId)?.name ?? actorId
  } catch {
    // Never block a write on actor lookup failure
  }
  return null
}

// ─── Subscriber ───────────────────────────────────────────────────────────────

/**
 * Registers a wildcard event bus listener that writes workspace activity records and invalidates dashboard caches.
 * @param bus - The application event bus to subscribe to
 * @param db - The database client used to insert activity rows and look up actor names
 * @param redis - The Redis client used to delete stale dashboard cache keys
 * @param getConfig - Callback returning the activity config for a workspace, used to check exclusion rules
 */
export function registerWorkspaceActivitySubscriber(
  bus: EventBus,
  db: DbClient,
  redis: Redis,
  getConfig: (workspaceId: string) => ActivityConfig | undefined,
): void {
  bus.on('*', async (event) => {
    const classified = classify(event.type, (event as any).payload ?? {})
    if (!classified) return

    const { category, action, typeName, targetLabel, objectId, objectTitle } = classified

    // Exclusion checks from dashboard config
    const config = getConfig(event.workspaceId) ?? {}
    if (config.excludeCategories?.includes(category)) return
    if (category === 'content' && typeName && config.excludeTypes?.includes(typeName)) return

    const actorName = await resolveActorName(db, (event as any).actorId, (event as any).actorType)

    await db.insert(workspaceActivity).values({
      id: randomUUID(),
      workspaceId: event.workspaceId,
      category,
      action,
      actorId: (event as any).actorId ?? null,
      actorName,
      actorType: (event as any).actorType ?? null,
      source: (event as any).source ?? 'admin',
      typeName: typeName ?? null,
      objectId: objectId ?? null,
      objectTitle: objectTitle ?? null,
      targetLabel: targetLabel ?? null,
    })

    const keysToInvalidate = getCacheKeysToInvalidate(category, event.workspaceId)
    await Promise.all(keysToInvalidate.map(k => redis.del(k).catch(() => {}))).catch(() => {})
  })
}
