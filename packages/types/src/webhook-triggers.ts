/**
 * File Name: webhook-triggers.ts
 * Purpose: The custom webhook-trigger registry — lets site code (app/webhooks.ts →
 *          WorkspaceConfig.webhookTriggers) and extensions (server entry
 *          `webhookTriggers`) declare their own events so a webhook can fire on
 *          `ctx.emit('<name>')`, alongside the built-in object.* lifecycle events.
 *          Mirrors the Flows open trigger registry.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: pure — no I/O. The bus event id a webhook subscribes to is
 *          `custom:<name>` for site triggers and `ext:<extensionId>:<name>` for
 *          extension triggers (the same names ctx.emit produces).
 */

/** A documented field in the delivered payload — display/reference only. */
export interface WebhookTriggerPayloadField {
  /** Dot-path within the payload, e.g. 'order.id'. */
  path: string
  label: string
}

/**
 * A custom webhook trigger. `name` is the SHORT event name — the exact string
 * you pass to `ctx.emit(name, payload)`. The framework namespaces it to the bus
 * event id (`custom:<name>` for site, `ext:<id>:<name>` for extensions).
 */
export interface WebhookTriggerDefinition {
  name: string
  label: string
  description?: string
  /** Optional documentation of the payload shape (shown in the admin picker). */
  payloadFields?: WebhookTriggerPayloadField[]
}

/**
 * Identity builder for a custom webhook trigger. Register site triggers by
 * exporting them (app/webhooks.ts) and listing them on
 * `WorkspaceConfig.webhookTriggers`; extensions list them on their server
 * entry's `webhookTriggers`.
 *
 * @example
 * export const orderShipped = defineWebhookTrigger({
 *   name: 'order.shipped',
 *   label: 'Order shipped',
 *   description: 'Fires when an order is marked shipped',
 *   payloadFields: [{ path: 'orderId', label: 'Order ID' }],
 * })
 * // later, in a route/hook: await ctx.tangen.emit('order.shipped', { orderId })
 */
export function defineWebhookTrigger(def: WebhookTriggerDefinition): WebhookTriggerDefinition {
  return def
}

/** A resolved trigger, ready for the admin picker. */
export interface WebhookTriggerCatalogEntry {
  /** Full bus event id a webhook subscribes to: `object.*`, `custom:*`, `ext:*`. */
  event: string
  label: string
  description?: string
  payloadFields?: WebhookTriggerPayloadField[]
  /** 'platform' for built-ins, 'site' for app triggers, or the extension id. */
  contributor: string
  /** True for site/extension triggers (drives the "Custom" badge); false for built-ins. */
  custom: boolean
}

/**
 * The built-in object lifecycle events every workspace can subscribe to. Single
 * source of truth — the dispatcher gate and the admin picker both derive from it.
 */
export const BUILT_IN_WEBHOOK_EVENTS: readonly WebhookTriggerCatalogEntry[] = [
  { event: 'object.created',     label: 'Created',     description: 'A new object is saved for the first time', contributor: 'platform', custom: false },
  { event: 'object.updated',     label: 'Updated',     description: 'An existing object is edited and saved',    contributor: 'platform', custom: false },
  { event: 'object.published',   label: 'Published',   description: 'An object is moved to published status',    contributor: 'platform', custom: false },
  { event: 'object.unpublished', label: 'Unpublished', description: 'A published object is reverted to draft',   contributor: 'platform', custom: false },
  { event: 'object.deleted',     label: 'Deleted',     description: 'An object is archived / soft-deleted',      contributor: 'platform', custom: false },
  { event: 'object.scheduled',   label: 'Scheduled',   description: 'A publish is scheduled for later',          contributor: 'platform', custom: false },
  { event: 'object.staged',      label: 'Staged',      description: 'An object is staged for a release',         contributor: 'platform', custom: false },
  { event: 'object.unscheduled', label: 'Unscheduled', description: 'A scheduled publish is cancelled',          contributor: 'platform', custom: false },
  { event: 'object.publish_refused', label: 'Publish refused', description: 'The scheduler could not publish a due object (authority lost, validation, a hook)', contributor: 'platform', custom: false },
]

/** The bus event id for a site trigger name. */
export const siteTriggerEvent = (name: string): string => `custom:${name}`
/** The bus event id for an extension trigger name. */
export const extensionTriggerEvent = (extensionId: string, name: string): string => `ext:${extensionId}:${name}`

/**
 * Merge built-in object events with site + extension custom triggers into the
 * catalog served to the admin picker. Pure — the API layer supplies the raw
 * contributions. Later duplicates (same `event`) are ignored so a built-in can't
 * be shadowed.
 */
export function buildWebhookTriggerCatalog(input: {
  siteTriggers?: WebhookTriggerDefinition[]
  extensionTriggers?: { extensionId: string; triggers: WebhookTriggerDefinition[] }[]
}): WebhookTriggerCatalogEntry[] {
  const out: WebhookTriggerCatalogEntry[] = [...BUILT_IN_WEBHOOK_EVENTS]
  const seen = new Set(out.map((e) => e.event))
  const add = (event: string, contributor: string, t: WebhookTriggerDefinition) => {
    if (seen.has(event)) return
    seen.add(event)
    out.push({ event, label: t.label, description: t.description, payloadFields: t.payloadFields, contributor, custom: true })
  }
  for (const t of input.siteTriggers ?? []) add(siteTriggerEvent(t.name), 'site', t)
  for (const ex of input.extensionTriggers ?? [])
    for (const t of ex.triggers) add(extensionTriggerEvent(ex.extensionId, t.name), ex.extensionId, t)
  return out
}

/** The set of custom (non-built-in) event ids the dispatcher is allowed to deliver. */
export function customWebhookEventIds(catalog: WebhookTriggerCatalogEntry[]): Set<string> {
  return new Set(catalog.filter((e) => e.custom).map((e) => e.event))
}

/**
 * Subscribed event ids that are no longer in the catalog — the trigger's
 * extension was uninstalled/disabled, or a site trigger was removed. Surfaced in
 * the admin so the subscription is visible and can be cleaned up (it's preserved,
 * not auto-deleted, so re-registering the trigger restores delivery).
 */
export function unknownWebhookEvents(
  subscribed: string[],
  catalog: WebhookTriggerCatalogEntry[],
): string[] {
  const known = new Set(catalog.map((e) => e.event))
  return subscribed.filter((e) => !known.has(e))
}

/** Human label for a bare event id when it's no longer in the catalog. */
export function orphanEventLabel(event: string): string {
  if (event.startsWith('custom:')) return event.slice('custom:'.length)
  const m = event.match(/^ext:([^:]+):(.+)$/)
  if (m) return `${m[2]} (${m[1]})`
  return event
}
