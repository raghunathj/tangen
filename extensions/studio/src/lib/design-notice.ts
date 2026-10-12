/**
 * File Name: design-notice.ts
 * Purpose: The Style panel's "changed elsewhere" notice - which design-change
 *          envelopes are someone else's, how they are kept, which of them the
 *          selected block is told about, and the sentence it reads.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The server announces `studio.class.changed` and
 *          `studio.tag.changed` on every write (server.ts), and the realtime
 *          bridge fans them to `studio:<objectId>` and `studio:classes`. A
 *          class is shared, so two designers can hold the same row; the
 *          stale-write guard refuses the second save, which is right and
 *          late. This is the early half: "Priya changed .card a moment ago"
 *          beside the class, while the designer can still decide to reload
 *          before building on a row that has moved.
 *
 *          Advisory only. Nothing here reloads for the designer or blocks a
 *          save - the guard stays the integrity mechanism, the way the object
 *          editor's ChangedElsewhereNotice leaves it.
 *
 *          "Is this my own write?" is NOT decided here. It is `isOwnWrite`
 *          in @tangen/realtime (own-write.ts), the one rule the object
 *          editor and the Variables panel also use. It used to be decided
 *          here, by comparing the envelope's actor to the signed-in member -
 *          which said "somebody else changed .card" for the designer's own
 *          save whenever the member id had not loaded or the server had not
 *          named the actor. That was the third copy of the same mistake; the
 *          rule now has one home and one test.
 *
 *          Pure, so the wording is testable without a render and the panel
 *          can stay a renderer of what it is handed.
 *
 *          Realtime R5 added `actorName` to the `studio.*.changed` envelopes,
 *          resolved once on the server. It is preferred over the page's
 *          presence map because presence knows only the people on THIS
 *          page, and a class is changed from any page - a colleague editing
 *          the library from elsewhere used to read as "Someone".
 */

import { isOwnWrite, type OwnWriteContext } from '@tangen/realtime'

/** One design change heard on the bus, as the panel keeps it. */
export interface DesignNotice {
  kind: 'class' | 'tag'
  /** The class name, or the tag. */
  name: string
  /** The row's version token after the write - what a reload would fetch. */
  rev: string
  actorId: string | null
  /**
   * The actor's display name as the envelope carried it (Realtime R5
   * resolves it once, server-side). Null when the envelope had none; the
   * presence map is the next source, then "Someone".
   */
  actorName: string | null
  /** Server time of the envelope (ms). */
  t: number
}

const DESIGN_TYPES: Record<string, DesignNotice['kind']> = {
  'studio.class.changed': 'class',
  'studio.tag.changed': 'tag',
}

/** How many notices the panel remembers; older ones are of no use. */
export const MAX_DESIGN_NOTICES = 20

interface EnvelopeLike { type: string; data: Record<string, unknown>; t: number }

export interface DesignNoticeContext extends OwnWriteContext {
  /** The signed-in member, when the page has one; the origin decides without it. */
  currentMemberId?: string | null
  /** Epoch ms of a design write this panel issued; its echo is never elsewhere. */
  saveIssuedAt?: number | null
}

/**
 * True when the envelope is a class or tag change this client did not issue.
 * Other envelopes on the same topic (the publish lifecycle) are not style
 * changes and are left alone.
 */
export function isDesignChangeElsewhere(event: EnvelopeLike, ctx: DesignNoticeContext): boolean {
  if (!DESIGN_TYPES[event.type]) return false
  if (typeof event.data.name !== 'string' || event.data.name === '') return false
  return !isOwnWrite(event, ctx)
}

/** The notice an envelope becomes. Call after `isDesignChangeElsewhere`. */
export function noticeFromEvent(event: EnvelopeLike): DesignNotice {
  const rev = event.data.rev
  return {
    kind: DESIGN_TYPES[event.type] ?? 'class',
    name: String(event.data.name),
    rev: typeof rev === 'string' ? rev : typeof rev === 'number' ? String(rev) : '',
    actorId: typeof event.data.actorId === 'string' && event.data.actorId !== '' ? event.data.actorId : null,
    actorName: typeof event.data.actorName === 'string' && event.data.actorName.trim() !== '' ? event.data.actorName.trim() : null,
    t: event.t,
  }
}

/**
 * Adds a notice, keeping ONE per kind and name (the newest) and the list
 * newest first, capped. Returns a new array; the input is not touched.
 */
export function recordDesignChange(list: readonly DesignNotice[], next: DesignNotice): DesignNotice[] {
  const rest = list.filter((n) => !(n.kind === next.kind && n.name === next.name))
  return [next, ...rest].slice(0, MAX_DESIGN_NOTICES)
}

export interface BlockScope {
  /** Classes the selected block wears. */
  worn: readonly string[]
  /** The class the next edit would land on, when it is not worn yet. */
  pending: string | null
  /** Tags this block can set a site-wide default for. */
  tags: readonly string[]
  /**
   * The rev the editor currently holds per class or tag name. A notice whose
   * rev the editor already has was reloaded past, and is not repeated.
   */
  heldRevs?: Record<string, string | undefined>
}

/** The notices the selected block should hear about, newest first. */
export function noticesForBlock(list: readonly DesignNotice[], scope: BlockScope): DesignNotice[] {
  const classes = new Set([...scope.worn, ...(scope.pending ? [scope.pending] : [])])
  const tags = new Set(scope.tags)
  return list.filter((n) => {
    const relevant = n.kind === 'class' ? classes.has(n.name) : tags.has(n.name)
    if (!relevant) return false
    const held = scope.heldRevs?.[n.name]
    return !(held && n.rev && held === n.rev)
  })
}

/** "a moment ago", "3 minutes ago", "2 hours ago". A clock behind the server still reads as a moment. */
export function relativeAge(t: number, now: number): string {
  const ms = Math.max(0, now - t)
  if (ms < 60_000) return 'a moment ago'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}

/**
 * "Priya changed .card a moment ago" / "Someone changed the h1 default 5
 * minutes ago". The envelope's own name comes first: presence only knows the
 * people on THIS page, and a class is changed from any page.
 */
export function formatDesignNotice(n: DesignNotice, ctx: { names: ReadonlyMap<string, string>; now: number }): string {
  const who = n.actorName || (n.actorId && ctx.names.get(n.actorId)) || 'Someone'
  const what = n.kind === 'class' ? `.${n.name}` : `the ${n.name} default`
  return `${who} changed ${what} ${relativeAge(n.t, ctx.now)}`
}
