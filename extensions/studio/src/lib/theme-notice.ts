/**
 * File Name: theme-notice.ts
 * Purpose: The Variables panel's "changed elsewhere" notice - which
 *          `studio.theme.changed` envelopes are someone else's, how they are
 *          kept, and the sentence the panel reads ("Priya changed bg-brand,
 *          reload to see it").
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The theme routes announce `studio.theme.changed` on
 *          every token or font write (server.ts), and the realtime bridge
 *          fans it to `studio:classes`, the topic the page editor already
 *          holds. A token is workspace-wide, so two designers can hold the
 *          same row; the stale-write guard refuses the second save, which is
 *          right and late. This is the early half, the way design-notice.ts
 *          is for a class.
 *
 *          "Is this my own write?" is NOT decided here. It is `isOwnWrite`
 *          in @tangen/realtime (own-write.ts), shared with the object
 *          editor's conflict notice and the Style panel's. This panel was
 *          the second place to answer it locally and the second to get it
 *          wrong; the timing window it added lives on there as a fallback,
 *          behind the write origin that needs no timing at all. Advisory
 *          only: nothing here reloads for the designer; the guard stays the
 *          integrity mechanism.
 *
 *          Pure, so the wording is testable without a render and the panel
 *          can stay a renderer of what it is handed.
 */

import { isOwnWrite, OWN_SAVE_WINDOW_MS, type OwnWriteContext } from '@tangen/realtime'

/** The event type the theme routes emit. */
export const THEME_CHANGE_TYPE = 'studio.theme.changed'

/** One theme change heard on the bus, as the panel keeps it. */
export interface ThemeNotice {
  /** The entry as the tokens route lists it: `bg-brand`, or `font:Display`. */
  name: string
  /** The row's version token after the write; empty when the row was removed (a reset). */
  rev: string
  actorId: string | null
  /** The actor's display name as the envelope carried it (resolved server-side); null when it had none. */
  actorName: string | null
  /** Server time of the envelope (ms). */
  t: number
}

/** How many notices the panel remembers; older ones are of no use. */
export const MAX_THEME_NOTICES = 20

interface EnvelopeLike { type: string; data: Record<string, unknown>; t: number }

export interface ThemeNoticeContext extends OwnWriteContext {
  /** The signed-in member; the write origin decides without it. */
  currentMemberId: string | null
  /** Epoch ms of the write this panel last issued; its echo is never "elsewhere". */
  saveIssuedAt: number | null
}

/** How far an envelope may sit from a save this panel issued and still be its echo. */
export { OWN_SAVE_WINDOW_MS }

/**
 * True when the envelope is a theme change this client did not issue.
 */
export function isThemeChangeElsewhere(event: EnvelopeLike, ctx: ThemeNoticeContext): boolean {
  if (event.type !== THEME_CHANGE_TYPE) return false
  if (typeof event.data.name !== 'string' || event.data.name === '') return false
  return !isOwnWrite(event, ctx)
}

/** The notice an envelope becomes. Call after `isThemeChangeElsewhere`. */
export function themeNoticeFromEvent(event: EnvelopeLike): ThemeNotice {
  const rev = event.data.rev
  return {
    name: String(event.data.name),
    rev: typeof rev === 'string' ? rev : typeof rev === 'number' ? String(rev) : '',
    actorId: typeof event.data.actorId === 'string' && event.data.actorId !== '' ? event.data.actorId : null,
    actorName: typeof event.data.actorName === 'string' && event.data.actorName.trim() !== '' ? event.data.actorName.trim() : null,
    t: event.t,
  }
}

/**
 * Adds a notice, keeping ONE per entry name (the newest) and the list newest
 * first, capped. Returns a new array; the input is not touched.
 */
export function recordThemeChange(list: readonly ThemeNotice[], next: ThemeNotice): ThemeNotice[] {
  const rest = list.filter((n) => n.name !== next.name)
  return [next, ...rest].slice(0, MAX_THEME_NOTICES)
}

/** "Priya changed bg-brand, reload to see it" / "Someone reset the Display font, reload to see it". */
export function formatThemeNotice(n: ThemeNotice): string {
  const who = n.actorName || 'Someone'
  const what = n.name.startsWith('font:') ? `the ${n.name.slice('font:'.length)} font` : n.name
  const verb = n.rev === '' ? 'reset' : 'changed'
  return `${who} ${verb} ${what}, reload to see it`
}
