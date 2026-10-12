/**
 * File Name: fetch-event-source.ts
 * Purpose: An EventSource built on fetch, for runtimes that have none
 *          (Bun, Node, workers) and for callers that need headers or a
 *          custom fetch on the stream.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The SSE fallback is only automatic if there is an
 *          EventSource to fall back to. Browsers have one; Bun and Node do
 *          not. This is the subset the client's SSE adapter uses: named
 *          event listeners, onopen, onerror, close(), and the browser's own
 *          reconnect behaviour - retry after the server's `retry:` delay,
 *          resending the last `id:` as Last-Event-ID - because that is
 *          what makes a cursor survive a dropped stream. Not a full
 *          EventSource: no readyState constants, no `message` default
 *          dispatch beyond what the listeners ask for.
 */
import type { EventSourceCtor, EventSourceLike } from './transports'

type Listener = (ev: { data: string; lastEventId?: string }) => void

export interface FetchEventSourceOptions {
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Extra headers on every stream request. */
  headers?: Record<string, string>
  /** Initial retry delay before the server says otherwise. Default 3000 ms. */
  retryMs?: number
}

/** Returns an EventSource constructor backed by fetch. */
export function createFetchEventSource(opts: FetchEventSourceOptions = {}): EventSourceCtor {
  const fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a))

  return class FetchEventSource implements EventSourceLike {
    onerror: ((ev: unknown) => void) | null = null
    onopen: ((ev: unknown) => void) | null = null
    private readonly listeners = new Map<string, Listener[]>()
    private abort = new AbortController()
    private closed = false
    private lastEventId = ''
    private retryMs = opts.retryMs ?? 3000
    private timer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly url: string) {
      void this.run()
    }

    addEventListener(type: string, listener: Listener): void {
      const l = this.listeners.get(type) ?? []
      l.push(listener)
      this.listeners.set(type, l)
    }

    close(): void {
      this.closed = true
      if (this.timer) { clearTimeout(this.timer); this.timer = null }
      this.abort.abort()
    }

    private dispatch(event: string, data: string): void {
      for (const fn of this.listeners.get(event) ?? []) {
        try { fn({ data, lastEventId: this.lastEventId }) } catch { /* a listener never breaks the stream */ }
      }
    }

    private async run(): Promise<void> {
      while (!this.closed) {
        this.abort = new AbortController()
        let opened = false
        try {
          const headers: Record<string, string> = { Accept: 'text/event-stream', ...(opts.headers ?? {}) }
          if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId
          const res = await fetchFn(this.url, { headers, signal: this.abort.signal })
          if (!res.ok || !res.body) throw new Error(`stream refused (${res.status})`)
          opened = true
          this.onopen?.({})
          await this.read(res.body)
        } catch {
          if (this.closed) return
          this.onerror?.({})
          if (!opened) return          // a refusal before any open is final, like the browser's CLOSED
        }
        if (this.closed) return
        this.onerror?.({})
        await new Promise<void>((resolve) => { this.timer = setTimeout(() => { this.timer = null; resolve() }, this.retryMs) })
      }
    }

    private async read(body: ReadableStream<Uint8Array>): Promise<void> {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) return
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep)
            buffer = buffer.slice(sep + 2)
            this.frame(frame)
          }
        }
      } finally {
        try { await reader.cancel() } catch { /* gone */ }
      }
    }

    private frame(frame: string): void {
      let event = 'message'
      const data: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5))
        else if (line.startsWith('id:')) this.lastEventId = line.slice(3).trim()
        else if (line.startsWith('retry:')) { const n = Number(line.slice(6).trim()); if (Number.isFinite(n) && n >= 0) this.retryMs = n }
      }
      if (data.length) this.dispatch(event, data.join('\n'))
    }
  }
}
