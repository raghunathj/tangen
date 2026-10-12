/**
 * File Name: graphql-ws.ts
 * Purpose: The graphql-transport-ws adapter over the realtime hub - a
 *          session that is a HubSocket on one side (the hub speaks the
 *          native protocol to it) and a graphql-ws server on the other, so
 *          a GraphQL subscription is a native subscription wearing
 *          different framing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R5 of tasks/plan-realtime.md ("GraphQL
 *          subscription bridged over the same channels") and the
 *          architecture's "one protocol, adapters" rule (section 6): there
 *          is no second transport, no second authorization and no second
 *          router. The session attaches to the hub exactly as the native
 *          WebSocket adapter does (`hub.attach`, transport 'ws'), so the
 *          Gateway's admission gate, the connection ceilings, the message
 *          budget (every graphql-ws frame goes through `hub.noteMessage`),
 *          the connection log and the role-change re-check all apply
 *          unchanged. A topic is opened through `hub.subscribe`, which
 *          answers `subscribed` or `refused` synchronously on this socket;
 *          the envelopes the router delivers here are handed to the
 *          subscription iterators of that topic, one hub subscription per
 *          topic however many GraphQL subscriptions share it, and dropped
 *          from the hub when the last of them completes.
 *
 *          The protocol is graphql-ws (the `graphql-transport-ws`
 *          subprotocol, as the graphql-ws, Apollo and urql clients send
 *          it): connection_init within a timeout else 4408, connection_ack,
 *          subscribe / next / error / complete by id, ping / pong, 4401 for
 *          a subscribe before the ack, 4409 for a duplicate id, 4429 for a
 *          second init, 4400 for anything malformed. Only subscription
 *          operations run here; queries and mutations are answered with an
 *          `error` naming POST /api/v1/graphql, which keeps REST/GraphQL
 *          the canonical data API and the HTTP mount's depth ceiling and
 *          access log in force (architecture 56.9). Frames are capped at
 *          the native protocol's 4 KB. Each subscription holds a bounded
 *          queue (the router's bound) between the hub's delivery and the
 *          `next` frames; past it the connection is closed `slow` like a
 *          native one. The graphql-js primitives arrive with the schema
 *          through the optional @tangen/graphql package, so this file
 *          imports no GraphQL at module load.
 */
import type { RealtimeHub, HubConnection, HubSocket } from './hub'
import type { RealtimeIdentity } from './authorize'
import { CLOSE_SLOW } from './router'
import { internalErrorResponse, requestIdFor, type ErrorDetailMode } from '../lib/internal-error'
import { MAX_MESSAGE_BYTES, type ServerMessage, type EventMessage } from './protocol'

/** The subprotocol the graphql-ws clients request on the upgrade. */
export const GRAPHQL_WS_SUBPROTOCOL = 'graphql-transport-ws'

/** Default wait for `connection_init` after the socket opens (graphql-ws's own default). */
export const GRAPHQL_WS_INIT_TIMEOUT_MS = 3_000

/** Envelopes one subscription may hold between the hub and the wire before the connection is closed `slow`. */
export const GRAPHQL_WS_MAX_QUEUED = 256

type GraphqlModule = typeof import('@tangen/graphql')
type GraphqlSchema = Parameters<GraphqlModule['prepareSubscription']>[0]
type RealtimeSubscriber = import('@tangen/graphql').RealtimeSubscriber
type RealtimeEventLike = import('@tangen/graphql').RealtimeEventLike

/** What a graphql-ws connection needs once its identity is known, or null when GraphQL is off for that environment. */
export interface GraphqlWsTarget {
  gql: GraphqlModule
  schema: GraphqlSchema
  /** The per-connection GraphQL context, given the subscriber the adapter built. */
  context: (realtime: RealtimeSubscriber) => unknown
}

/** Resolves the target for an identity; the API mount's source reads the env's schema, tests hand one in. */
export type GraphqlWsSource = (identity: RealtimeIdentity) => Promise<GraphqlWsTarget | null>

/** Does the upgrade request ask for the graphql-ws subprotocol? The header is a comma-separated list. */
export function wantsGraphqlWs(header: string | null | undefined): boolean {
  if (!header) return false
  return header.split(',').some((p) => p.trim() === GRAPHQL_WS_SUBPROTOCOL)
}

/** The raw socket as the adapter needs it: Bun's ws (send returns a number) or anything send/close-shaped. */
export interface RawSocket {
  send(text: string): number | boolean | void
  close(code?: number, reason?: string): void
}

// ── A bounded push source ─────────────────────────────────────────────────────

