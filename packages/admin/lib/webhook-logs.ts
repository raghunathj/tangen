/**
 * File Name: webhook-logs.ts
 * Purpose: Display utilities for the webhook delivery log UI — event badge colours,
 *   relative timestamps, replay path construction, and replay eligibility checks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: None
 */

/**
 * Returns a Tailwind ring/bg/text class string for a webhook event badge based on event type.
 * @param event - Webhook event name string (e.g. "object.created", "object.deleted")
 * @returns Space-separated Tailwind class string for the badge colour
 */
export function eventBadgeClass(event: string): string {
  if (event.includes('created')) return 'bg-accent-muted text-accent-fg ring-indigo-200'
  if (event.includes('updated')) return 'bg-yellow-50 text-yellow-700 ring-yellow-200'
  if (event.includes('unpublished')) return 'bg-orange-50 text-orange-700 ring-orange-200'
  if (event.includes('published')) return 'bg-green-50 text-green-700 ring-green-200'
  if (event.includes('deleted')) return 'bg-red-50 text-red-700 ring-red-200'
  return 'bg-surface-sunken text-fg-muted ring-gray-200'
}

/**
 * Converts an ISO timestamp to a human-readable relative time string.
 * @param iso - ISO 8601 date string to format
 * @returns Relative label such as "42s ago", "5m ago", "3h ago", or a locale date string
 */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Constructs the API path for replaying a specific webhook delivery.
 * @param webhookId - The webhook definition ID
 * @param deliveryId - The delivery attempt ID to replay
 * @returns The replay endpoint path string
 */
export function buildReplayPath(webhookId: string, deliveryId: string): string {
  return `/webhooks/${webhookId}/deliveries/${deliveryId}/replay`
}

/**
 * Returns whether a delivery attempt is eligible to be replayed.
 * @param _delivery - The delivery object (currently all deliveries are replayable)
 * @returns Always true — all deliveries can be replayed regardless of success status
 */
// TODO: restrict replay to failed deliveries once retry logic is finalised
export function canReplay(_delivery: { success: boolean }): boolean {
  return true
}

// ── Delivery-list filters ─────────────────────────────────────────────────────

/** Filters for the delivery log — all optional, blank = no constraint. */
export interface DeliveryFilters {
  /** Exact event name (e.g. 'object.published'); '' = every event. */
  event?: string
  /** 'success' | 'failed'; '' = both. */
  status?: '' | 'success' | 'failed'
  /** Recency window relative to now; '' = any time. */
  since?: '' | 'hour' | 'day' | 'week'
}

const SINCE_MS: Record<string, number> = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 }

/**
 * Applies the delivery-log filters client-side (the page holds the last 50
 * deliveries already). All active filters must match (AND).
 * @param rows - Loaded deliveries
 * @param filters - Active filter values; blank strings are ignored
 * @returns The deliveries matching every active filter
 */
export function filterDeliveries<T extends { event: string; success: boolean; createdAt: string }>(
  rows: T[],
  filters: DeliveryFilters,
): T[] {
  const cutoff = filters.since && SINCE_MS[filters.since] ? Date.now() - SINCE_MS[filters.since] : null
  return rows.filter((d) => {
    if (filters.event && d.event !== filters.event) return false
    if (filters.status === 'success' && !d.success) return false
    if (filters.status === 'failed' && d.success) return false
    if (cutoff !== null && new Date(d.createdAt).getTime() < cutoff) return false
    return true
  })
}

/**
 * Unique event names present in the loaded deliveries, sorted — feeds the
 * event filter's options so it only offers values that exist.
 */
export function deliveryEventOptions(rows: Array<{ event: string }>): string[] {
  return [...new Set(rows.map((r) => r.event))].sort()
}
