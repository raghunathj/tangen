/**
 * File Name: client.ts
 * Purpose: createRealtimeClient - the lazy, multiplexed, self-healing
 *          realtime client for sites, apps and (through @tangen/realtime-
 *          admin) the admin.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 7, 8,
 *          11-15 and 41-42. The behaviours, in the order they matter:
 *
 *          LAZY. Creating the client opens nothing and mints nothing. The
 *          first subscribe mints a ticket and opens the connection; when the
 *          last handler goes, an idle timer (default 5 s) closes it. A page
 *          that never subscribes never touches the network.
 *
 *          ONE CONNECTION. Every topic is a logical subscription on the one
 *          socket; many handlers on one topic share one server subscription.
 *
 *          RESUME. The client remembers the last event id per topic and
 *          re-subscribes with `since` after a reconnect; the server replays
 *          what was missed or says `resync`, which the client surfaces as
 *          onResyncRequired(topic) so the application refetches through REST
 *          or GraphQL. Realtime signals; it does not replicate.
 *
 *          RECONNECT. Exponential backoff with full jitter, bounded. A
 *          WebSocket that never opened is retried as SSE automatically; a
 *          `revoked` close (4403) is final; `slow` (4008) and `capacity`
 *          (4013) reconnect like any drop.
 *
 *          PRESENCE ON SSE. An EventSource cannot send, so a stream publishes
 *          presence over POST /api/v1/realtime/presence instead, addressed by
 *          the connection id from `ready` (`postPresence`, which the admin
 *          fills with its authenticated fetch and the default fills with the
 *          API key). Same message, same server handler, same answers back
 *          down the stream; `presence.supported()` is true on either
 *          transport once there is a way to publish.
 *
 *          AUTH. The ticket comes from POST /api/v1/realtime/ticket with the
 *          SDK's API key as Bearer, or from a caller-supplied mintTicket (the
 *          admin's authenticated fetch). The TangenClient from @tangen/sdk
 *          does not expose its config, so `client` here is the ClientConfig
 *          object the site already passed to createClient(); a change
 *          request asks the SDK to expose it so the literal
 *          createRealtimeClient({ client: tangen }) works too.
 */
import { createBackoff, type BackoffOptions } from './backoff'
import {
  openWebSocketTransport, openSseTransport, resolveApiBase, websocketUrl, streamUrl,
  type Transport, type WebSocketCtor, type EventSourceCtor,
} from './transports'
import { CLOSE_REVOKED, CLOSE_RATE_LIMITED, type ClientMessage, type PresenceRequest, type RealtimeEvent, type RefusedReason, type ServerMessage } from './protocol'
import { rememberOrigin } from './own-write'
import { PresenceStore, createPresenceController, type PresenceApi, type PresenceVisibility, type PresenceTimers } from './presence'

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
export type RealtimeHandler<T extends Record<string, unknown> = Record<string, unknown>> = (event: RealtimeEvent<T>) => void

export interface RealtimeClientOptions {
  /** The site's API origin (or a base ending in /api/v1). Relative values resolve against location.origin. */
  apiUrl?: string
  /** API key for the default ticket mint. */
  apiKey?: string
  /** The ClientConfig passed to @tangen/sdk createClient(): apiUrl, apiKey, fetch. */
  client?: { apiUrl: string; apiKey: string; fetch?: FetchFn }
  /** Custom ticket mint; returns the raw ticket. The admin uses its authenticated fetch here. */
  mintTicket?: () => Promise<string>
  /**
   * How a presence message is published when the connection is an SSE
   * stream (an EventSource cannot send). Defaults to POST
   * /api/v1/realtime/presence with the API key as Bearer; the admin passes
   * its own authenticated fetch. Without one - no key and no override -
   * presence on SSE stays observe-only, as it was before R4.
   */
  postPresence?: (body: PresenceRequest) => Promise<unknown>
  fetch?: FetchFn
  /** Milliseconds an idle connection (no handlers) stays open. Default 5000; Infinity keeps it. */
  idleCloseMs?: number
  /** Client keep-alive ping interval while open. Default 25000; 0 disables. */
  pingIntervalMs?: number
  reconnect?: BackoffOptions
  /** Wait before reconnecting after a `4029 rate_limited` close (the Gateway's message budget). Default 30000. */
  rateLimitedDelayMs?: number
  /** 'auto' (default): WebSocket, falling back to SSE when the upgrade never opens. */
  transport?: 'auto' | 'websocket' | 'sse'
  /** Injected constructors for tests and non-browser runtimes. */
  WebSocket?: WebSocketCtor
  EventSource?: EventSourceCtor
  /** Origin for relative apiUrl outside a browser. */
  origin?: string
  /** R3 presence tuning; the heartbeat period defaults to what the server's `ready` says. */
  presence?: {
    heartbeatMs?: number
    /** Minimum spacing of presence messages per scope; the server refuses closer ones. Default 2000. */
    minIntervalMs?: number
    /** Pause heartbeats while the document is hidden. Default true. */
    pauseWhenHidden?: boolean
    /** Injected for tests and non-browser runtimes. */
    visibility?: PresenceVisibility
    timers?: PresenceTimers
    now?: () => number
  }
}

