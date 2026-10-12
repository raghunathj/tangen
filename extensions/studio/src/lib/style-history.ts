/**
 * File Name: style-history.ts
 * Purpose: Undo and redo for style edits, plus the guard that stops two
 *   designers silently overwriting one class.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Block history (history.ts) cannot cover styles. It
 *          stores whole-tree SNAPSHOTS and replays them into local state, but
 *          a style edit is a PATCH to a class row on the server - it never
 *          touches the tree. So Cmd+Z after restyling did nothing, or undid
 *          an unrelated block change, which is worse.
 *
 *          So this stack stores INVERSE OPERATIONS instead: each entry
 *          carries the props before and after, and undo is the same PATCH
 *          aimed backwards. That also keeps the stack small - a snapshot
 *          model would copy the whole class map on every slider frame.
 *
 *          Coalescing matters more here than for blocks: dragging a slider
 *          fires a change per frame, and without merging a single drag would
 *          cost fifty undos. Merging keeps the ORIGINAL `before`, so one undo
 *          returns to where the drag started.
 */

import type { AnyInteraction } from '@tangen/studio-schema'

/** Edits to the same target within this window merge into one entry. */
export const STYLE_COALESCE_MS = 600

/** Beyond this, the oldest steps are dropped. */
const MAX_DEPTH = 100

type Props = Record<string, unknown>

/** An edit to one class, identified by id because a class can be renamed. */
export interface ClassEdit {
  kind: 'class'
  id: string
  /** Carried for the message only - the PATCH is by id. */
  name?: string
  before: Props
  after: Props
}

/** An edit to a tag default ("all H2"), keyed by the tag itself. */
export interface TagEdit {
  kind: 'tag'
  tag: string
  before: Props
  after: Props
}

/**
 * Setting or removing a class's Interaction. Its own kind rather than a
 * property, because an interaction is a different shape from a property map
 * and the PATCH that restores it is a different field. Never coalesced: a
 * select has no drag to merge.
 */
export interface InteractionEdit {
  kind: 'interaction'
  id: string
  name?: string
  before: AnyInteraction | null
  after: AnyInteraction | null
}

export type StyleEdit = ClassEdit | TagEdit | InteractionEdit

/** What a caller must apply to move one step. */
export type StyleOp =
  | { kind: 'class'; id: string; name?: string; props: Props }
  | { kind: 'tag'; tag: string; props: Props }
  | { kind: 'interaction'; id: string; name?: string; interaction: AnyInteraction | null }

export interface StyleHistory {
  past: StyleEdit[]
  future: StyleEdit[]
  /** What the last entry was editing, for coalescing. */
  lastKey: string | null
  lastAt: number
}

export function emptyStyleHistory(): StyleHistory {
  return { past: [], future: [], lastKey: null, lastAt: 0 }
}

export const canUndoStyle = (h: StyleHistory): boolean => h.past.length > 0
export const canRedoStyle = (h: StyleHistory): boolean => h.future.length > 0

export interface PushStyleOptions {
  at: number
  /**
   * Identifies what is being edited (e.g. `class:${id}.${propertyId}`).
   * Present means "this may merge with the previous entry"; absent means it
   * always stands alone.
   */
  coalesceKey?: string
}

/** The op that moves an edit in the given direction. */
function opFor(edit: StyleEdit, direction: 'before' | 'after'): StyleOp {
  if (edit.kind === 'interaction') {
    return { kind: 'interaction', id: edit.id, ...(edit.name ? { name: edit.name } : {}), interaction: edit[direction] }
  }
  const props = edit[direction]
  return edit.kind === 'class'
    ? { kind: 'class', id: edit.id, ...(edit.name ? { name: edit.name } : {}), props }
    : { kind: 'tag', tag: edit.tag, props }
}

/** True when an edit would not change anything. */
function isNoop(edit: StyleEdit): boolean {
  return JSON.stringify(edit.before) === JSON.stringify(edit.after)
}

/** Records a style edit. Returns the SAME history when nothing changed. */
export function pushStyleEdit(h: StyleHistory, edit: StyleEdit, opts: PushStyleOptions): StyleHistory {
  if (isNoop(edit)) return h

  const merge = !!opts.coalesceKey
    && opts.coalesceKey === h.lastKey
    && opts.at - h.lastAt < STYLE_COALESCE_MS
    && h.past.length > 0

  // A merge REPLACES the last entry, keeping its `before` - so the whole
  // burst undoes to where it started rather than to the previous frame.
  const past = merge
    ? [...h.past.slice(0, -1), { ...edit, before: h.past[h.past.length - 1].before } as StyleEdit]
    : [...h.past, edit].slice(-MAX_DEPTH)

  return {
    past,
    future: [],                       // a new edit abandons the redo branch
    lastKey: opts.coalesceKey ?? null,
    lastAt: opts.at,
  }
}

/** One step back: the history to keep, and the op to apply. */
export function undoStyle(h: StyleHistory): { history: StyleHistory; op: StyleOp } | null {
  if (!canUndoStyle(h)) return null
  const past = [...h.past]
  const edit = past.pop() as StyleEdit
  return {
    history: { past, future: [edit, ...h.future], lastKey: null, lastAt: 0 },
    op: opFor(edit, 'before'),
  }
}

/** One step forward: the history to keep, and the op to apply. */
export function redoStyle(h: StyleHistory): { history: StyleHistory; op: StyleOp } | null {
  if (!canRedoStyle(h)) return null
  const [edit, ...future] = h.future
  return {
    history: { past: [...h.past, edit], future, lastKey: null, lastAt: 0 },
    op: opFor(edit, 'after'),
  }
}

/**
 * The version token of a stored row.
 *
 * A revision token, NOT a timestamp. Two saves inside the same millisecond
 * carry the same ISO string, so a clock-based version silently lets the
 * second one through - exactly the lost update this is meant to catch. Older
 * rows predating `rev` fall back to their timestamp, which is weaker but
 * better than refusing to guard them at all.
 */
export function rowVersion(row: { rev?: unknown; updatedAt?: unknown }): string | undefined {
  if (typeof row.rev === 'string' && row.rev) return row.rev
  if (typeof row.updatedAt === 'string' && row.updatedAt) return row.updatedAt
  return undefined
}

/**
 * True when a write is based on a version someone else has already replaced.
 *
 * `ExtensionStore.put` is an unconditional upsert with no version column, so
 * without this two designers on one class is silent last-write-wins - the
 * second save quietly discards the first. This does not merge; it makes the
 * collision LOUD, which is the difference between losing work and being told
 * to reload.
 *
 * Deliberately opt-in: a caller that sends no expectation is not blocked, so
 * existing clients keep working rather than breaking on a new required field.
 */
export function staleWrite(existing: { rev?: unknown; updatedAt?: unknown }, expected: string | undefined): boolean {
  if (!expected) return false
  const current = rowVersion(existing)
  if (!current) return false
  return current !== expected
}

/** A fresh version token. Random, so it never collides with a fast neighbour. */
export function newRev(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}