interface PushSource<T> {
  iterable: AsyncIterable<T>
  /** False when the bound is exceeded; the caller decides what that means. */
  push(value: T): boolean
  fail(error: Error): void
  end(): void
}

function pushSource<T>(max: number, onReturn: () => void): PushSource<T> {
  const buffer: T[] = []
  let waiting: { resolve: (r: IteratorResult<T>) => void; reject: (e: Error) => void } | null = null
  let done = false
  let failure: Error | null = null
  const finish = () => { if (!done) { done = true; onReturn() } }
  return {
    push(value) {
      if (done) return true
      if (waiting) { const w = waiting; waiting = null; w.resolve({ value, done: false }); return true }
      if (buffer.length >= max) return false
      buffer.push(value)
      return true
    },
    fail(error) {
      if (done) return
      failure = error
      finish()
      if (waiting) { const w = waiting; waiting = null; w.reject(error) }
    },
    end() {
      if (done) return
      finish()
      if (waiting) { const w = waiting; waiting = null; w.resolve({ value: undefined as never, done: true }) }
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<T>> {
            if (buffer.length) return Promise.resolve({ value: buffer.shift()!, done: false })
            if (failure) { const e = failure; failure = null; return Promise.reject(e) }
            if (done) return Promise.resolve({ value: undefined as never, done: true })
            return new Promise((resolve, reject) => { waiting = { resolve, reject } })
          },
          return(): Promise<IteratorResult<T>> {
            finish()
            // A consumer waiting on next() is released too, or its loop would hang on a promise nobody settles.
            if (waiting) { const w = waiting; waiting = null; w.resolve({ value: undefined as never, done: true }) }
            return Promise.resolve({ value: undefined as never, done: true })
          },
        }
      },
    },
  }
}

// ── The session ───────────────────────────────────────────────────────────────

interface TopicEntry {
  state: 'pending' | 'open' | 'refused'
  reason: string | null
  sources: Set<PushSource<RealtimeEventLike>>
}

interface Subscription {
  id: string
  iterator: AsyncIterator<unknown> | null
  stopped: boolean
}

export interface GraphqlWsSessionOptions {
  hub: RealtimeHub
  identity: RealtimeIdentity
  raw: RawSocket
  target: GraphqlWsTarget
  initTimeoutMs?: number
}

/** A GraphQLError as graphql-ws puts it on the wire. */
type WireError = { message: string; extensions?: Record<string, unknown> }

/**
 * A parse, validation or refusal error is the client's to read and goes out
 * as graphql-js serialises it. A resolver that threw (a GraphQLError wrapping
 * an `originalError`) or a bare exception is an unmapped failure and follows
 * the INTERNAL contract: redacted on a production-like deployment, logged
 * under the request id, the id in `extensions` so it can be reported.
 */
export function wireError(e: unknown, mode?: ErrorDetailMode): WireError {
  const wrapped = e && typeof e === 'object' ? (e as { originalError?: unknown }).originalError : undefined
  // A refusal or a mapped request error inside the GraphQLError is deliberate
  // and carries its own extensions; only a genuine exception is unmapped.
  const deliberate = !(wrapped instanceof Error)
    || wrapped instanceof RefusedError
    || wrapped.name === 'RequestError' || wrapped.name === 'AuthError'
    || 'extensions' in wrapped
  if (e && typeof e === 'object' && typeof (e as { toJSON?: unknown }).toJSON === 'function' && deliberate) {
    return (e as { toJSON(): WireError }).toJSON()
  }
  const id = requestIdFor(undefined)
  const internal = internalErrorResponse(wrapped instanceof Error ? wrapped : e, { id, route: 'realtime.graphql-ws', mode })
  return { message: internal.error.message, extensions: { code: 'INTERNAL', id } }
}

/** The error a refused topic becomes on a subscription. */
class RefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'RealtimeRefused'
  }
  toJSON(): WireError {
    return { message: `realtime refused the topic: ${this.reason}`, extensions: { code: 'REALTIME_REFUSED', reason: this.reason } }
  }
}

/**
 * One graphql-ws connection over one hub connection. Build it in the
 * transport's open(), call `open()`, hand every frame to `handleFrame()`,
 * and `closed()` when the socket is gone.
 */
export class GraphqlWsSession {
  conn: HubConnection | null = null
  private acked = false
  private ended = false
  private initTimer: ReturnType<typeof setTimeout> | undefined
  private readonly subscriptions = new Map<string, Subscription>()
  private readonly topics = new Map<string, TopicEntry>()
  private readonly opts: GraphqlWsSessionOptions

  /** What the hub writes to: the native protocol, translated here. */
  readonly hubSocket: HubSocket

