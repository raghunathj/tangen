/**
 * File Name: audit-log.ts
 * Purpose: Subscribes to all event bus events and writes an audit log entry to the database
 *          for every event, providing a complete immutable history of mutations in the system.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @tangen/db (auditLog table), EventBus
 */

import { randomUUID } from 'node:crypto'
import { auditLog } from '@tangen/db'
import type { DbClient } from '@tangen/db'
import type { EventBus } from '../services/event-bus'

/**
 * Registers a wildcard event bus listener that persists every event as an audit log record.
 * @param bus - The application event bus to subscribe to
 * @param db - The database client used to insert audit log rows
 */
export function registerAuditLogSubscriber(bus: EventBus, db: DbClient): void {
  bus.on('*', async (event) => {
    // K5: a domain operation that wrote its own record in its transaction
    // marks the event; this best-effort copy is for the writers that have
    // not moved onto the kernel yet.
    if ((event as { recorded?: boolean }).recorded === true) return
    await db.insert(auditLog).values({
      id: randomUUID(),
      workspaceId: event.workspaceId,
      eventType: event.type,
      eventId: event.id,
      payload: (event as any).payload ?? {},
    })
  })
}
