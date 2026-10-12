/**
 * File Name: hub.ts
 * Purpose: The realtime hub - one per process - where a redeemed ticket
 *          becomes a connection, protocol messages become subscriptions, and
 *          a published event becomes envelopes on the sockets that asked.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md. The hub is the seam
 *          between the pure layers (router, retention, authorize, protocol)
 *          and the two transports (transport.ts). A transport hands it a
 *          socket that can send() and close(); the hub does everything else
 *          and never learns whether the socket is a WebSocket or an SSE
 *          stream. The bridge (bridge.ts) calls publish(); the
 *          infrastructure bus (fanout.ts) calls dispatch() with envelopes
 *          heard from other processes and is told of local ones through
 *          the forward hook, so the hub never knows which transport is
 *          underneath, only that "retain, dispatch here, forward" is the
 *          order - a process never hears its own envelope twice.
 *
 *          R2 made retention asynchronous-capable: the Redis and Postgres
 *          stores answer with promises, memory still answers in place, and
 *          publish() returns whichever it got so the single-process path
 *          stays one tick long. A replay that has to wait for a store
 *          holds live envelopes for that channel on the connection until
 *          the replay is sent, then releases the ones the replay did not
 *          already cover, so order and at-most-once both survive the wait.
 *
 *          Admission loads permissions from the rows, not from the ticket:
 *          the ticket proves who asked, the rows say what they may do now.
 *          The role-change seam (onEnvRoleCacheInvalidated) reaches
 *          reauthorizeMember(), which reloads the same way and drops what is
 *          no longer allowed. A connection that replays on subscribe gets
 *          its missed envelopes through its own queue, so the replay keeps
 *          order behind anything already waiting.
 */
import { randomBytes } from 'node:crypto'
import { SubscriptionRouter, type RealtimeEnvelope, type RouterConnection } from './router'
import { MemoryRetention, compareIds, type RetentionStore, type MaybePromise } from './retention'
import {
  authorizeTopic, channelFor, topicOf, mayReceive, reauthorize, CLOSE_REVOKED,
  type RealtimeIdentity, type EffectivePermissions, type RefusalReason, type ReauthorizableConnection,
} from './authorize'
import { redeemTicket, type TicketStore, type RealtimeTicketClaims } from './ticket'
import { parseClientMessage, MAX_MESSAGE_BYTES, type ServerMessage, type EventMessage, type ClientMessage } from './protocol'
import { REALTIME_PRESENCE_DEFAULTS } from '@tangen/types'
import { PRESENCE_TOPIC_PREFIX, isAggregateScope, type PresenceService } from './presence'

/** Which adapter a connection came through; the Gateway's connection log names it. */
export type HubTransport = 'ws' | 'sse'

/** What a transport gives the hub for one connection. */
export interface HubSocket {
  /** False when the socket is applying backpressure; the hub queues and retries on drain(). */
  send(text: string): boolean
  close(code: number, reason: string): void
}

export interface HubOptions {
  ticketStore: TicketStore
  /** Loads current permissions for an identity; null means the identity is gone. */
  permissionLoader: (identity: RealtimeIdentity) => Promise<EffectivePermissions | null>
  retention?: RetentionStore
  /** Tells the infrastructure bus about an envelope retained here (fanout.ts). */
  forward?: (envelope: RealtimeEnvelope) => void
  maxSubscriptionsPerConnection?: number
  maxQueuedPerConnection?: number
  /**
   * The process's hard safety cap on open connections (default
   * PROCESS_CONNECTION_HARD_CAP). NOT the ceiling: the governed number is the
   * Gateway's resolved `gateway.realtime.maxConnections`, applied through the
   * HubGate with its observe-first semantics. This one only keeps a process
   * from being talked out of memory when no policy enforces.
   */
  hardConnectionCap?: number
  /** R3: the presence service; without one the presence op is refused `unsupported`. */
  presence?: PresenceService
  /** Test hook. */
  idFactory?: () => string
}

