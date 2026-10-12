/**
 * File Name: bridge.ts
 * Purpose: The bus-to-envelope bridge - the one table through which a
 *          TangenEvent becomes something a connection can receive.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R2 of tasks/plan-realtime.md (section 4.4, "the bus
 *          bridge is one bus.on('*') that maps TangenEvents through the
 *          table in 4.2; nothing else on the bus reaches a client"). R1
 *          carried the five object events and the Porter run; this is the
 *          whole union, one declarative row per event type: which topics,
 *          which scope, and a shaper that picks the fields out of the
 *          payload by name. A type without a row is dropped with a debug
 *          line, never guessed - the table is the allow-list, and a new
 *          event type must be added here on purpose (the bridge test
 *          enumerates the union so forgetting fails loudly).
 *
 *          The rule for every row is the architecture's section 14:
 *          realtime signals, it does not replicate. An envelope carries ids,
 *          slugs, the names of changed fields and counters; never a title,
 *          never a document, never a submission's values, never an email,
 *          never an error text (a failure is `failed: true`; the admin
 *          refetches the run to read why), never a label. The client
 *          refetches canonical state through REST or GraphQL, where the
 *          permission checks live. Object rows name the actor
 *          (`actorId`: the event's own actorId, else the payload's
 *          updatedBy/publishedBy/createdBy) so an editor can tell "changed
 *          elsewhere" from "my own save coming back".
 *
 *          Scope: every topic is workspace-scoped, like the REST routes
 *          that list it; the channel is `<workspaceId>/<topic>`.
 *
 *          R5: the design rows (`studio.class.changed`, `studio.tag.changed`,
 *          `publish.*`) carry `actorName` beside `actorId`, resolved ONCE at
 *          the bridge from the members table - the display name only, never
 *          an email - and cached per member for a short TTL, so the Studio
 *          notice can say who changed `.card` for a member who has no
 *          presence session on the page (plan-parallel-tracks section 6).
 *          One in-flight lookup per member keeps the envelopes of one actor
 *          in order; a lookup that fails publishes without the name rather
 *          than late. Additive: every other row is exactly as before.
 */
import { eq, and } from 'drizzle-orm'
import type { TangenEvent } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { members } from '@tangen/db'
import type { EventBus } from '../services/event-bus'
import type { RealtimeHub } from './hub'

const logger = getLogger(['tangen', 'api', 'realtime', 'bridge'])

/** One publish the bridge derived from a bus event. */
export interface BridgedPublish {
  scope: { workspaceId: string}
  topic: string
  type: string
  data: Record<string, unknown>
}

type EventOf<K extends TangenEvent['type']> = Extract<TangenEvent, { type: K }>

/** A row: the topics an event fans to (workspace-scoped ones flagged) and the shaper. */
interface Row<K extends TangenEvent['type']> {
  topics: (e: EventOf<K>) => Array<string | { topic: string; workspace: true }>
  data: (e: EventOf<K>) => Record<string, unknown>
}

type Table = { [K in TangenEvent['type']]: Row<K> }

/** The actor for an object row: the event's, else the payload's by-field. */
function actorOf(e: TangenEvent, payloadActor?: string | null): Record<string, unknown> {
  const actorId = e.actorId ?? payloadActor ?? null
  return actorId ? { actorId } : {}
}

const objectTopics = (e: { payload: { objectId: string; typeSlug: string } }) =>
  [`objects:${e.payload.typeSlug}`, `object:${e.payload.objectId}`]

const ws = (topic: string) => ({ topic, workspace: true as const })

/**
 * The table. Every member of the TangenEvent union has a row; the test
 * enumerates the union to prove it. Keep the shapers to ids, slugs, names
 * and counters.
 */
