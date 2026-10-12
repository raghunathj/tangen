/**
 * File Name: protocol.ts
 * Purpose: The one transport-independent realtime protocol - what a client
 *          may send, what the server answers, and the parser that admits
 *          nothing else.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md (sections 4.2 and 4.3)
 *          and the architecture's section 6: one protocol, a WebSocket
 *          adapter and an SSE adapter, the SDK hiding which. Every message
 *          carries `op`. Upstream there are three ops; anything else is
 *          answered with `refused` rather than ignored, because a client
 *          that sends the wrong shape deserves to find out. The cap is 4 KB
 *          measured on the serialized message - Elysia parses JSON before the
 *          handler sees it, so the byte count of the frame is reconstructed
 *          rather than read. Downstream, the `event` message is the 4.2
 *          envelope plus the TOPIC the client subscribed with, so the client
 *          never has to split a channel string to find its handler.
 *
 *          These shapes are shared by value with packages/realtime/src/
 *          protocol.ts, not by import: the client package must not depend on
 *          the API package. A change here is a change there.
 */

/** Serialized bytes a client message may occupy. */
export const MAX_MESSAGE_BYTES = 4096

// ── Upstream ──────────────────────────────────────────────────────────────────

export type PresenceAction = 'join' | 'heartbeat' | 'leave' | 'update'

/** The state a client is in on a scope: at most PRESENCE_STATE_MAX_BYTES serialized. */
export interface PresenceStateInput {
  state: 'viewing' | 'editing' | 'idle'
  field?: string
  block?: string
  /**
   * The content type of an `object:<id>` scope. The server cannot tell a
   * type from an id (content lives in per-type tables), so the client names
   * it; the session is then mirrored on `presence:objects:<typeSlug>`, the
   * per-type aggregate a list page watches. Gated by the type's read rule.
   */
  typeSlug?: string
  meta?: Record<string, string | number | boolean>
}

export type ClientMessage =
  | { op: 'subscribe'; topic: string; since?: string }
  | { op: 'unsubscribe'; topic: string }
  | { op: 'ping' }
  | { op: 'presence'; scope: string; action: PresenceAction; state?: PresenceStateInput; takeover?: boolean }

/** Serialized bytes a presence state object may occupy (R3: "a small state object, <= 1 KB"). */
export const PRESENCE_STATE_MAX_BYTES = 1024
const PRESENCE_STATES = new Set(['viewing', 'editing', 'idle'])
/** One topic segment (authorize.ts TOPIC_RE's `rest` shape): what a presence `typeSlug` must look like. */
const TYPE_SLUG_RE = /^[A-Za-z0-9_.-]+$/
const PRESENCE_ACTIONS = new Set<PresenceAction>(['join', 'heartbeat', 'leave', 'update'])
const PRESENCE_STRING_MAX = 200

// ── Downstream ────────────────────────────────────────────────────────────────

export interface ReadyMessage {
  op: 'ready'
  connectionId: string
  workspaceId: string
  limits: { maxSubscriptions: number; maxMessageBytes: number }
  replay: { maxEvents: number; seconds: number }
  /** R3: the heartbeat the client should keep while joined, and when a silent session is gone. */
  presence: { heartbeatSeconds: number; ttlSeconds: number }
}

/** R3: the snapshot answered to a join - everyone on the scope now, and who holds the advisory claim. */
export interface PresenceMessage {
  op: 'presence'
  scope: string
  /** The caller's own session id on the scope. */
  self: string
  members: Array<Record<string, unknown>>
  claim: Record<string, unknown> | null
}

export interface EventMessage {
  op: 'event'
  topic: string
  ch: string
  id: string
  t: number
  type: string
  data: Record<string, unknown>
}

export type RefusedReason =
  | 'forbidden' | 'members_only' | 'invalid_topic' | 'unknown_topic' | 'not_declared' | 'extension_inactive' | 'unsupported'
  | 'limit' | 'too_large' | 'malformed' | 'unknown_op' | 'not_joined'

export type ServerMessage =
  | ReadyMessage
  | EventMessage
  | PresenceMessage
  | { op: 'subscribed'; topic: string }
  | { op: 'unsubscribed'; topic: string }
  | { op: 'refused'; topic: string | null; reason: RefusedReason }
  | { op: 'resync'; topic: string }
  | { op: 'pong'; t: number }

// ── Parsing ───────────────────────────────────────────────────────────────────

export type ParsedClientMessage =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: 'too_large' | 'malformed' | 'unknown_op'; topic: string | null }

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * Admits exactly the three upstream ops. Accepts the raw string (SSE has
 * none; WebSocket frames arrive already parsed by Elysia) or the parsed
 * value.
 */
