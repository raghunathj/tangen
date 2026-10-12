/**
 * File Name: protocol.ts
 * Purpose: The realtime wire protocol as the client sees it - the same
 *          shapes as packages/api/src/realtime/protocol.ts, shared by value.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/plan-realtime.md sections 4.2 and 4.3. This
 *          package must not import the API package (the architecture's one-
 *          directional dependency rule, section 54), so the shapes are
 *          repeated here. A change on either side is a change on both; the
 *          server's protocol.ts says the same in its header.
 */

// ── Presence (R3) ─────────────────────────────────────────────────────────────

export type PresenceStateWord = 'viewing' | 'editing' | 'idle'
export type PresenceAction = 'join' | 'heartbeat' | 'leave' | 'update'

/** What a session says it is doing on a scope; at most 1 KB serialized, unknown keys dropped by the server. */
export interface PresenceState {
  state: PresenceStateWord
  field?: string
  block?: string
  /**
   * The content type of an `object:<id>` scope. The server cannot tell a
   * type from an id, so the client names it; the session is then mirrored
   * on the per-type aggregate `objects:<typeSlug>` that a list watches
   * (`presence.watch`). Gated by the type's read rule.
   */
  typeSlug?: string
  meta?: Record<string, string | number | boolean>
}

/** One joined session as the server describes it. */
export interface PresenceSession extends PresenceState {
  /**
   * The session id (the other side's connection id). On an aggregate scope
   * (`objects:<type>`) it is `<connection>@<objectId>`: one row per
   * connection per object.
   */
  id: string
  /** Aggregate scopes only: the object the session is on. */
  objectId?: string
  memberId: string | null
  apiKeyId: string | null
  name: string
  avatar: string | null
  /** Joined at (ms, server clock). */
  since: number
  updatedAt: number
  editingSince: number | null
  claimedAt: number | null
}

/** Who holds the advisory editing claim on a scope. */
export interface PresenceClaim {
  session: string
  memberId: string | null
  apiKeyId: string | null
  name: string
  since: number
}

/**
 * R4: the body of POST /api/v1/realtime/presence - one presence message
 * addressed by the connection id the server named in `ready`. It is the same
 * message a WebSocket sends, minus its `op`, because an EventSource has no
 * upstream of its own. The answer comes back down the stream, not in the
 * response.
 */
export interface PresenceRequest {
  connectionId: string
  scope: string
  action: PresenceAction
  state?: PresenceState
  takeover?: boolean
}

export type ClientMessage =
  | { op: 'subscribe'; topic: string; since?: string }
  | { op: 'unsubscribe'; topic: string }
  | { op: 'ping' }
  | { op: 'presence'; scope: string; action: PresenceAction; state?: PresenceState; takeover?: boolean }

export interface ReadyMessage {
  op: 'ready'
  connectionId: string
  workspaceId: string
  limits: { maxSubscriptions: number; maxMessageBytes: number }
  replay: { maxEvents: number; seconds: number }
  /** R3: the heartbeat to keep while joined; absent from servers older than R3. */
  presence?: { heartbeatSeconds: number; ttlSeconds: number }
}

/** The snapshot a join is answered with. */
export interface PresenceMessage {
  op: 'presence'
  scope: string
  self: string
  members: PresenceSession[]
  claim: PresenceClaim | null
}

/** One event as delivered to a handler: the 4.2 envelope plus the topic. */
export interface RealtimeEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  topic: string
  ch: string
  id: string
  t: number
  type: string
  data: T
}

export type RefusedReason =
  | 'forbidden' | 'members_only' | 'invalid_topic' | 'unknown_topic' | 'not_declared' | 'extension_inactive' | 'unsupported'
  | 'limit' | 'too_large' | 'malformed' | 'unknown_op' | 'not_joined'

export type ServerMessage =
  | ReadyMessage
  | PresenceMessage
  | ({ op: 'event' } & RealtimeEvent)
  | { op: 'subscribed'; topic: string }
  | { op: 'unsubscribed'; topic: string }
  | { op: 'refused'; topic: string | null; reason: RefusedReason }
  | { op: 'resync'; topic: string }
  | { op: 'pong'; t: number }
  | { op: 'close'; code: number; reason: string }

/** Parses a wire message; null for anything that is not a server message. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return null }
  }
  if (!value || typeof value !== 'object' || typeof (value as { op?: unknown }).op !== 'string') return null
  return value as ServerMessage
}

/** The SSE cursor map: `topic@id,topic@id`. Mirrors the server's encoding. */
export function encodeCursorMap(cursors: ReadonlyMap<string, string>): string {
  return [...cursors].map(([topic, id]) => `${topic}@${id}`).join(',')
}

/** Close codes the server uses that the client must understand. */
export const CLOSE_SLOW = 4008
export const CLOSE_CAPACITY = 4013
/** The Gateway's per-connection message budget was exceeded: reconnect, but not at once. */
export const CLOSE_RATE_LIMITED = 4029
export const CLOSE_REVOKED = 4403