  constructor(opts: GraphqlWsSessionOptions) {
    this.opts = opts
    this.hubSocket = {
      send: (text) => this.fromHub(text),
      close: (code, reason) => this.closeRaw(code, reason),
    }
  }

  /** Attaches to the hub; false when the hub refused (it closed the socket itself). */
  open(): boolean {
    this.conn = this.opts.hub.attach(this.opts.identity, this.hubSocket, 'ws')
    if (!this.conn) return false
    this.initTimer = setTimeout(() => this.closeRaw(4408, 'Connection initialisation timeout'), this.opts.initTimeoutMs ?? GRAPHQL_WS_INIT_TIMEOUT_MS)
    return true
  }

  /** The transport saw the socket close: end every subscription and forget the hub connection. */
  closed(code?: number, reason?: string): void {
    this.teardown()
    if (this.conn) this.opts.hub.disconnect(this.conn, code, reason)
  }

  // ── From the hub (native protocol) ──────────────────────────────────────────

  private fromHub(text: string): boolean {
    let m: ServerMessage
    try { m = JSON.parse(text) as ServerMessage } catch { return true }
    switch (m.op) {
      case 'event':
        this.deliver(m)
        return true
      case 'subscribed': {
        const entry = this.topics.get(m.topic)
        if (entry) entry.state = 'open'
        return true
      }
      case 'refused': {
        if (!m.topic) return true
        const entry = this.topics.get(m.topic)
        if (!entry) return true
        entry.state = 'refused'
        entry.reason = m.reason
        // A re-check dropped it, or the subscribe itself was refused: every subscription on it ends with the reason.
        for (const source of [...entry.sources]) source.fail(new RefusedError(m.reason))
        this.topics.delete(m.topic)
        return true
      }
      default:
        // ready, unsubscribed, resync, pong, presence: nothing a GraphQL subscription can carry.
        return true
    }
  }

  private deliver(m: EventMessage): void {
    const entry = this.topics.get(m.topic)
    if (!entry) return
    const { op: _op, ...event } = m
    for (const source of entry.sources) {
      if (!source.push(event) && this.conn) {
        this.conn.close(CLOSE_SLOW, 'slow')
        return
      }
    }
  }

  // ── From the client (graphql-ws) ────────────────────────────────────────────

  /** One graphql-ws frame, raw text or already parsed. */
  handleFrame(raw: unknown): void {
    const conn = this.conn
    if (!conn || conn.closed || this.ended) return
    if (!this.opts.hub.noteMessage(conn)) return
    let value: unknown = raw
    let bytes: number
    if (typeof raw === 'string') {
      bytes = Buffer.byteLength(raw)
      if (bytes <= MAX_MESSAGE_BYTES) {
        try { value = JSON.parse(raw) } catch { this.closeRaw(4400, 'Malformed message'); return }
      }
    } else {
      try { bytes = Buffer.byteLength(JSON.stringify(raw) ?? '') } catch { this.closeRaw(4400, 'Malformed message'); return }
    }
    if (bytes > MAX_MESSAGE_BYTES) { this.closeRaw(4400, 'Message too large'); return }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { this.closeRaw(4400, 'Malformed message'); return }
    const m = value as { type?: unknown; id?: unknown; payload?: unknown }
    switch (m.type) {
      case 'connection_init':
        if (this.acked) { this.closeRaw(4429, 'Too many initialisation requests'); return }
        this.acked = true
        clearTimeout(this.initTimer)
        this.send({ type: 'connection_ack', payload: { connectionId: conn.id, workspaceId: conn.identity.workspaceId } })
        return
      case 'ping':
        this.send({ type: 'pong' })
        return
      case 'pong':
        return
      case 'subscribe': {
        if (!this.acked) { this.closeRaw(4401, 'Unauthorized'); return }
        if (typeof m.id !== 'string' || !m.id) { this.closeRaw(4400, 'A subscribe needs an id'); return }
        if (this.subscriptions.has(m.id)) { this.closeRaw(4409, `Subscriber for ${m.id} already exists`); return }
        const payload = m.payload as { query?: unknown; variables?: unknown; operationName?: unknown } | undefined
        if (!payload || typeof payload.query !== 'string') { this.closeRaw(4400, 'A subscribe needs a payload with a query'); return }
        const sub: Subscription = { id: m.id, iterator: null, stopped: false }
        this.subscriptions.set(m.id, sub)
        void this.run(sub, payload.query, payload.variables, payload.operationName)
        return
      }
      case 'complete':
        if (!this.acked) { this.closeRaw(4401, 'Unauthorized'); return }
        if (typeof m.id === 'string') this.stop(m.id)
        return
      default:
        this.closeRaw(4400, `Unknown message type: ${String(m.type)}`)
    }
  }

