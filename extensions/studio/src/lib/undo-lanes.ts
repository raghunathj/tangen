/**
 * File Name: undo-lanes.ts
 * Purpose: One undo order across the two history stacks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Block edits and style edits cannot share a stack - one
 *          is a tree snapshot replayed into local state, the other a PATCH to
 *          a class row on the server. But a designer does not think in
 *          stacks: Cmd+Z means "undo the last thing I did". This is the thin
 *          record of WHICH stack each step belongs to, so the two unwind in
 *          the order the steps were actually made.
 *
 *          It stores lanes, never the edits themselves - each stack remains
 *          the authority on its own contents.
 */

/**
 * `locale` is the overlay draft edited while translating: a snapshot stack
 * like the block tree's, but over ONE locale's translations, kept apart so a
 * French edit never lands in the shared tree's history.
 */
export type Lane = 'block' | 'style' | 'locale'

export interface LaneOrder {
  past: Lane[]
  future: Lane[]
}

export function emptyLanes(): LaneOrder {
  return { past: [], future: [] }
}

/**
 * Notes that a lane was edited.
 *
 * `deepened` is false when the edit MERGED into the previous entry (a slider
 * drag, a burst of typing). That is still a new edit - so it abandons redo -
 * but it is not a new step, so it must not cost an extra Cmd+Z.
 */
export function recordLane(o: LaneOrder, lane: Lane, deepened: boolean): LaneOrder {
  return {
    past: deepened ? [...o.past, lane] : o.past,
    future: [],
  }
}

/**
 * Forgets every step of one lane. Used when that lane's stack is emptied
 * on its own - the locale stack, on a language switch - so Cmd+Z does not
 * spend a press on a stack with nothing in it. Same object when nothing
 * changes, so React skips the render.
 */
export function dropLane(o: LaneOrder, lane: Lane): LaneOrder {
  if (!o.past.includes(lane) && !o.future.includes(lane)) return o
  return { past: o.past.filter((l) => l !== lane), future: o.future.filter((l) => l !== lane) }
}

/** Which stack the next undo belongs to, or null at the beginning. */
export function nextUndoLane(o: LaneOrder): Lane | null {
  return o.past.length > 0 ? o.past[o.past.length - 1] : null
}

/** Which stack the next redo belongs to, or null at the end. */
export function nextRedoLane(o: LaneOrder): Lane | null {
  return o.future.length > 0 ? o.future[0] : null
}

/** Moves one step back. Call only after the lane's own stack has undone. */
export function commitUndo(o: LaneOrder): LaneOrder {
  if (o.past.length === 0) return o
  const past = [...o.past]
  const lane = past.pop() as Lane
  return { past, future: [lane, ...o.future] }
}

/** Moves one step forward. Call only after the lane's own stack has redone. */
export function commitRedo(o: LaneOrder): LaneOrder {
  if (o.future.length === 0) return o
  const [lane, ...future] = o.future
  return { past: [...o.past, lane], future }
}
