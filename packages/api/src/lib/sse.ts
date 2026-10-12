/**
 * File Name: sse.ts
 * Purpose: Shared Server-Sent Events plumbing — one place for the SSE wire
 *          format (event/comment frames), building a streaming Response from an
 *          async iterable (AI token streams), and parsing an UPSTREAM provider
 *          SSE body into messages. Used by the preview stream and every AI
 *          streaming surface so all of them speak the exact same format.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: zero deps. sseResponse turns iteration errors into a
 *          terminal `error` event (never a half-written frame), sends heartbeat
 *          comments while the producer is quiet, and propagates client
 *          disconnects to the producer via iterator.return() so generators can
 *          abort their upstream fetches in `finally`.
 */

// ─── Wire format ──────────────────────────────────────────────────────────────

/**
 * Formats a named SSE event frame with id, event type, and JSON-encoded data.
 * @param id - Unique event identifier
 * @param event - SSE event name (e.g. "object.updated", "delta")
 * @param data - Payload to JSON-encode as the data field
 * @returns Formatted SSE event string
 */
export function formatSSEEvent(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Formats an SSE comment frame used for heartbeat pings and connection acknowledgements.
 * @param text - Comment text (e.g. "ping" or "connected")
 * @returns Formatted SSE comment string
 */
export function formatSSEComment(text: string): string {
  return `: ${text}\n\n`
}

// ─── Response from an async iterable ─────────────────────────────────────────

/** One event a producer wants on the wire. */
export interface SSEStreamEvent {
  event: string
  data: unknown
}

const DEFAULT_HEARTBEAT_MS = 30_000

/**
 * Builds a `text/event-stream` Response from an async iterable of events.
 * - Heartbeat comments (`: ping`) flow every `heartbeatMs` (default 30s) so
 *   proxies keep the connection open while the producer thinks.
 * - A producer error becomes a terminal `event: error` frame with `{ message }`
 *   — the stream always ends in either the producer's own last event or that
 *   error frame, never mid-frame.
 * - Client disconnect (stream cancel) calls `iterator.return()`, so generator
 *   producers run their `finally` blocks and can abort upstream work.
 */
export function sseResponse(
  events: AsyncIterable<SSEStreamEvent>,
  opts: { heartbeatMs?: number } = {},
): Response {
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const iterator = events[Symbol.asyncIterator]()
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let eventId = 0

  const stream = new ReadableStream<string>({
    async start(controller) {
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(formatSSEComment('ping'))
        } catch {
          clearInterval(heartbeatTimer)
        }
      }, heartbeatMs)

      try {
        while (true) {
          const { value, done } = await iterator.next()
          if (done) break
          controller.enqueue(formatSSEEvent(String(++eventId), value.event, value.data))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        try {
          controller.enqueue(formatSSEEvent(String(++eventId), 'error', { message }))
        } catch { /* client already gone */ }
      } finally {
        clearInterval(heartbeatTimer)
        try { controller.close() } catch { /* already closed */ }
      }
    },
    cancel() {
      clearInterval(heartbeatTimer)
      void iterator.return?.().catch(() => { /* producer cleanup is best-effort */ })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ─── Upstream SSE parsing (provider streams) ─────────────────────────────────

/** One parsed message from an upstream SSE body. */
export interface UpstreamSSEMessage {
  /** The `event:` field, or null when the frame carried only data (OpenAI style). */
  event: string | null
  /** Joined `data:` lines of the frame (raw string — caller JSON-parses). */
  data: string
}

/** Parses one SSE frame's lines into a message; comments-only frames return null. */
function parseSSEFrame(frame: string): UpstreamSSEMessage | null {
  let event: string | null = null
  const data: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5))
    }
    // `id:`, `retry:` and `:` comments are ignored — providers don't need them
  }
  if (event === null && data.length === 0) return null
  return { event, data: data.join('\n') }
}

/**
 * Async-iterates the `data:`/`event:` frames of an upstream SSE body (an AI
 * provider's streaming response). Handles chunk boundaries that split frames
 * and CRLF line endings. Cancels the body reader on early exit so the upstream
 * connection is released.
 */
export async function* parseUpstreamSSE(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<UpstreamSSEMessage, void, unknown> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const msg = parseSSEFrame(frame)
        if (msg) yield msg
      }
    }
    // A trailing frame without the final blank line still counts
    const rest = parseSSEFrame(buffer)
    if (rest) yield rest
  } finally {
    try { await reader.cancel() } catch { /* upstream already closed */ }
  }
}