/** Close code when the process is at its hard connection cap. */
export const CLOSE_CAPACITY = 4013

/**
 * R5: the hub's own ceiling is gone; ONE number governs, the Gateway's
 * resolved `gateway.realtime.maxConnections` (500 by default, per workspace
 * and environment across the deployment), asked through the HubGate at
 * admission and enforced only under `gateway.rateLimit.enabled` - observed
 * as a would-deny otherwise (D-6). What stays here is a hard process safety
 * cap, ten times that default: a memory valve for a process nobody has put a
 * policy on, refusing 503 at upgrade and 4013 `capacity` on a race, never a
 * policy of its own. Raise it through `hardConnectionCap` on a box that has
 * been load-tested for more (bench/realtime).
 */
export const PROCESS_CONNECTION_HARD_CAP = 5_000

/** What a close listener is told. The Gateway's connection log reads this (R5 prep). */
export interface ConnectionClosedInfo {
  connection: HubConnection
  /** The WebSocket close code, or null when the transport had none (SSE cancel). */
  code: number | null
  reason: string | null
  /** Subscriptions held at the moment of closing. */
  subscriptions: number
}

const closedListeners = new Set<(info: ConnectionClosedInfo) => void>()

/**
 * The Gateway's seam on admission and traffic (R5, the Gateway half in
 * tasks/plan-realtime.md 4.6): ceilings and budgets live in the Gateway's
 * resolver and the M5 store, and the hub only asks. One installer, three
 * call sites, no realtime knowledge of any policy.
 */
export interface HubGate {
  /** A redeemed ticket is about to become a connection. Throw to refuse; the transport answers the error. */
  admit?(identity: RealtimeIdentity): Promise<void>
  /** A connection was registered under the identity. Pairs with onConnectionClosed. */
  opened?(conn: HubConnection): void
  /** One inbound message arrived. A gate that wants the connection gone closes it. */
  message?(conn: HubConnection): void
}

let hubGate: HubGate | null = null

/** Installs (or clears) the process-wide gate; the Gateway does this at boot. */
export function setHubGate(gate: HubGate | null): void {
  hubGate = gate
}

/**
 * Called once per connection when it leaves the hub, whichever side closed
 * it. A listener that throws is contained; it must never take the hub down.
 * @param listener - Receives the connection and the close.
 * @returns Unsubscribe.
 */
export function onConnectionClosed(listener: (info: ConnectionClosedInfo) => void): () => void {
  closedListeners.add(listener)
  return () => { closedListeners.delete(listener) }
}

/** Wire form of a server message. */
export const serializeServerMessage = (m: ServerMessage): string => JSON.stringify(m)

/** The event message: the envelope plus the topic the client knows it by. */
export function eventMessage(envelope: RealtimeEnvelope): EventMessage {
  return { op: 'event', topic: topicOf(envelope.ch), ...envelope }
}

export class HubConnection implements RouterConnection, ReauthorizableConnection {
  readonly id: string
  identity: RealtimeIdentity
  readonly socket: HubSocket
  /** 'ws' or 'sse' when the adapter said; null for a socket attached directly (tests). */
  readonly transport: HubTransport | null
  readonly openedAt = Date.now()
  messagesIn = 0
  messagesOut = 0
  closed = false
  /** Channel to the topic it was subscribed as, for the messages that name a topic. */
  readonly topics = new Map<string, string>()
  /** Channels whose replay is still being read from the store, with the live envelopes held meanwhile. */
  readonly replaying = new Map<string, RealtimeEnvelope[]>()

  constructor(id: string, identity: RealtimeIdentity, socket: HubSocket, private readonly hub: RealtimeHub, transport: HubTransport | null = null) {
    this.id = id
    this.identity = identity
    this.socket = socket
    this.transport = transport
  }

  /** RouterConnection: raw wire text to the socket. */
  send(message: string): boolean {
    if (this.closed) return true
    const accepted = this.socket.send(message)
    if (accepted) this.messagesOut++
    return accepted
  }