  private async run(sub: Subscription, query: string, variables: unknown, operationName: unknown): Promise<void> {
    const { gql, schema } = this.opts.target
    const prepared = gql.prepareSubscription(schema, query, typeof operationName === 'string' ? operationName : null)
    if (!prepared.ok) { this.finishWithError(sub, prepared.errors); return }
    const subscriber: RealtimeSubscriber = { subscribe: (topic) => this.topicSource(topic).iterable }
    let result: Awaited<ReturnType<GraphqlModule['subscribeGraphql']>>
    try {
      result = await gql.subscribeGraphql({
        schema, document: prepared.document, contextValue: this.opts.target.context(subscriber),
        variableValues: variables && typeof variables === 'object' ? variables as Record<string, unknown> : undefined,
        operationName: typeof operationName === 'string' ? operationName : undefined,
      })
    } catch (e) {
      this.finishWithError(sub, [e])
      return
    }
    if (sub.stopped) return
    if (!(Symbol.asyncIterator in result)) {
      this.finishWithError(sub, (result as { errors?: unknown[] }).errors ?? [])
      return
    }
    const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    sub.iterator = iterator
    try {
      for (;;) {
        const { value, done } = await iterator.next()
        if (done || sub.stopped) break
        this.send({ type: 'next', id: sub.id, payload: value })
      }
      if (!sub.stopped && this.subscriptions.get(sub.id) === sub) {
        this.subscriptions.delete(sub.id)
        this.send({ type: 'complete', id: sub.id })
      }
    } catch (e) {
      if (!sub.stopped) this.finishWithError(sub, [e])
    }
  }

  private finishWithError(sub: Subscription, errors: unknown[]): void {
    if (this.subscriptions.get(sub.id) !== sub) return
    this.subscriptions.delete(sub.id)
    sub.stopped = true
    this.send({ type: 'error', id: sub.id, payload: errors.map((e) => wireError(e)) })
  }

  /** The client completed, or the socket is going: end the iterator; the source's return releases the topic. */
  private stop(id: string): void {
    const sub = this.subscriptions.get(id)
    if (!sub) return
    sub.stopped = true
    this.subscriptions.delete(id)
    void sub.iterator?.return?.()
  }

  // ── Topics: one hub subscription per topic, shared by every subscription on it ──

  private topicSource(topic: string): PushSource<RealtimeEventLike> {
    const conn = this.conn
    if (!conn || conn.closed) throw new Error('connection closed')
    let entry = this.topics.get(topic)
    if (!entry) {
      entry = { state: 'pending', reason: null, sources: new Set() }
      this.topics.set(topic, entry)
      // Answers synchronously on hubSocket: `subscribed` opens the entry, `refused` removes it.
      this.opts.hub.subscribe(conn, topic)
      if (entry.state !== 'open') {
        this.topics.delete(topic)
        throw new RefusedError(entry.reason ?? 'forbidden')
      }
    }
    const held = entry
    const source: PushSource<RealtimeEventLike> = pushSource<RealtimeEventLike>(GRAPHQL_WS_MAX_QUEUED, () => {
      held.sources.delete(source)
      if (held.sources.size === 0 && this.topics.get(topic) === held) {
        this.topics.delete(topic)
        if (this.conn && !this.conn.closed && !this.ended) this.opts.hub.unsubscribe(this.conn, topic)
      }
    })
    held.sources.add(source)
    return source
  }

  // ── Wire ────────────────────────────────────────────────────────────────────

  private send(frame: Record<string, unknown>): void {
    if (this.ended) return
    try {
      const result = this.opts.raw.send(JSON.stringify(frame))
      if (this.conn && result !== false && result !== 0 && result !== undefined) this.conn.messagesOut++
    } catch { /* gone; the close event follows */ }
  }

  private closeRaw(code: number, reason: string): void {
    if (this.ended) return
    this.teardown()
    if (this.conn && !this.conn.closed) {
      // Our own decision (a protocol violation): leave the hub before the socket.
      this.opts.hub.disconnect(this.conn, code, reason)
    }
    try { this.opts.raw.close(code, reason) } catch { /* already gone */ }
  }

  private teardown(): void {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.initTimer)
    for (const sub of [...this.subscriptions.values()]) {
      sub.stopped = true
      void sub.iterator?.return?.()
    }
    this.subscriptions.clear()
    for (const entry of this.topics.values()) for (const source of [...entry.sources]) source.end()
    this.topics.clear()
  }
}
