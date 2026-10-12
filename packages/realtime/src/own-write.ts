/**
 * File Name: own-write.ts
 * Purpose: The ONE rule for "was this envelope my own write coming back?" -
 *          the origin a connection stamps on the writes it issues, the
 *          registry of origins this client has held, and the single
 *          predicate every "changed elsewhere" notice is built on.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This question was answered separately three times and
 *          got it wrong three times - the object editor's conflict notice,
 *          the Studio Variables panel and the Studio Style panel each told a
 *          designer that their own save was somebody else's. Every fix was
 *          local, so the next event type started from zero. This module is
 *          the fix that does not have a fourth chance: one rule, one export,
 *          used by all of them.
 *
 *          The rule is deterministic where it can be. A realtime connection
 *          is told its own `connectionId` in the server's `ready` message
 *          (protocol.ts). The client remembers it, the admin/Studio fetch
 *          helpers send it as `X-Tangen-Origin` on every write, the API
 *          carries it on the request context onto the bus event, and the
 *          realtime bridge stamps it on the envelope beside `actorId`. A
 *          client can then say "I issued this" without knowing who it is
 *          logged in as and without comparing clocks.
 *
 *          The fallbacks are what the old local rules were, kept for
 *          envelopes that predate the origin or were issued before a
 *          connection existed: an echo within the window of a write this
 *          surface issued, then the actor being the signed-in member. The
 *          last resort stays conservative - an envelope with no origin, no
 *          actor and no member id counts as elsewhere, because one notice
 *          too many beats a missed conflict. An OWN write must never reach
 *          that path: it carries an origin.
 *
 *          Origins are remembered, not just the current one: a write issued
 *          just before a reconnect comes back stamped with the connection
 *          id that is now gone.
 */

/** The request header a write carries so its echo can be recognised. */
export const WRITE_ORIGIN_HEADER = 'X-Tangen-Origin'

/** How many connection ids this tab remembers as its own. */
export const MAX_REMEMBERED_ORIGINS = 8

/**
 * What an origin may look like on the wire. The server echoes it into an
 * envelope every subscriber of the channel receives, so it is bounded and
 * shaped rather than trusted: an id, not a message.
 */
const ORIGIN_RE = /^[A-Za-z0-9._:-]{1,64}$/

/** Newest first; index 0 is the current connection. */
let remembered: string[] = []

/**
 * Records the connection id the server named on `ready` as this client's
 * own. Called by the realtime client; safe to call repeatedly.
 * @param id - The connection id; empty or absent is ignored.
 */
export function rememberOrigin(id: string | null | undefined): void {
  if (typeof id !== 'string' || id === '' || !ORIGIN_RE.test(id)) return
  remembered = [id, ...remembered.filter((o) => o !== id)].slice(0, MAX_REMEMBERED_ORIGINS)
}

/** The origin a write issued now should carry; null before any connection opened. */
export function currentOrigin(): string | null {
  return remembered[0] ?? null
}

/** Every origin this client has held, newest first. */
export function knownOrigins(): readonly string[] {
  return remembered
}

/** Drops the registry. For tests and for a sign-out. */
export function forgetOrigins(): void {
  remembered = []
}

/**
 * Whether an origin is one this client has held.
 * @param origin - The envelope's origin.
 * @param known - Overrides the registry (tests, and any non-browser caller).
 */
export function isOwnOrigin(origin: string | null | undefined, known?: readonly string[]): boolean {
  if (typeof origin !== 'string' || origin === '') return false
  return (known ?? remembered).includes(origin)
}

/** One envelope, as much of it as the rule reads. */
export interface OwnWriteEvent {
  data?: Record<string, unknown>
  /** Server time of the envelope (ms). */
  t?: number
}

/** The origin the bridge stamped on an envelope, or null. */
export function originOf(event: OwnWriteEvent): string | null {
  const raw = event.data?.origin
  return typeof raw === 'string' && raw !== '' ? raw : null
}

/** The actor the envelope names, or null (an empty string is not an actor). */
export function actorOf(event: OwnWriteEvent): string | null {
  const raw = event.data?.actorId
  return typeof raw === 'string' && raw !== '' ? raw : null
}

export interface OwnWriteContext {
  /** The signed-in member, when the surface knows it. */
  currentMemberId?: string | null
  /** Epoch ms of the write this surface last ISSUED; its echo can outrun the HTTP response. */
  saveIssuedAt?: number | null
  /** How far an echo may sit from that issue and still be it. Default 2000. */
  ownSaveWindowMs?: number
  /** Overrides the origin registry (tests, non-browser callers). */
  origins?: readonly string[]
}

/**
 * Why the rule decided what it did. Callers that need more than a yes or no
 * (the object editor separates "another tab of mine" from "somebody else")
 * read this rather than re-deriving it.
 *
 * - `origin`: the envelope names an origin this client has held. Certainly mine.
 * - `foreign-origin`: it names an origin, and it is not one of mine. Certainly not.
 * - `issued`: no origin, but it landed in the window of a write this surface issued.
 * - `actor`: no origin, but the actor is the signed-in member (here, or another tab).
 * - `other`: no origin, and the actor is somebody else.
 * - `unknown`: no origin, and nothing to judge the actor by. Treated as elsewhere.
 */
export type OwnWriteVerdict = 'origin' | 'foreign-origin' | 'issued' | 'actor' | 'other' | 'unknown'

/** The default window for the `issued` fallback. */
export const OWN_SAVE_WINDOW_MS = 2000

/**
 * The one rule, with its reasoning. Every "changed elsewhere" notice in the
 * admin, in Studio and in an extension goes through this.
 * @param event - The envelope, or anything carrying its `data` and `t`.
 * @param ctx - What the surface knows about itself.
 */
export function ownWriteVerdict(event: OwnWriteEvent, ctx: OwnWriteContext = {}): OwnWriteVerdict {
  const origin = originOf(event)
  // The origin is decisive in BOTH directions: it is the only signal that
  // does not depend on a member id being loaded or on two clocks agreeing.
  if (origin) return isOwnOrigin(origin, ctx.origins) ? 'origin' : 'foreign-origin'
  const window = ctx.ownSaveWindowMs ?? OWN_SAVE_WINDOW_MS
  const issuedAt = ctx.saveIssuedAt
  if (issuedAt !== undefined && issuedAt !== null && typeof event.t === 'number' && Math.abs(event.t - issuedAt) <= window) {
    return 'issued'
  }
  const actor = actorOf(event)
  if (!actor || !ctx.currentMemberId) return 'unknown'
  return actor === ctx.currentMemberId ? 'actor' : 'other'
}

/**
 * True when this client issued the write the envelope reports. The
 * conservative default is false: an envelope nothing can be told about
 * counts as somebody else's, because one notice too many beats a missed
 * conflict.
 */
export function isOwnWrite(event: OwnWriteEvent, ctx: OwnWriteContext = {}): boolean {
  const verdict = ownWriteVerdict(event, ctx)
  return verdict === 'origin' || verdict === 'issued' || verdict === 'actor'
}