  /** A protocol message, serialized. Control messages bypass the event queue on purpose. */
  tell(message: ServerMessage): void {
    this.send(serializeServerMessage(message))
  }

  close(code: number, reason: string): void {
    if (this.closed) return
    this.closed = true
    this.hub.forget(this, code, reason)
    this.socket.close(code, reason)
  }

  channels(): string[] {
    return [...this.topics.keys()]
  }

  /** ReauthorizableConnection: drop one subscription and tell the client why. */
  unsubscribe(channel: string, reason: RefusalReason): void {
    const topic = this.topics.get(channel) ?? topicOf(channel)
    this.hub.router.unsubscribe(this, channel)
    this.topics.delete(channel)
    this.tell({ op: 'refused', topic, reason })
  }
}

export class RealtimeHub {
  readonly router: SubscriptionRouter
  readonly retention: RetentionStore
  readonly connections = new Map<string, HubConnection>()
  private forwardHook: ((envelope: RealtimeEnvelope) => void) | null
  private readonly ticketStore: TicketStore
  private readonly permissionLoader: HubOptions['permissionLoader']
  private readonly maxSubscriptions: number
  private readonly hardConnectionCap: number
  private readonly idFactory: () => string
  /** R3: the presence service, when this process runs one. */
  readonly presence: PresenceService | null

  constructor(opts: HubOptions) {
    this.ticketStore = opts.ticketStore
    this.permissionLoader = opts.permissionLoader
    this.retention = opts.retention ?? new MemoryRetention()
    this.forwardHook = opts.forward ?? null
    this.presence = opts.presence ?? null
    this.maxSubscriptions = opts.maxSubscriptionsPerConnection ?? 32
    this.hardConnectionCap = opts.hardConnectionCap ?? PROCESS_CONNECTION_HARD_CAP
    this.idFactory = opts.idFactory ?? (() => `rtc_${randomBytes(8).toString('hex')}`)
    this.router = new SubscriptionRouter({
      maxSubscriptionsPerConnection: this.maxSubscriptions,
      maxQueuedPerConnection: opts.maxQueuedPerConnection,
      serialize: (e) => serializeServerMessage(eventMessage(e)),
    })
  }

  // ── Admission ───────────────────────────────────────────────────────────────

  /**
   * Turns a ticket into an identity with current permissions, before any
   * socket exists. Null when the ticket is bad or the identity is gone.
   */
  async identify(ticket: string | null | undefined): Promise<RealtimeIdentity | null> {
    if (!ticket) return null
    const claims = await redeemTicket(this.ticketStore, ticket)
    if (!claims) return null
    const identity = await this.identityFromClaims(claims)
    if (identity && hubGate?.admit) await hubGate.admit(identity)
    return identity
  }

  private async identityFromClaims(claims: RealtimeTicketClaims): Promise<RealtimeIdentity | null> {
    const identity: RealtimeIdentity = {
      workspaceId: claims.workspaceId,
      memberId: claims.memberId,
      apiKeyId: claims.apiKeyId,
      memberRole: claims.memberRole,
      // R5: a site-key ticket is the key's identity with the site member named on it.
      authMode: claims.authMode === 'site-key' ? 'api_key' : claims.authMode,
      ...(claims.authMode === 'site-key' && claims.siteUserId ? { siteUserId: claims.siteUserId } : {}),
      permissions: { objects: {} },
    }
    const permissions = await this.permissionLoader(identity)
    if (!permissions) return null
    identity.permissions = permissions
    return identity
  }

  /** Is the process under its hard safety cap? (The governed ceiling is the gate's, asked in identify().) */
  hasCapacity(): boolean {
    return this.connections.size < this.hardConnectionCap
  }

