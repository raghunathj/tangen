/**
 * File Name: write-origin.ts
 * Purpose: The origin of a write - which client connection issued it -
 *          read off the request, carried on the request context, and put on
 *          the bus event so every realtime envelope it causes can name it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: docs/realtime.md ("Was this my own write?"). A tab
 *          that changes something hears its own change come back on the
 *          socket, and telling that echo from a colleague's write used to be
 *          guesswork: compare the actor to the signed-in member (wrong when
 *          the member is not loaded, or the actor is not named), or compare
 *          clocks (wrong when the socket outruns the HTTP response). Three
 *          separate notices got it wrong that way.
 *
 *          The deterministic answer already exists on the wire: the realtime
 *          server tells every connection its own `connectionId` in `ready`.
 *          The client sends it as X-Tangen-Origin on the writes it issues,
 *          this module puts it on the request context, EventBus.emit stamps
 *          it on the event, and the realtime bridge copies it onto every
 *          envelope beside `actorId`. One place in, one place out - no event
 *          type can forget it.
 *
 *          The header is a client-supplied string that is echoed to every
 *          subscriber of the channel, so it is shaped and bounded here
 *          rather than trusted. It carries no authority: it decides only
 *          whether a page shows itself a notice, never what anyone may read
 *          or write.
 *
 *          Stored on the Query Monitor / Gateway RequestEntry rather than on
 *          a second AsyncLocalStorage, for the reason gateway/request-
 *          context.ts gives: one store, one lifecycle.
 */
import type { TangenEvent } from '@tangen/types'
import { qmAls } from './query-monitor'

/** The request header a client stamps its writes with (lower-case: Headers.get is case-insensitive, our own reads are not). */
export const WRITE_ORIGIN_HEADER = 'x-tangen-origin'

/** The longest origin accepted. A connection id is short; anything longer is not one. */
export const MAX_WRITE_ORIGIN_LENGTH = 64

/** An id, and nothing that could be read as anything else. Mirrors ORIGIN_RE in packages/realtime/src/own-write.ts. */
const ORIGIN_RE = /^[A-Za-z0-9._:-]+$/

/**
 * The origin as it may be stored and echoed, or null.
 * @param raw - The header value.
 */
export function sanitizeWriteOrigin(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > MAX_WRITE_ORIGIN_LENGTH || !ORIGIN_RE.test(value)) return null
  return value
}

/** The origin a request names, or null. */
export function readWriteOrigin(headers: Headers | null | undefined): string | null {
  return sanitizeWriteOrigin(headers?.get(WRITE_ORIGIN_HEADER) ?? null)
}

/** The origin of the request currently executing, when one named an origin. */
export function currentWriteOrigin(): string | null {
  return qmAls.getStore()?.writeOrigin ?? null
}

/**
 * The event with its origin filled in. An event that already names one keeps
 * it (a background job replaying a write on someone's behalf), and a null
 * origin changes nothing. Never mutates the caller's event.
 * @param event - The event about to be emitted.
 * @param origin - The origin to stamp, usually currentWriteOrigin().
 */
export function withWriteOrigin<T extends TangenEvent>(event: T, origin: string | null): T {
  if (!origin) return event
  if (typeof (event as { origin?: unknown }).origin === 'string' && (event as { origin?: string }).origin) return event
  return { ...event, origin }
}
