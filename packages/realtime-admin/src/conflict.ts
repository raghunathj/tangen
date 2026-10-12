/**
 * File Name: conflict.ts
 * Purpose: The conflict indicator's decision - was this object envelope a
 *          change made elsewhere, or my own save coming back?
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R2 of tasks/plan-realtime.md (the object editor's
 *          "changed elsewhere - reload" notice) and the architecture's
 *          section 54, which puts conflict indicators in this package.
 *          Pure on purpose, so the editor's hook is a one-liner and the
 *          rule is tested as a function: an envelope about THIS object,
 *          of a kind that changes it, that this client did not issue.
 *
 *          "Did this client issue it" is NOT decided here any more. It is
 *          `ownWriteVerdict` in @tangen/realtime (own-write.ts) - the one
 *          rule every notice in the admin and in Studio shares, because
 *          three separate copies of it each told somebody that their own
 *          save was a colleague's. What stays here is the part that really
 *          is about an object editor: an envelope carrying MY member id but
 *          not MY connection is another tab or device of mine, and whether
 *          that deserves a notice depends on whether it sits near a save
 *          this editor knows about.
 *
 *          An envelope nothing can be told about still counts as elsewhere,
 *          because the safe mistake is one reload too many. Advisory only:
 *          the server's stale-write guard stays the integrity mechanism
 *          (architecture section 22).
 */
import { ownWriteVerdict, type RealtimeEvent } from '@tangen/realtime'

/** Event types that change an existing object in a way an open editor should hear about. */
export const OBJECT_CHANGE_TYPES: ReadonlySet<string> = new Set([
  'object.updated', 'object.published', 'object.unpublished', 'object.deleted', 'object.scheduled',
  'publish.completed',
])

export interface ChangedElsewhereContext {
  /** The object the editor has open. */
  objectId: string
  /** The signed-in member; null for an unknown identity (every change is then "elsewhere"). */
  currentMemberId: string | null
  /** When the editor last saved this object (server `updatedAt`), as epoch ms; null when unknown. */
  lastSavedAt?: number | null
  /** How far an own-actor event may sit from the last save and still be "my save coming back". Default 2000. */
  ownSaveWindowMs?: number
  /**
   * When the editor last ISSUED a save (epoch ms). The socket delivers the
   * echo of a save before its HTTP response updates `lastSavedAt`, so judged
   * against the previous save alone every own save read as "another tab".
   * A fallback now: a write issued while connected carries this tab's origin
   * and needs no timing at all.
   */
  saveIssuedAt?: number | null
  /** Overrides the connection-origin registry. Tests and non-browser callers only. */
  origins?: readonly string[]
}

/**
 * True when the envelope means someone else (or another session of mine)
 * changed the object the editor holds.
 * @param event - An envelope from `object:<id>` (or `objects:<type>`).
 * @param ctx - The editor's identity and last save.
 */
export function isChangedElsewhere(event: Pick<RealtimeEvent, 'type' | 'data' | 't'>, ctx: ChangedElsewhereContext): boolean {
  if (!OBJECT_CHANGE_TYPES.has(event.type)) return false
  if (event.data.objectId !== ctx.objectId) return false
  const window = ctx.ownSaveWindowMs ?? 2000
  const verdict = ownWriteVerdict(event, {
    currentMemberId: ctx.currentMemberId,
    saveIssuedAt: ctx.saveIssuedAt,
    ownSaveWindowMs: window,
    origins: ctx.origins,
  })
  switch (verdict) {
    // This connection issued it, or the echo of the save this editor just
    // sent outran its HTTP response. Mine either way.
    case 'origin':
    case 'issued':
      return false
    // My member id, but not this connection: another tab or device of mine.
    // My save coming back unless it sits near neither save this editor knows.
    case 'actor':
      if (ctx.lastSavedAt === undefined || ctx.lastSavedAt === null) return false
      return Math.abs(event.t - ctx.lastSavedAt) > window
    // Somebody else's connection, somebody else's actor, or nothing to go on.
    default:
      return true
  }
}

/** Whether the change came from the signed-in member's other tab or device. */
export function isOwnActor(event: Pick<RealtimeEvent, 'data'>, currentMemberId: string | null): boolean {
  return !!currentMemberId && event.data.actorId === currentMemberId
}

/** Copy for the notice, by what happened and by whom. */
export function changedElsewhereLabel(type: string, opts: { ownActor?: boolean } = {}): string {
  if (opts.ownActor) {
    switch (type) {
      case 'object.published': return 'You published this item from another tab or device.'
      case 'object.unpublished': return 'You unpublished this item from another tab or device.'
      case 'object.deleted': return 'You deleted this item from another tab or device.'
      default: return 'You changed this item from another tab or device.'
    }
  }
  switch (type) {
    case 'object.published': return 'This item was published elsewhere.'
    case 'object.unpublished': return 'This item was unpublished elsewhere.'
    case 'object.deleted': return 'This item was deleted elsewhere.'
    case 'object.scheduled': return 'This item was scheduled elsewhere.'
    case 'publish.completed': return 'This item was published from Studio.'
    default: return 'This item was changed elsewhere.'
  }
}
