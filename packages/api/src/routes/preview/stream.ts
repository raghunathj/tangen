/**
 * File Name: stream.ts
 * Purpose: Elysia route plugin for GET /api/v1/preview/stream, establishing a long-lived Server-Sent Events
 *          connection that pushes real-time object change notifications to preview frontends.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires sseManager to register/remove connections; emits heartbeat pings every 30 s
 *                     to keep the connection alive through proxies. SSE frame
 *                     formatting lives in lib/sse (shared with AI streaming).
 */
import { randomBytes } from 'node:crypto'
import { Elysia } from 'elysia'
import type { TangenEvent } from '@tangen/types'
import { sseManager } from '../../services/sse-manager'
import { formatSSEEvent, formatSSEComment } from '../../lib/sse'

// Re-exported so existing consumers (sse-broadcaster, tests) keep their import path
export { formatSSEEvent, formatSSEComment }

// ─── Payload extraction ────────────────────────────────────────────────────────

export interface SsePayload {
  event: string
  data: Record<string, unknown>
}

/**
 * Maps a TangenEvent to an SSE payload, extracting only the fields relevant to preview frontends.
 * @param event - Internal TangenEvent emitted by the event bus
 * @returns SsePayload to push to connected clients, or null if the event type is not streamed
 */
export function buildSSEPayload(event: TangenEvent): SsePayload | null {
  switch (event.type) {
    case 'object.updated':
      return {
        event: 'object.updated',
        data: {
          objectId: event.payload.objectId,
          typeSlug: event.payload.typeSlug,
          changedFields: event.payload.changedFields,
        },
      }
    case 'object.published':
      return {
        event: 'object.published',
        data: {
          objectId: event.payload.objectId,
          typeSlug: event.payload.typeSlug,
        },
      }
    case 'object.unpublished':
      return {
        event: 'object.unpublished',
        data: {
          objectId: event.payload.objectId,
          typeSlug: event.payload.typeSlug,
        },
      }
    default:
      return null
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Elysia plugin providing GET /api/v1/preview/stream as a persistent SSE connection for real-time preview updates.
 * @returns Elysia plugin function
 */
export const previewStreamRoute = (app: Elysia) =>
  app.get('/api/v1/preview/stream', (ctx: any) => {
    const { workspaceId } = ctx
    const connId = `${workspaceId}:${randomBytes(8).toString('hex')}`

    let heartbeatTimer: ReturnType<typeof setInterval>

    const stream = new ReadableStream<string>({
      start(controller) {
        // Send initial connection confirmation
        controller.enqueue(formatSSEComment('connected'))

        sseManager.add(connId, workspaceId, controller)

        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(formatSSEComment('ping'))
          } catch {
            clearInterval(heartbeatTimer)
          }
        }, HEARTBEAT_INTERVAL_MS)
      },
      cancel() {
        clearInterval(heartbeatTimer)
        sseManager.remove(connId)
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
  })
