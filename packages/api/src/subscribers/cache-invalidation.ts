/**
 * File Name: cache-invalidation.ts
 * Purpose: Subscribes to object mutation events on the event bus and deletes the corresponding
 *          Redis cache entries to keep the object cache consistent with database state.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ioredis, EventBus; cache keys follow the tangen:object:<ws>:<env>:<type>:<id> convention
 */

import type { Redis } from 'ioredis'
import type { EventBus } from '../services/event-bus'

/**
 * Builds the Redis key used to cache a single content object.
 * @param workspaceId - The workspace identifier
 * @param typeSlug - The content type slug (e.g. "post")
 * @param objectId - The unique object ID
 * @returns Namespaced Redis key string
 */
export function objectCacheKey(
  workspaceId: string,
  typeSlug: string,
  objectId: string,
): string {
  return `tangen:object:${workspaceId}:${typeSlug}:${objectId}`
}

const OBJECT_MUTATION_EVENTS = [
  'object.updated',
  'object.published',
  'object.unpublished',
  'object.deleted',
  'object.scheduled',
] as const

/**
 * Registers event bus listeners for all object mutation event types that delete the affected object's Redis cache key.
 * @param bus - The application event bus to subscribe to
 * @param redis - The ioredis client used to delete stale cache entries
 */
export function registerCacheInvalidationSubscriber(bus: EventBus, redis: Redis): void {
  for (const eventType of OBJECT_MUTATION_EVENTS) {
    bus.on(eventType as any, async (event: any) => {
      const { objectId, typeSlug, slug } = event.payload ?? {}
      if (!objectId || !typeSlug) return
      const key = objectCacheKey(event.workspaceId, typeSlug, objectId)
      await redis.del(key).catch(() => {})
      // by-slug.ts caches the same row under a `slug:<slug>` id segment —
      // mutation events carry the row's slug so that entry dies too (C6;
      // it was previously never invalidated).
      if (slug) {
        const slugKey = objectCacheKey(event.workspaceId, typeSlug, `slug:${slug}`)
        await redis.del(slugKey).catch(() => {})
      }
    })
  }
}
