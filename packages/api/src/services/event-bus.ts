/**
 * File Name: event-bus.ts
 * Purpose: In-process publish/subscribe event bus for broadcasting Tangen domain events
 *   to registered handlers, with wildcard subscription support and safe async error handling.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/types (TangenEvent), @tangen/logging.
 *
 *   Every event passes through emit(), which is why the WRITE ORIGIN is
 *   stamped here and nowhere else: one funnel in, one funnel out (the
 *   realtime bridge), so no event type can forget to say which client
 *   connection caused it. See lib/write-origin.ts and docs/realtime.md.
 */
import type { TangenEvent } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { currentWriteOrigin, withWriteOrigin } from '../lib/write-origin'

const logger = getLogger(['tangen', 'api', 'event-bus'])

type EventHandler<T extends TangenEvent = TangenEvent> = (event: T) => void | Promise<void>

/**
 * Lightweight in-process event bus that routes typed Tangen events to registered handlers.
 * Handlers that throw are caught and logged so one bad subscriber cannot affect others.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>()

  /**
   * Registers a handler for a specific event type or for all events via the wildcard '*'.
   * @param type - Event type string to subscribe to, or '*' to receive every event.
   * @param handler - Async-safe callback invoked when a matching event is emitted.
   * @returns An unsubscribe function that removes the handler when called.
   */
  on<T extends TangenEvent>(type: T['type'] | '*', handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  /**
   * Dispatches an event to all matching type-specific handlers and all wildcard handlers.
   * @param event - The Tangen domain event to broadcast.
   */
  emit(raw: TangenEvent): void {
    // The connection that issued the request this event came out of, when it
    // named itself. Stamped once, here, so every consumer sees it.
    const event = withWriteOrigin(raw, currentWriteOrigin())
    const safeCall = (h: EventHandler<any>) =>
      Promise.resolve(h(event)).catch(err => logger.error('EventBus handler error', err instanceof Error ? err : new Error(String(err))))
    this.handlers.get(event.type)?.forEach(safeCall)
    this.handlers.get('*')?.forEach(safeCall)
  }
}

/**
 * Shared singleton EventBus instance used across the API process.
 */
export const eventBus = new EventBus()
