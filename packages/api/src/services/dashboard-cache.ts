/**
 * File Name: dashboard-cache.ts
 * Purpose: Provides Redis-backed caching helpers for dashboard widget data,
 *   including per-widget TTL configuration and a race-timeout-protected fetch wrapper.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ioredis — Redis client must be injected by the caller.
 */
import type { Redis } from 'ioredis'

/**
 * Builds the namespaced Redis key for a dashboard widget cache entry.
 * @param widgetId - Unique identifier of the widget type (e.g. 'content-overview').
 * @param workspaceId - Workspace the widget belongs to.
 * @returns A fully-qualified Redis key string.
 */
export const DASHBOARD_CACHE_KEY = (
  widgetId: string,
  workspaceId: string,
): string => `tangen:dashboard:${widgetId}:${workspaceId}`

/**
 * Per-widget cache TTL values in seconds.
 * Keys match the widget ID used in DASHBOARD_CACHE_KEY.
 */
export const DASHBOARD_CACHE_TTL: Record<string, number> = {
  'content-overview':  60,
  'recent-activity':   30,
  'webhook-health':   300,
  'media-snapshot':   300,
  'api-keys':         300,
  'members':          300,
}

const REDIS_TIMEOUT_MS = 500

/**
 * Fetches data from Redis if available, otherwise calls fetchFn and stores the result.
 * Redis lookups are race-limited to 500 ms so a slow/down Redis never blocks a request.
 * @param redis - ioredis client instance.
 * @param key - Fully-qualified Redis key (use DASHBOARD_CACHE_KEY to build it).
 * @param ttl - Cache TTL in seconds applied on cache miss.
 * @param fetchFn - Async factory that computes the fresh value on cache miss.
 * @returns The cached or freshly-computed value.
 */
export async function withDashboardCache<T>(
  redis: Redis,
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cached = await Promise.race([
    redis.get(key),
    new Promise<null>(resolve => setTimeout(() => resolve(null), REDIS_TIMEOUT_MS)),
  ]).catch(() => null)

  if (cached != null) {
    return JSON.parse(cached) as T
  }

  const data = await fetchFn()
  await redis.set(key, JSON.stringify(data), 'EX', ttl).catch(() => {})
  return data
}
