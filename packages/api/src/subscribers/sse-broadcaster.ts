/**
 * File Name: sse-broadcaster.ts
 * Purpose: Bridges the internal event bus to connected SSE clients by formatting bus events
 *          as SSE messages and broadcasting them to the appropriate workspace/environment subscribers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: EventBus, SseConnectionManager, formatSSEEvent/buildSSEPayload from preview stream route
 */

import type { EventBus } from '../services/event-bus'
import type { SseConnectionManager } from '../services/sse-manager'
import { formatSSEEvent, buildSSEPayload } from '../routes/preview/stream'

/**
 * Registers a wildcard event bus listener that serializes each event to an SSE message and pushes it to all matching connected clients.
 * @param bus - The application event bus to subscribe to
 * @param manager - The SseConnectionManager used to broadcast to active connections
 */
export function registerSseBroadcastSubscriber(bus: EventBus, manager: SseConnectionManager): void {
  bus.on('*', (event) => {
    const payload = buildSSEPayload(event)
    if (!payload) return

    const message = formatSSEEvent(event.id, payload.event, payload.data)
    manager.broadcast(event.workspaceId, message)
  })
}
