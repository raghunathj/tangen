/**
 * File Name: transports.ts
 * Purpose: The two client-side adapters - a WebSocket and an EventSource -
 *          behind one interface the client drives without knowing which.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The architecture's section 6: one protocol, two
 *          adapters, the SDK hides the choice. The WebSocket adapter sends
 *          protocol messages. The SSE adapter cannot send anything after the
 *          request, so subscribe and unsubscribe change its topic set and
 *          schedule a reopen with the new set and the current cursors; the
 *          client treats the `ready` and `subscribed` a reopen re-sends as
 *          idempotent. Both take their constructors by injection so a test,
 *          a worker or a non-browser runtime can supply its own.
 *
 *          R4: the SSE adapter gained one upstream, injected rather than
 *          invented - `send` posts a presence message to
 *          POST /api/v1/realtime/presence, addressed by the connection id
 *          the server named in `ready`. Same protocol, same server handler,
 *          same answers back down the stream; only the direction of the one
 *          message differs, because an EventSource has no direction.
 *
 *          `failedBeforeOpen` on close is the signal the client's automatic
 *          fallback keys on: a WebSocket that never opened (a proxy that
 *          does not forward upgrades, a corporate middlebox) is retried as
 *          SSE, not as another WebSocket.
 */
import { parseServerMessage, encodeCursorMap, type ServerMessage, type ClientMessage } from './protocol'

export interface TransportHandlers {
  onOpen(): void
  onMessage(message: ServerMessage): void
  onClose(info: { code: number; reason: string; failedBeforeOpen: boolean }): void
}

export interface Transport {
  readonly kind: 'websocket' | 'sse'
  subscribe(topic: string, since?: string): void
  unsubscribe(topic: string): void
  ping(): void
  /** R3: an upstream message beyond the three ops (presence). False when the transport cannot send. */
  send(message: ClientMessage): boolean
  close(): void
}

/** The subset of the WebSocket constructor and instance the adapter uses. */
export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type WebSocketCtor = new (url: string) => WebSocketLike

/** The subset of EventSource the adapter uses. */
export interface EventSourceLike {
  close(): void
  addEventListener(type: string, listener: (ev: { data: string; lastEventId?: string }) => void): void
  onerror: ((ev: unknown) => void) | null
  onopen: ((ev: unknown) => void) | null
}
export type EventSourceCtor = new (url: string, init?: { withCredentials?: boolean }) => EventSourceLike

const SSE_EVENT_NAMES = ['ready', 'event', 'presence', 'subscribed', 'unsubscribed', 'refused', 'resync', 'pong', 'close'] as const

export function openWebSocketTransport(
  url: string,
  WS: WebSocketCtor,
  handlers: TransportHandlers,
): Transport {
  let opened = false
  let closedByUs = false
  const ws = new WS(url)
  const send = (m: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)) }
  ws.onopen = () => { opened = true; handlers.onOpen() }
  ws.onmessage = (ev) => {
    const m = parseServerMessage(ev.data)
    if (m) handlers.onMessage(m)
  }
  ws.onerror = () => { /* the close event that follows carries the verdict */ }
  ws.onclose = (ev) => {
    if (closedByUs) return
    handlers.onClose({ code: ev.code, reason: ev.reason, failedBeforeOpen: !opened })
  }
  return {
    kind: 'websocket',
    subscribe(topic, since) { send(since === undefined ? { op: 'subscribe', topic } : { op: 'subscribe', topic, since }) },
    unsubscribe(topic) { send({ op: 'unsubscribe', topic }) },
    ping() { send({ op: 'ping' }) },
    send(message) { if (ws.readyState !== 1) return false; send(message); return true },
    close() {
      closedByUs = true
      try { ws.close(1000, 'client') } catch { /* already closed */ }
    },
  }
}

export interface SseTransportOptions {
  /** Builds the stream URL for a topic set and the cursors to resume from. */
  url: (topics: string[], cursors: Map<string, string>) => string
  /** The client's current cursor for a topic, for a reopen. */
  cursorOf: (topic: string) => string | null
  /**
   * R4: how this adapter sends upstream. An EventSource cannot, so the
   * client hands in the HTTP presence route (POST /realtime/presence,
   * addressed by connection id); without one the adapter still cannot send
   * and presence stays observe-only, as it was.
   */
  send?: (message: ClientMessage) => boolean
  schedule?: (fn: () => void) => void
}

export function openSseTransport(
  ES: EventSourceCtor,
  opts: SseTransportOptions,
  handlers: TransportHandlers,
  initialTopics: string[] = [],
): Transport {
  const topics = new Set(initialTopics)
  let source: EventSourceLike | null = null
  let opened = false
  let closed = false
  let reopenScheduled = false
  const schedule = opts.schedule ?? ((fn) => { void Promise.resolve().then(fn) })

  const open = () => {
    if (closed) return
    const cursors = new Map<string, string>()
    for (const t of topics) { const c = opts.cursorOf(t); if (c) cursors.set(t, c) }
    const es = new ES(opts.url([...topics], cursors))
    source = es
    es.onopen = () => { if (!opened) { opened = true; handlers.onOpen() } }
    for (const name of SSE_EVENT_NAMES) {
      es.addEventListener(name, (ev) => {
        const m = parseServerMessage(ev.data)
        if (m) handlers.onMessage(m)
      })
    }
    es.onerror = () => {
      // An EventSource retries by itself; a failure before any open is the
      // one case the client must hear about, since there is nothing to fall
      // back to after SSE.
      if (!opened && !closed) {
        closed = true
        es.close()
        handlers.onClose({ code: 1006, reason: 'sse_failed', failedBeforeOpen: true })
      }
    }
  }

  const reopen = () => {
    if (reopenScheduled || closed) return
    reopenScheduled = true
    schedule(() => {
      reopenScheduled = false
      if (closed) return
      source?.close()
      open()
    })
  }

  open()

  return {
    kind: 'sse',
    subscribe(topic) { if (!topics.has(topic)) { topics.add(topic); reopen() } },
    unsubscribe(topic) { if (topics.delete(topic)) reopen() },
    ping() { handlers.onMessage({ op: 'pong', t: Date.now() }) },
    // An EventSource has no upstream of its own; R4's HTTP presence route is
    // the one the client passes in, so a stream is a first-class publisher.
    send(message) { return opts.send?.(message) === true },
    close() {
      closed = true
      source?.close()
      source = null
    },
  }
}

/** Shared URL helpers. */
export function resolveApiBase(apiUrl: string, origin?: string): string {
  const base = new URL(apiUrl || '/', origin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost'))
  let path = base.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/api/v1')) path = `${path}/api/v1`
  return `${base.origin}${path}`
}

export function websocketUrl(apiBase: string, ticket: string): string {
  return `${apiBase.replace(/^http/, 'ws')}/realtime?ticket=${encodeURIComponent(ticket)}`
}

export function streamUrl(apiBase: string, ticket: string, topics: string[], cursors: Map<string, string>): string {
  const since = cursors.size ? `&since=${encodeURIComponent(encodeCursorMap(cursors))}` : ''
  return `${apiBase}/realtime/stream?ticket=${encodeURIComponent(ticket)}&topics=${encodeURIComponent(topics.join(','))}${since}`
}