export interface RealtimeClient {
  /** Subscribes a handler to a topic; the first subscription opens the connection. Returns the unsubscribe. */
  subscribe<T extends Record<string, unknown> = Record<string, unknown>>(topic: string, handler: RealtimeHandler<T>): () => void
  /** Removes one handler, or every handler of the topic when none is given. */
  unsubscribe(topic: string, handler?: RealtimeHandler): void
  /** Opens the connection now, without waiting for a subscription. */
  connect(): Promise<void>
  /** Closes the connection and stops reconnecting until the next subscribe or connect. */
  disconnect(): void
  status(): RealtimeStatus
  /** Which transport carries the open connection, if any. */
  transport(): 'websocket' | 'sse' | null
  /**
   * The id the server gave this connection, or null before one opened. It
   * is the ORIGIN a write issued from this tab carries (own-write.ts): the
   * fetch helpers send it as X-Tangen-Origin and the envelope comes back
   * stamped with it, so an echo of my own write is recognisable without
   * knowing who I am logged in as.
   */
  connectionId(): string | null
  onStatus(fn: (status: RealtimeStatus) => void): () => void
  /** Fires after a connection is re-established and every topic re-subscribed. */
  onReconnect(fn: () => void): () => void
  /** The server could not replay a topic's gap: refetch canonical state. */
  onResyncRequired(fn: (topic: string) => void): () => void
  /** The server refused a topic (permission, limit, shape). */
  onRefused(fn: (topic: string | null, reason: RefusedReason) => void): () => void
  topics(): string[]
  /** R3: join a scope, heartbeat while joined, read who is there. Needs the WebSocket transport. */
  presence: PresenceApi
}

interface TopicState {
  handlers: Set<RealtimeHandler>
  cursor: string | null
  subscribed: boolean
}

class Emitter<A extends unknown[]> {
  private readonly fns = new Set<(...args: A) => void>()
  on(fn: (...args: A) => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn) } }
  emit(...args: A): void { for (const fn of [...this.fns]) { try { fn(...args) } catch { /* a listener never breaks the client */ } } }
}