export function parseClientMessage(raw: unknown): ParsedClientMessage {
  let value: unknown = raw
  let bytes: number
  if (typeof raw === 'string') {
    bytes = Buffer.byteLength(raw)
    if (bytes > MAX_MESSAGE_BYTES) return { ok: false, reason: 'too_large', topic: null }
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'malformed', topic: null }
    }
  } else {
    try {
      bytes = Buffer.byteLength(JSON.stringify(raw) ?? '')
    } catch {
      return { ok: false, reason: 'malformed', topic: null }
    }
    if (bytes > MAX_MESSAGE_BYTES) return { ok: false, reason: 'too_large', topic: null }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'malformed', topic: null }
  const m = value as Record<string, unknown>
  const topic = isNonEmptyString(m.topic) ? m.topic : null
  switch (m.op) {
    case 'subscribe':
      if (!topic) return { ok: false, reason: 'malformed', topic: null }
      if (m.since !== undefined && !isNonEmptyString(m.since)) return { ok: false, reason: 'malformed', topic }
      return { ok: true, message: m.since === undefined ? { op: 'subscribe', topic } : { op: 'subscribe', topic, since: m.since as string } }
    case 'unsubscribe':
      if (!topic) return { ok: false, reason: 'malformed', topic: null }
      return { ok: true, message: { op: 'unsubscribe', topic } }
    case 'ping':
      return { ok: true, message: { op: 'ping' } }
    case 'presence': {
      // R3. The scope names a resource (`object:o1`); the topic of the refusal is the presence topic.
      const scope = isNonEmptyString(m.scope) ? m.scope : null
      const presenceTopic = scope ? `presence:${scope}` : null
      if (!scope) return { ok: false, reason: 'malformed', topic: null }
      if (!PRESENCE_ACTIONS.has(m.action as PresenceAction)) return { ok: false, reason: 'malformed', topic: presenceTopic }
      const action = m.action as PresenceAction
      if (m.takeover !== undefined && typeof m.takeover !== 'boolean') return { ok: false, reason: 'malformed', topic: presenceTopic }
      const out: Extract<ClientMessage, { op: 'presence' }> = { op: 'presence', scope, action }
      if (m.takeover === true) out.takeover = true
      if (action === 'join' || action === 'update') {
        const state = parsePresenceState(m.state)
        if (!state.ok) return { ok: false, reason: state.reason, topic: presenceTopic }
        out.state = state.state
      }
      return { ok: true, message: out }
    }
    default:
      return { ok: false, reason: 'unknown_op', topic }
  }
}

const isPrimitive = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' ? v.length <= PRESENCE_STRING_MAX : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean'

/**
 * Admits a presence state: `state` from the three words, optional `field`
 * and `block` strings, optional `meta` of primitives; other keys are
 * dropped, and the whole object serialized must fit PRESENCE_STATE_MAX_BYTES.
 */
export function parsePresenceState(raw: unknown): { ok: true; state: PresenceStateInput } | { ok: false; reason: 'malformed' | 'too_large' } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed' }
  const s = raw as Record<string, unknown>
  if (typeof s.state !== 'string' || !PRESENCE_STATES.has(s.state)) return { ok: false, reason: 'malformed' }
  const out: PresenceStateInput = { state: s.state as PresenceStateInput['state'] }
  for (const key of ['field', 'block'] as const) {
    if (s[key] === undefined || s[key] === null) continue
    if (typeof s[key] !== 'string' || (s[key] as string).length > PRESENCE_STRING_MAX) return { ok: false, reason: 'malformed' }
    if ((s[key] as string).length > 0) out[key] = s[key] as string
  }
  if (s.typeSlug !== undefined && s.typeSlug !== null) {
    // A type slug becomes a topic segment (`presence:objects:<typeSlug>`), so it must be shaped like one.
    if (typeof s.typeSlug !== 'string' || s.typeSlug.length > PRESENCE_STRING_MAX) return { ok: false, reason: 'malformed' }
    if (s.typeSlug.length > 0) {
      if (!TYPE_SLUG_RE.test(s.typeSlug)) return { ok: false, reason: 'malformed' }
      out.typeSlug = s.typeSlug
    }
  }
  if (s.meta !== undefined && s.meta !== null) {
    if (!s.meta || typeof s.meta !== 'object' || Array.isArray(s.meta)) return { ok: false, reason: 'malformed' }
    const meta: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(s.meta as Record<string, unknown>)) {
      if (!isPrimitive(v)) return { ok: false, reason: 'malformed' }
      meta[k] = v
    }
    out.meta = meta
  }
  if (Buffer.byteLength(JSON.stringify(out)) > PRESENCE_STATE_MAX_BYTES) return { ok: false, reason: 'too_large' }
  return { ok: true, state: out }
}

// ── SSE cursor encoding ───────────────────────────────────────────────────────

/**
 * An EventSource resumes with ONE Last-Event-ID, but a stream may carry
 * several topics with independent cursors. Every SSE `id:` therefore encodes
 * the whole map as `topic@id,topic@id` (topics hold `:`, ids hold `-`;
 * `@` and `,` are free), and the same encoding is accepted on `?since=`.
 */
export function encodeCursorMap(cursors: ReadonlyMap<string, string>): string {
  return [...cursors].map(([topic, id]) => `${topic}@${id}`).join(',')
}

export function decodeCursorMap(encoded: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!encoded) return out
  for (const part of encoded.split(',')) {
    const at = part.lastIndexOf('@')
    if (at <= 0) continue
    const topic = part.slice(0, at)
    const id = part.slice(at + 1)
    if (topic && id) out.set(topic, id)
  }
  return out
}
