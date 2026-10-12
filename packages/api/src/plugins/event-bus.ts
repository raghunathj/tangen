/**
 * File Name: event-bus.ts
 * Purpose: Wraps the process-level EventBus singleton in an Elysia plugin so that
 *          route handlers can access it via the `eventBus` context property.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on the EventBus singleton from services/event-bus.ts;
 *                     the plugin uses a fixed name ('event-bus') to enable Elysia's
 *                     singleton deduplication.
 */
import Elysia from 'elysia'
import { eventBus } from '../services/event-bus'

export const eventBusPlugin = new Elysia({ name: 'event-bus' })
  .decorate('eventBus', eventBus)
