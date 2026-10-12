/**
 * File Name: presence-claim.ts
 * Purpose: The advisory editing claim as a pure function - who holds it,
 *          and where it goes after a join, a state change, a take-over, a
 *          leave or an expiry.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R3 of tasks/plan-realtime.md (section 4.5: "the first
 *          member to join an object scope holds the advisory claim; the
 *          claim moves on explicit take-over or on the holder's expiry")
 *          and the architecture's section 22: advisory first, never a hard
 *          lock. The claim says who should be editing; the server's
 *          stale-write guard stays the integrity mechanism, so nothing here
 *          refuses anything - a second editor is TOLD, and may take over.
 *
 *          The claim is not a separate record. It is derived from the
 *          sessions: the editing session with the earliest `claimedAt`
 *          holds it (ties by session id, so two processes derive the same
 *          answer from the same rows). reconcile() decides what
 *          `claimedAt` every session should carry after a change and
 *          returns the writes, so the service stays a thin caller and the
 *          rules live in one tested place:
 *
 *          1. A take-over by an editing session moves the claim to it.
 *          2. Otherwise a holder that is still present and still editing
 *             keeps it.
 *          3. Otherwise the earliest editing session (by when it started
 *             editing, then by id) takes it; nobody editing means no claim.
 *
 *          A race between two processes is benign: both derive from what
 *          the store holds, the later write wins, and the worst case is one
 *          wrong advisory banner for one heartbeat.
 */
import type { PresenceState } from './presence-store'

/** What the claim needs of a session. PresenceSession satisfies it. */
export interface ClaimSession {
  id: string
  memberId: string | null
  apiKeyId: string | null
  name: string
  state: PresenceState
  editingSince: number | null
  claimedAt: number | null
}

/** Who holds the claim, as clients see it. */
export interface ClaimRecord {
  /** The holding session (connection id). */
  session: string
  memberId: string | null
  apiKeyId: string | null
  name: string
  /** When the claim was taken. */
  since: number
}

export interface ClaimWrite {
  id: string
  claimedAt: number | null
}

export interface ClaimOutcome {
  claim: ClaimRecord | null
  /** The previous holder, when the claim moved to another session. */
  movedFrom: ClaimRecord | null
  /** The `claimedAt` every session should carry now; only the changes are listed. */
  writes: ClaimWrite[]
}

const byEditingStart = (a: ClaimSession, b: ClaimSession): number =>
  (a.editingSince ?? Infinity) - (b.editingSince ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const record = (s: ClaimSession, since: number): ClaimRecord =>
  ({ session: s.id, memberId: s.memberId, apiKeyId: s.apiKeyId, name: s.name, since })

/** The current holder: the editing session with the earliest claimedAt, ties by id. */
export function holderOf(sessions: ReadonlyArray<ClaimSession>): ClaimRecord | null {
  let best: ClaimSession | null = null
  for (const s of sessions) {
    if (s.state !== 'editing' || s.claimedAt === null) continue
    if (!best || s.claimedAt < best.claimedAt! || (s.claimedAt === best.claimedAt && s.id < best.id)) best = s
  }
  return best ? record(best, best.claimedAt!) : null
}

/**
 * Where the claim goes after a change.
 * @param before - The sessions as they were (to know the previous holder).
 * @param after - The sessions as they are now: the changed one updated, the gone ones absent.
 * @param opts.takeoverBy - The session asking to take over; honoured only when it is editing.
 * @param now - The claim's `since` when it moves.
 */
export function reconcileClaim(
  before: ReadonlyArray<ClaimSession>,
  after: ReadonlyArray<ClaimSession>,
  opts: { takeoverBy?: string | null } = {},
  now: number = Date.now(),
): ClaimOutcome {
  const previous = holderOf(before)
  const taker = opts.takeoverBy ? after.find((s) => s.id === opts.takeoverBy && s.state === 'editing') ?? null : null
  const stillHeld = previous ? after.find((s) => s.id === previous.session && s.state === 'editing') ?? null : null

  let holder: ClaimSession | null
  let since: number
  if (taker && (!previous || previous.session !== taker.id)) {
    holder = taker
    since = now
  } else if (stillHeld) {
    holder = stillHeld
    since = previous!.since
  } else {
    holder = [...after].filter((s) => s.state === 'editing').sort(byEditingStart)[0] ?? null
    since = now
  }

  const writes: ClaimWrite[] = []
  for (const s of after) {
    const want = holder && s.id === holder.id ? since : null
    if (s.claimedAt !== want) writes.push({ id: s.id, claimedAt: want })
  }
  const claim = holder ? record(holder, since) : null
  const movedFrom = previous && claim?.session !== previous.session ? previous : null
  return { claim, movedFrom, writes }
}
