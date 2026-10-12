/**
 * File Name: sse.ts
 * Purpose: Minimal client-side Server-Sent Events parsing for the SDK's
 *          streaming endpoints (knowledge.askStream). Iterates the
 *          event/data frames of a fetch Response body.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: zero deps; works in browsers, Bun, Node 18+, and Edge
 *          runtimes (anything with web-standard ReadableStream).
 */

/** One parsed SSE frame: the event name (if any) and the raw data string. */
export interface SSEFrame {
  event: string | null
  data: string
}

function parseFrame(frame: string): SSEFrame | null {
  let event: string | null = null
  const data: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5))
  }
  if (event === null && data.length === 0) return null
  return { event, data: data.join('\n') }
}

/**
 * Async-iterates the SSE frames of a streaming Response body, handling frames
 * split across chunk boundaries and CRLF line endings. Cancels the body reader
 * on early exit so the connection is released.
 */
export async function* readSSEFrames(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<SSEFrame, void, unknown> {
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
        const frame = parseFrame(buffer.slice(0, sep))
        buffer = buffer.slice(sep + 2)
        if (frame) yield frame
      }
    }
    const rest = parseFrame(buffer)
    if (rest) yield rest
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
}