export function createRealtimeClient(options: RealtimeClientOptions = {}): RealtimeClient {
  const apiUrl = options.apiUrl ?? options.client?.apiUrl ?? ''
  const apiKey = options.apiKey ?? options.client?.apiKey
  const fetchFn: FetchFn = options.fetch ?? options.client?.fetch ?? ((...a) => globalThis.fetch(...a))
  const apiBase = resolveApiBase(apiUrl, options.origin)
  const idleCloseMs = options.idleCloseMs ?? 5_000
  const pingIntervalMs = options.pingIntervalMs ?? 25_000
  const backoff = createBackoff(options.reconnect)
  const WS = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket
  const ES = options.EventSource ?? (globalThis as { EventSource?: EventSourceCtor }).EventSource
  const preferred = options.transport ?? 'auto'

  const mintTicket = options.mintTicket ?? (async () => {
    if (!apiKey) throw new Error('@tangen/realtime: pass apiKey (or client) or a mintTicket function')
    const res = await fetchFn(`${apiBase}/realtime/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) throw new Error(`@tangen/realtime: ticket request failed (${res.status})`)
    const body = await res.json() as { data?: { ticket?: string } }
    if (!body?.data?.ticket) throw new Error('@tangen/realtime: ticket response carried no ticket')
    return body.data.ticket
  })

  const postPresence = options.postPresence ?? (apiKey
    ? async (body: PresenceRequest) => {
      const res = await fetchFn(`${apiBase}/realtime/presence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`@tangen/realtime: presence request failed (${res.status})`)
      return res
    }
    : null)

  const topics = new Map<string, TopicState>()
  const statusEmitter = new Emitter<[RealtimeStatus]>()
  const reconnectEmitter = new Emitter<[]>()
  const resyncEmitter = new Emitter<[string]>()
  const refusedEmitter = new Emitter<[string | null, RefusedReason]>()

  let status: RealtimeStatus = 'idle'
  let transport: Transport | null = null
  let ready = false
  /**
   * The server's id for this connection: the origin a write from this tab
   * carries, and the address the HTTP presence route needs.
   */
  let connectionId: string | null = null
  let attempt = 0
  let wasConnected = false
  let useSse = preferred === 'sse'
  let stopped = false            // disconnect() until the next subscribe/connect
  let generation = 0             // invalidates stale async opens
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  // R3: presence rides the same connection; joining a scope subscribes to
  // its topic, so the lazy open and the idle close apply to it unchanged.
  const presenceStore = new PresenceStore()
  const presence = createPresenceController({
    store: presenceStore,
    send: (m) => (ready && transport ? transport.send(m) : false),
    subscribeTopic: (topic, handler) => client.subscribe(topic, handler),
    heartbeatMs: options.presence?.heartbeatMs,
    minIntervalMs: options.presence?.minIntervalMs,
    pauseWhenHidden: options.presence?.pauseWhenHidden,
    visibility: options.presence?.visibility,
    timers: options.presence?.timers,
    now: options.presence?.now,
  })

  const setStatus = (s: RealtimeStatus) => { if (status !== s) { status = s; statusEmitter.emit(s) } }
  const liveTopics = () => [...topics.entries()].filter(([, t]) => t.handlers.size > 0).map(([k]) => k)
  const clearTimers = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
  }

  function dropTransport() {
    if (transport) { const t = transport; transport = null; t.close() }
    ready = false
    // The id belonged to that socket. The registry still remembers it, so a
    // write issued just before the drop is still recognised as ours.
    connectionId = null
    presence.onDisconnected()
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
    for (const t of topics.values()) t.subscribed = false
  }

  function subscribeAll() {
    if (!transport || !ready) return
    for (const [topic, state] of topics) {
      if (state.handlers.size === 0) continue
      transport.subscribe(topic, state.cursor ?? undefined)
    }
  }

  function handleMessage(m: ServerMessage) {
    switch (m.op) {
      case 'ready': {
        ready = true
        connectionId = m.connectionId
        // The one place a client learns its own identity on the wire. Kept
        // in the shared registry so a write issued anywhere in the tab can
        // stamp it without holding a reference to this client.
        rememberOrigin(m.connectionId)
        setStatus('open')
        subscribeAll()
        if (pingIntervalMs > 0 && !pingTimer) pingTimer = setInterval(() => transport?.ping(), pingIntervalMs)
        connectionId = m.connectionId
        // R4: a stream can publish too, as long as it has a way to POST.
        presence.onReady(m.connectionId, m.presence?.heartbeatSeconds, transport?.kind === 'websocket' || !!postPresence)
        if (wasConnected) reconnectEmitter.emit()
        wasConnected = true
        attempt = 0
        return
      }
      case 'presence':
        presence.applySnapshot(m)
        return
      case 'event': {
        const state = topics.get(m.topic)
        if (!state) return
        state.cursor = m.id
        const event: RealtimeEvent = { topic: m.topic, ch: m.ch, id: m.id, t: m.t, type: m.type, data: m.data }
        for (const h of [...state.handlers]) { try { h(event) } catch { /* one handler never breaks the rest */ } }
        return
      }
      case 'subscribed': {
        const state = topics.get(m.topic)
        if (state) state.subscribed = true
        return
      }
      case 'refused':
        refusedEmitter.emit(m.topic, m.reason)
        return
      case 'resync': {
        const state = topics.get(m.topic)
        if (state) state.cursor = null
        resyncEmitter.emit(m.topic)
        return
      }
      case 'close':
        // SSE: the server closed the stream on purpose (revoked, slow, capacity).
        handleClose({ code: m.code, reason: m.reason, failedBeforeOpen: false })
        return
      default:
        return
    }
  }

  function handleClose(info: { code: number; reason: string; failedBeforeOpen: boolean }) {
    const hadTransport = transport !== null
    dropTransport()
    if (stopped || !hadTransport) return
    if (info.code === CLOSE_REVOKED) { setStatus('closed'); return }
    if (liveTopics().length === 0 && status !== 'connecting') { setStatus('idle'); return }
    if (info.failedBeforeOpen && preferred === 'auto' && !useSse) {
      useSse = true
      void open()        // fall back at once; the attempt counter is untouched
      return
    }
    // The Gateway closed us for sending too much: coming straight back would be more of the same.
    if (info.code === CLOSE_RATE_LIMITED) { scheduleReconnect(options.rateLimitedDelayMs ?? 30_000); return }
    scheduleReconnect()
  }

  function scheduleReconnect(atLeastMs = 0) {
    const delay = backoff.delayFor(attempt)
    if (delay === null) { setStatus('closed'); return }
    attempt++
    setStatus('reconnecting')
    retryTimer = setTimeout(() => { retryTimer = null; void open() }, Math.max(delay, atLeastMs))
  }

  /**
   * The SSE adapter's one upstream: the presence message goes over HTTP,
   * addressed by this connection's id. Fire and forget - the snapshot, the
   * refusal and every envelope arrive on the stream, exactly as they do on a
   * socket - so the controller is told `true` the moment it is on its way.
   */
  function publishPresence(m: ClientMessage): boolean {
    if (m.op !== 'presence' || !postPresence || !connectionId) return false
    const body: PresenceRequest = { connectionId, scope: m.scope, action: m.action }
    if (m.state !== undefined) body.state = m.state
    if (m.takeover === true) body.takeover = true
    void postPresence(body).catch(() => { /* advisory: the next heartbeat says it again */ })
    return true
  }

  let opening = false          // a mint is in flight: three subscribes in one tick open one socket

  async function open(): Promise<void> {
    if (transport || stopped || opening) return
    const gen = ++generation
    opening = true
    if (status !== 'reconnecting') setStatus('connecting')
    let ticket: string
    try {
      ticket = await mintTicket()
    } catch {
      opening = false
      if (gen !== generation || stopped) return
      scheduleReconnect()
      return
    }
    opening = false
    if (gen !== generation || stopped || transport) return
    const handlers = { onOpen() { /* ready carries the verdict */ }, onMessage: handleMessage, onClose: handleClose }
    if (useSse || !WS) {
      if (!ES) { setStatus('closed'); return }
      transport = openSseTransport(ES, {
        url: (ts, cursors) => streamUrl(apiBase, ticket, ts, cursors),
        cursorOf: (topic) => topics.get(topic)?.cursor ?? null,
        send: (m) => publishPresence(m),
      }, handlers, liveTopics())
    } else {
      transport = openWebSocketTransport(websocketUrl(apiBase, ticket), WS, handlers)
    }
  }

  function ensureOpen() {
    stopped = false
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    if (!transport && !retryTimer) void open()
  }

  function maybeIdle() {
    if (liveTopics().length > 0 || idleTimer || !Number.isFinite(idleCloseMs)) return
    if (!transport && !retryTimer) { setStatus('idle'); return }
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (liveTopics().length > 0) return
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      dropTransport()
      setStatus('idle')
    }, idleCloseMs)
  }

  const client: RealtimeClient = {
    subscribe(topic, handler) {
      let state = topics.get(topic)
      if (!state) { state = { handlers: new Set(), cursor: null, subscribed: false }; topics.set(topic, state) }
      const wasEmpty = state.handlers.size === 0
      state.handlers.add(handler as RealtimeHandler)
      ensureOpen()
      if (wasEmpty && transport && ready) transport.subscribe(topic, state.cursor ?? undefined)
      return () => client.unsubscribe(topic, handler as RealtimeHandler)
    },
    unsubscribe(topic, handler) {
      const state = topics.get(topic)
      if (!state) return
      if (handler) state.handlers.delete(handler); else state.handlers.clear()
      if (state.handlers.size === 0) {
        if (transport && ready) transport.unsubscribe(topic)
        state.subscribed = false
        maybeIdle()
      }
    },
    async connect() { ensureOpen() },
    disconnect() {
      stopped = true
      generation++
      clearTimers()
      dropTransport()
      setStatus('closed')
    },
    status: () => status,
    transport: () => transport?.kind ?? null,
    connectionId: () => connectionId,
    onStatus: (fn) => statusEmitter.on(fn),
    onReconnect: (fn) => reconnectEmitter.on(fn),
    onResyncRequired: (fn) => resyncEmitter.on(fn),
    onRefused: (fn) => refusedEmitter.on(fn),
    topics: liveTopics,
    presence,
  }
  return client
}