  /**
   * Registers an open socket under an identity and sends `ready`.
   * Refuses (closes with CLOSE_CAPACITY) at the hard cap.
   * @param transport - Which adapter the socket came through, for the connection log.
   */
  attach(identity: RealtimeIdentity, socket: HubSocket, transport: HubTransport | null = null): HubConnection | null {
    if (!this.hasCapacity()) {
      socket.close(CLOSE_CAPACITY, 'capacity')
      return null
    }
    const conn = new HubConnection(this.idFactory(), identity, socket, this, transport)
    this.connections.set(conn.id, conn)
    try { hubGate?.opened?.(conn) } catch { /* a gate must not take the hub down */ }
    conn.tell({
      op: 'ready',
      connectionId: conn.id,
      workspaceId: identity.workspaceId,
      limits: { maxSubscriptions: this.maxSubscriptions, maxMessageBytes: MAX_MESSAGE_BYTES },
      replay: this.retention.limits(),
      presence: this.presence?.limits() ?? { ...REALTIME_PRESENCE_DEFAULTS },
    })
    return conn
  }

  /** The transport saw the socket close: every subscription goes with it. */
  disconnect(conn: HubConnection, code?: number, reason?: string): void {
    conn.closed = true
    this.forget(conn, code ?? null, reason ?? null)
  }

  /** Internal: drop the connection from the router and the registry, and tell the listeners once. */
  forget(conn: HubConnection, code: number | null = null, reason: string | null = null): void {
    const known = this.connections.delete(conn.id)
    const subscriptions = conn.topics.size
    this.router.remove(conn)
    conn.topics.clear()
    conn.replaying.clear()
    // R3: a closed socket leaves every scope it joined; the leaves fan out like any other.
    if (known && this.presence) void this.presence.leaveAll(conn).catch(() => {})
    if (!known) return
    const info: ConnectionClosedInfo = { connection: conn, code, reason, subscriptions }
    for (const listener of closedListeners) {
      try { listener(info) } catch { /* a listener must not take the hub down */ }
    }
  }

  /** Installs (or clears) the infrastructure-bus hook after construction. */
  setForward(hook: ((envelope: RealtimeEnvelope) => void) | null): void {
    this.forwardHook = hook
  }

  drain(conn: HubConnection): void {
    this.router.drain(conn)
  }

  // ── Protocol ────────────────────────────────────────────────────────────────

  /**
   * Counts one inbound message and asks the gate, before anything is parsed:
   * every frame a transport hands over is budgeted, whatever protocol it
   * speaks (R5: the graphql-ws adapter calls this for its own frames).
   * @returns False when the gate closed the connection.
   */
  noteMessage(conn: HubConnection): boolean {
    conn.messagesIn++
    try { hubGate?.message?.(conn) } catch { /* a gate must not take the hub down */ }
    return !conn.closed
  }