const TABLE: Table = {
  // ── Content ────────────────────────────────────────────────────────────────
  'object.created': {
    topics: objectTopics,
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, ...actorOf(e, e.payload.createdBy) }),
  },
  'object.updated': {
    topics: objectTopics,
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, changedFields: e.payload.changedFields, ...actorOf(e, e.payload.updatedBy) }),
  },
  'object.published': {
    topics: objectTopics,
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, ...actorOf(e, e.payload.publishedBy) }),
  },
  'object.unpublished': {
    topics: objectTopics,
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, ...actorOf(e) }),
  },
  'object.deleted': {
    topics: objectTopics,
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, hard: e.payload.hard, ...actorOf(e) }),
  },
  'object.scheduled': {
    topics: objectTopics,
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, scheduledAt: e.payload.scheduledAt, ...actorOf(e) }),
  },
  // ── Schema ─────────────────────────────────────────────────────────────────
  'schema.pushed': {
    topics: () => ['system'],
    data: (e) => ({ changeCount: e.payload.changeCount, types: [...new Set(e.payload.changes.map((c) => c.typeName))] }),
  },
  // ── Media ──────────────────────────────────────────────────────────────────
  'media.uploaded': {
    topics: () => ['media'],
    data: (e) => ({ assetId: e.payload.assetId, folderId: e.payload.folderId, mimeType: e.payload.mimeType }),
  },
  'media.deleted': {
    topics: () => ['media'],
    data: (e) => ({ assetId: e.payload.assetId }),
  },
  // ── Members (workspace-scoped) ─────────────────────────────────────────────
  'member.invited': {
    topics: () => [ws('members')],
    data: (e) => ({ memberId: e.payload.memberId, role: e.payload.role }),
  },
  'member.created': {
    topics: () => [ws('members')],
    data: (e) => ({ memberId: e.payload.memberId, role: e.payload.role }),
  },
  'member.updated': {
    topics: () => [ws('members')],
    data: (e) => ({ memberId: e.payload.memberId, ...(e.payload.role ? { role: e.payload.role } : {}), changed: e.payload.changed }),
  },
  // ── Forms ──────────────────────────────────────────────────────────────────
  'form.submitted': {
    topics: (e) => [`forms:${e.payload.formId}`, 'forms'],
    data: (e) => ({ formId: e.payload.formId, ...(e.payload.formSlug ? { formSlug: e.payload.formSlug } : {}), submissionId: e.payload.submissionId }),
  },
  // ── API keys and webhooks ──────────────────────────────────────────────────
  'apikey.created': { topics: () => ['apikeys'], data: (e) => ({ keyId: e.payload.keyId }) },
  'apikey.revoked': { topics: () => ['apikeys'], data: (e) => ({ keyId: e.payload.keyId }) },
  'webhook.created': { topics: () => ['webhooks'], data: (e) => ({ webhookId: e.payload.webhookId }) },
  'webhook.updated': { topics: () => ['webhooks'], data: (e) => ({ webhookId: e.payload.webhookId }) },
  'webhook.deleted': { topics: () => ['webhooks'], data: (e) => ({ webhookId: e.payload.webhookId }) },
  // ── Porter (workspace-scoped) ──────────────────────────────────────────────
  'porter.run.changed': {
    topics: () => [ws('porter:runs')],
    data: (e) => ({ runId: e.payload.runId, kind: e.payload.kind, status: e.payload.status, totalItems: e.payload.totalItems, processedItems: e.payload.processedItems }),
  },
  'migration.progress': {
    topics: (e) => [ws(`migration:${e.payload.runId}`)],
    data: (e) => ({ runId: e.payload.runId, kind: e.payload.kind, status: e.payload.status, totalItems: e.payload.totalItems, processedItems: e.payload.processedItems }),
  },
  // ── Job runs ───────────────────────────────────────────────────────────────
  'job.run.started': {
    topics: () => ['jobs'],
    data: (e) => ({ kind: e.payload.kind, name: e.payload.name }),
  },
  'job.run.finished': {
    topics: () => ['jobs'],
    data: (e) => ({ kind: e.payload.kind, name: e.payload.name, durationMs: e.payload.durationMs }),
  },
  'job.run.failed': {
    topics: () => ['jobs'],
    data: (e) => ({ kind: e.payload.kind, name: e.payload.name, durationMs: e.payload.durationMs, failed: true }),
  },
  // ── Releases (workspace-scoped) ────────────────────────────────────────────
  'release.created': {
    topics: () => [ws('releases')],
    data: (e) => ({ releaseId: e.payload.releaseId, itemCount: e.payload.itemCount }),
  },
  'release.published': {
    topics: () => [ws('releases')],
    data: (e) => ({ releaseId: e.payload.releaseId, status: e.payload.status, published: e.payload.published, unchanged: e.payload.unchanged, failed: e.payload.failed }),
  },
  // ── Studio publish (emitted by the Studio extension; studio:<id> opened in R3) ─
  'publish.started': {
    topics: (e) => [`object:${e.payload.objectId}`, `studio:${e.payload.objectId}`],
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug }),
  },
  'publish.completed': {
    topics: (e) => [`object:${e.payload.objectId}`, `studio:${e.payload.objectId}`],
    // `route` rides along (Studio slice 3's request): the published pointer, so a consumer can fetch it without the authoring API.
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, ...(e.payload.version !== undefined ? { version: e.payload.version } : {}), ...(e.payload.route ? { route: e.payload.route } : {}) }),
  },
  'publish.failed': {
    topics: (e) => [`object:${e.payload.objectId}`, `studio:${e.payload.objectId}`],
    data: (e) => ({ objectId: e.payload.objectId, typeSlug: e.payload.typeSlug, failed: true }),
  },
  // ── Studio design changes (R3; emitted by the Studio extension) ─────────────
  // `studio:<objectId>` when the change belongs to one page; `studio:classes`
  // (workspace-scoped: the class library is shared by every environment) always.
  'studio.class.changed': {
    topics: (e) => [...(e.payload.objectId ? [`studio:${e.payload.objectId}`] : []), ws('studio:classes')],
    data: (e) => ({ ...(e.payload.objectId ? { objectId: e.payload.objectId } : {}), name: e.payload.name, rev: e.payload.rev, actorId: e.payload.actorId }),
  },
  'studio.tag.changed': {
    topics: (e) => [...(e.payload.objectId ? [`studio:${e.payload.objectId}`] : []), ws('studio:classes')],
    data: (e) => ({ ...(e.payload.objectId ? { objectId: e.payload.objectId } : {}), name: e.payload.name, rev: e.payload.rev, actorId: e.payload.actorId }),
  },
  // A theme write restyles every page and names no page, so it rides the
  // class library topic the Variables panel's page already holds.
  'studio.theme.changed': {
    topics: () => [ws('studio:classes')],
    data: (e) => ({ name: e.payload.name, rev: e.payload.rev, actorId: e.payload.actorId }),
  },
}

