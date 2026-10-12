/**
 * File Name: sse-client.ts
 * Purpose: Reads a streaming Server-Sent Events Response (AI token streams)
 *          as an async iterator of parsed events - the admin-side twin of the
 *          API's lib/sse. Used by the AI assistant panel and the Knowledge
 *          Ask tester.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: zero deps. Data fields are JSON-parsed (the platform
 *          always sends JSON payloads); frames that fail to parse are skipped.
 */

/** One parsed server event: name + JSON-decoded data payload. */
export interface AdminSSEEvent {
  event: string
  data: any
}

function parseFrame(frame: string): { event: string | null; data: string } | null {
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
 * Async-iterates the named events of an SSE Response body. Handles frames
 * split across network chunks and CRLF endings; heartbeat comments are
 * skipped. Cancels the reader on early exit (e.g. a thrown error) so the
 * connection is released.
 */
export async function* readSSEStream(res: Response): AsyncGenerator<AdminSSEEvent, void, unknown> {
  const body = res.body
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
        if (!frame?.event) continue
        try {
          yield { event: frame.event, data: JSON.parse(frame.data) }
        } catch { /* non-JSON frame - skip */ }
      }
    }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
}