  /** One upstream message, raw or already parsed. */
  handleMessage(conn: HubConnection, raw: unknown): void {
    if (!this.noteMessage(conn)) return
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) {
      conn.tell({ op: 'refused', topic: parsed.topic, reason: parsed.reason })
      return
    }
    const m = parsed.message
    switch (m.op) {
      case 'subscribe':
        this.subscribe(conn, m.topic, m.since)
        return
      case 'unsubscribe':
        this.unsubscribe(conn, m.topic)
        return
      case 'ping':
        conn.tell({ op: 'pong', t: Date.now() })
        return
      case 'presence':
        void this.handlePresence(conn, m)
        return
    }
  }

  // ── Presence (R3) ───────────────────────────────────────────────────────────

  /** Presence channels with a local subscriber: what the sweep watches besides local sessions. */
  presenceChannels(): string[] {
    return this.router.channelNames().filter((ch) => topicOf(ch).startsWith(PRESENCE_TOPIC_PREFIX))
  }

  /**
   * One presence op. Authorized like a subscription to `presence:<scope>`
   * (read on the scope's resource), then handed to the service; a join is
   * answered with the snapshot, everything else with silence or a refusal.
   */
  async handlePresence(conn: HubConnection, m: Extract<ClientMessage, { op: 'presence' }>): Promise<void> {
    const topic = `${PRESENCE_TOPIC_PREFIX}${m.scope}`
    if (!this.presence) { conn.tell({ op: 'refused', topic, reason: 'unsupported' }); return }
    // The per-type aggregate is derived from object sessions; nobody joins it.
    if (isAggregateScope(m.scope)) { conn.tell({ op: 'refused', topic, reason: 'invalid_topic' }); return }
    const decision = authorizeTopic(conn.identity, topic)
    if (!decision.ok) { conn.tell({ op: 'refused', topic, reason: decision.reason }); return }
    // A session that names its type is mirrored on that type's aggregate: the
    // type's read rule applies to the claim as it does to watching the aggregate.
    if (m.state?.typeSlug) {
      const typeDecision = authorizeTopic(conn.identity, `objects:${m.state.typeSlug}`)
      if (!typeDecision.ok) { conn.tell({ op: 'refused', topic, reason: typeDecision.reason }); return }
    }
    try {
      switch (m.action) {
        case 'join': {
          const r = await this.presence.join(conn, m.scope, m.state!)
          if (conn.closed) return
          if (!r.ok) { conn.tell({ op: 'refused', topic, reason: r.reason }); return }
          conn.tell({ op: 'presence', scope: m.scope, self: r.snapshot.self, members: r.snapshot.members as never, claim: r.snapshot.claim as never })
          return
        }
        case 'heartbeat': {
          const r = await this.presence.heartbeat(conn, m.scope)
          if (!r.ok && !conn.closed) conn.tell({ op: 'refused', topic, reason: r.reason })
          return
        }
        case 'update': {
          const r = await this.presence.update(conn, m.scope, m.state!, m.takeover === true)
          if (!r.ok && !conn.closed) conn.tell({ op: 'refused', topic, reason: r.reason })
          return
        }
        case 'leave':
          await this.presence.leave(conn, m.scope)
          return
      }
    } catch {
      // A store that is down must not take the connection with it; the client retries on its heartbeat.
    }
  }

  /** Drops one subscription and acknowledges it; a topic never held is acknowledged too. */
  unsubscribe(conn: HubConnection, topic: string): void {
    const channel = channelFor(conn.identity, topic)
    this.router.unsubscribe(conn, channel)
    conn.topics.delete(channel)
    conn.replaying.delete(channel)
    conn.tell({ op: 'unsubscribed', topic })
  }

  /** Authorise, subscribe, acknowledge, then replay from the cursor if one was given. */
  subscribe(conn: HubConnection, topic: string, since?: string): void {
    const decision = authorizeTopic(conn.identity, topic)
    if (!decision.ok) {
      conn.tell({ op: 'refused', topic, reason: decision.reason })
      return
    }
    const channel = channelFor(conn.identity, topic)
    const result = this.router.subscribe(conn, channel)
    if (!result.ok) {
      conn.tell({ op: 'refused', topic, reason: result.reason })
      return
    }
    conn.topics.set(channel, topic)
    conn.tell({ op: 'subscribed', topic })
    // R3: a watcher of a presence topic keeps the expiry sweep running even without joining.
    if (this.presence && topic.startsWith(PRESENCE_TOPIC_PREFIX)) {
      this.presence.wake()
      const scope = topic.slice(PRESENCE_TOPIC_PREFIX.length)
      if (isAggregateScope(scope)) {
        // A per-type aggregate is watched, never joined, so the subscription
        // itself is answered with the snapshot a join would get: everyone on
        // any object of the type right now. Listed after the subscription is
        // in the router, so a join in between still reaches the watcher.
        void this.presence.members(conn.identity, scope).then(
          (members) => { if (!conn.closed && conn.topics.has(channel)) conn.tell({ op: 'presence', scope, self: conn.id, members: members as never, claim: null }) },
          () => { /* a store that is down: the list shows nobody until the next subscribe */ },
        )
      }
    }
    if (since === undefined) return
    const replay = this.retention.since(channel, since)
    if (replay instanceof Promise) {
      // Hold live envelopes for this channel until the replay is on the wire.
      conn.replaying.set(channel, [])
      replay.then(
        (r) => this.finishReplay(conn, channel, topic, r),
        () => this.finishReplay(conn, channel, topic, { kind: 'resync' }),
      )
      return
    }
    this.applyReplay(conn, topic, replay)
  }

  private applyReplay(conn: HubConnection, topic: string, replay: Awaited<ReturnType<RetentionStore['since']>>): string | null {
    if (replay.kind === 'resync') {
      conn.tell({ op: 'resync', topic })
      return null
    }
    let last: string | null = null
    for (const envelope of replay.events) {
      if (mayReceive(conn.identity, envelope)) this.router.sendTo(conn, envelope)
      last = envelope.id
    }
    return last
  }

  /** The store answered: send the replay, then the held live envelopes it did not cover. */
  private finishReplay(conn: HubConnection, channel: string, topic: string, replay: Awaited<ReturnType<RetentionStore['since']>>): void {
    const held = conn.replaying.get(channel)
    conn.replaying.delete(channel)
    if (conn.closed || !conn.topics.has(channel)) return
    const last = this.applyReplay(conn, topic, replay)
    for (const envelope of held ?? []) {
      if (last && compareIds(envelope.id, last) <= 0) continue
      this.router.sendTo(conn, envelope)
    }
  }

  // ── Publishing ──────────────────────────────────────────────────────────────

  /**
   * Retains one event on a channel, dispatches it to the local subscribers
   * that may receive it, then forwards it to the other processes.
   * @returns The envelope as retained - in place with the memory store, as
   *          a promise with a remote one - so a caller can log or await it.
   */
  publishChannel(channel: string, type: string, data: Record<string, unknown>): MaybePromise<RealtimeEnvelope> {
    const retained = this.retention.append(channel, { type, data })
    if (retained instanceof Promise) return retained.then((envelope) => this.afterRetained(envelope))
    return this.afterRetained(retained)
  }

  private afterRetained(envelope: RealtimeEnvelope): RealtimeEnvelope {
    this.dispatch(envelope)
    this.forwardHook?.(envelope)
    return envelope
  }

  /** Convenience over publishChannel with the channel built from scope and topic. */
  publish(scope: { workspaceId: string}, topic: string, type: string, data: Record<string, unknown>): MaybePromise<RealtimeEnvelope> {
    return this.publishChannel(channelFor(scope, topic), type, data)
  }

  /** Dispatches an envelope that is already retained - ours, or one heard from the bus. */
  dispatch(envelope: RealtimeEnvelope): number {
    return this.router.publish(envelope, (c) => {
      const conn = c as HubConnection
      if (!mayReceive(conn.identity, envelope)) return false
      const held = conn.replaying.get(envelope.ch)
      if (held) { held.push(envelope); return false }
      return true
    })
  }

  // ── Permission drift ────────────────────────────────────────────────────────

  /**
   * Re-checks every open connection of one member (or all members when none
   * is named) against freshly loaded permissions. Called from the env-role
   * invalidation seam.
   */
  async reauthorizeMember(memberId?: string): Promise<void> {
    const targets = [...this.connections.values()].filter((c) =>
      c.identity.authMode === 'member' && (!memberId || c.identity.memberId === memberId))
    await Promise.all(targets.map((c) => this.reauthorizeConnection(c)))
  }

  async reauthorizeConnection(conn: HubConnection): Promise<void> {
    let fresh: EffectivePermissions | null
    try {
      fresh = await this.permissionLoader(conn.identity)
    } catch {
      // Cannot decide: keep what it holds rather than cut a connection on a transient.
      return
    }
    if (conn.closed) return
    reauthorize(conn, fresh)
  }

  /** STOP: every open connection is closed with one code and reason (1001: the server is going away). */
  closeAll(code = 1001, reason = 'server shutting down'): number {
    const open = [...this.connections.values()]
    for (const conn of open) { try { conn.close(code, reason) } catch { /* already gone */ } }
    return open.length
  }

  stats(): { connections: number; subscriptions: number; channels: number } {
    return this.router.stats()
  }
}

export { CLOSE_REVOKED }