/** Every event type the table maps; anything else is dropped. */
export const BRIDGED_EVENT_TYPES: ReadonlySet<TangenEvent['type']> = new Set(Object.keys(TABLE) as TangenEvent['type'][])

/**
 * The table applied: which envelopes one bus event becomes. Pure, so the
 * mapping is testable without a hub and readable as the contract it is.
 * @returns Zero publishes for a type the table does not list.
 */
export function envelopesFor(event: TangenEvent): BridgedPublish[] {
  const row = TABLE[event.type] as Row<TangenEvent['type']> | undefined
  if (!row) {
    logger.debug(`realtime bridge: no row for event type "${String((event as { type?: unknown }).type)}" - dropped`)
    return []
  }
  // The write origin rides on EVERY envelope, stamped here rather than in
  // the per-type shapers: a new row cannot forget it, and the client's one
  // rule for "was this my own write?" (packages/realtime/src/own-write.ts)
  // works for every event type the day it is added.
  const origin = typeof event.origin === 'string' && event.origin ? event.origin : null
  const data = origin ? { ...row.data(event as never), origin } : row.data(event as never)
  return row.topics(event as never).map((t) => {
    const topic = typeof t === 'string' ? t : t.topic
    const workspaceScoped = typeof t !== 'string'
    return {
      scope: { workspaceId: event.workspaceId },
      topic,
      type: event.type,
      data,
    }
  })
}

/** The rows whose envelopes name the actor (R5): the design changes and the Studio publish. */
export const ACTOR_NAMED_TYPES: ReadonlySet<TangenEvent['type']> = new Set<TangenEvent['type']>([
  'studio.class.changed', 'studio.tag.changed', 'studio.theme.changed', 'publish.started', 'publish.completed', 'publish.failed',
])

/** Resolves a member's display name in a workspace; null when unknown or unnamed. Never an email. */
export type ActorNameResolver = (workspaceId: string, memberId: string) => Promise<string | null>

/** How long a resolved name is trusted before the members table is asked again. */
export const ACTOR_NAME_TTL_MS = 60_000
const ACTOR_NAME_CACHE_MAX = 2_000

/**
 * A resolver over the members table with a per-member cache (short TTL,
 * bounded) and one in-flight lookup per member, so a burst of changes by
 * one actor costs one query and keeps its order.
 * @param db - The drizzle db; null yields a resolver that names nobody.
 * @param opts.ttlMs - Cache lifetime (ACTOR_NAME_TTL_MS).
 * @param opts.lookup - Test seam: replaces the members query.
 */
export function memberNameResolver(db: any, opts: { ttlMs?: number; lookup?: ActorNameResolver; now?: () => number } = {}): ActorNameResolver {
  const ttl = opts.ttlMs ?? ACTOR_NAME_TTL_MS
  const now = opts.now ?? (() => Date.now())
  const cache = new Map<string, { name: string | null; exp: number }>()
  const inFlight = new Map<string, Promise<string | null>>()
  const lookup: ActorNameResolver = opts.lookup ?? (async (workspaceId, memberId) => {
    if (!db) return null
    const [row] = await db.select({ name: members.name }).from(members)
      .where(and(eq(members.id, memberId), eq(members.workspaceId, workspaceId))).limit(1)
    const name = row?.name ? String(row.name).trim() : ''
    return name ? name : null
  })
  return (workspaceId, memberId) => {
    const key = `${workspaceId}/${memberId}`
    const hit = cache.get(key)
    if (hit && hit.exp > now()) return Promise.resolve(hit.name)
    const pending = inFlight.get(key)
    if (pending) return pending
    const p = lookup(workspaceId, memberId)
      .catch(() => null)
      .then((name) => {
        if (cache.size >= ACTOR_NAME_CACHE_MAX) cache.clear()
        cache.set(key, { name, exp: now() + ttl })
        inFlight.delete(key)
        return name
      })
    inFlight.set(key, p)
    return p
  }
}

/** The member behind an actor-named event, or null (an API key actor is never named from the members table). */
function memberActorOf(event: TangenEvent): string | null {
  if (event.actorType === 'api_key') return null
  if (event.type === 'studio.class.changed' || event.type === 'studio.tag.changed' || event.type === 'studio.theme.changed') return event.payload.actorId || null
  return event.actorId ?? null
}

export interface BridgeOptions {
  /** R5: names the actor on the design rows; absent, the envelopes carry `actorId` only. */
  resolveActorName?: ActorNameResolver
}

/**
 * Subscribes the hub to the bus. Returns the detach.
 * @param hub - The process hub to publish through.
 * @param bus - The event bus to listen on (the process singleton in production).
 * @param opts - The actor-name resolver for the design rows (R5).
 */
export function attachRealtimeBridge(hub: RealtimeHub, bus: EventBus, opts: BridgeOptions = {}): () => void {
  const resolveName = opts.resolveActorName
  return bus.on('*', (event: TangenEvent) => {
    const publishes = envelopesFor(event)
    if (publishes.length === 0) return
    const actor = resolveName && ACTOR_NAMED_TYPES.has(event.type) ? memberActorOf(event) : null
    if (!actor) {
      for (const p of publishes) void hub.publish(p.scope, p.topic, p.type, p.data)
      return
    }
    void resolveName!(event.workspaceId, actor).then((name) => {
      for (const p of publishes) void hub.publish(p.scope, p.topic, p.type, name ? { ...p.data, actorName: name } : p.data)
    })
  })
}
