/**
 * File Name: history.ts
 * Purpose: Undo and redo over the block tree.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio funnels EVERY change through one setter, so a
 *          history stack over that single seam covers the tree, the props
 *          rail, the canvas toolbar, inline typing and drops alike - there
 *          is no per-feature undo to keep in sync.
 *
 *          Typing is coalesced: without it a headline would take one undo
 *          per keystroke. Coalescing is keyed by WHAT is being edited and
 *          bounded by a pause, so two different fields never merge and a
 *          deliberate pause always starts a new step. Structural changes
 *          (drag, delete, duplicate) pass no key and are therefore always
 *          their own step - losing a whole drag to a coalesce would be
 *          worse than an extra entry.
 */

/** Edits to the same target within this window merge into one entry. */
export const COALESCE_MS = 600

/** Beyond this, the oldest steps are dropped. */
const MAX_DEPTH = 100

type Blocks = Array<Record<string, unknown>>

/**
 * Generic over the snapshot so the locale overlay (WF-T11b) can keep a
 * stack of its own with the same coalescing. Defaults to the block tree,
 * which every existing caller means.
 */
export interface History<T = Blocks> {
  past: T[]
  present: T
  future: T[]
  /** What the last entry was editing, for coalescing. */
  lastKey: string | null
  lastAt: number
}

export function emptyHistory<T = Blocks>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 }
}

export const canUndo = <T,>(h: History<T>): boolean => h.past.length > 0
export const canRedo = <T,>(h: History<T>): boolean => h.future.length > 0

export interface PushOptions {
  at: number
  /**
   * Identifies what is being edited (e.g. `${blockKey}.${prop}`). Present
   * means "this may merge with the previous entry"; absent means structural.
   */
  coalesceKey?: string
}

/** Records a new present. Returns the SAME history when nothing changed. */
export function pushHistory<T = Blocks>(h: History<T>, next: T, opts: PushOptions): History<T> {
  if (next === h.present) return h
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h

  const merge = !!opts.coalesceKey
    && opts.coalesceKey === h.lastKey
    && opts.at - h.lastAt < COALESCE_MS
    && h.past.length > 0

  // Merging replaces the present without deepening the stack, so the whole
  // burst undoes to where it started.
  const past = merge ? h.past : [...h.past, h.present].slice(-MAX_DEPTH)

  return {
    past,
    present: next,
    future: [],                       // a new edit abandons the redo branch
    lastKey: opts.coalesceKey ?? null,
    lastAt: opts.at,
  }
}

/** One step back, or null at the beginning. */
export function undo<T = Blocks>(h: History<T>): History<T> | null {
  if (!canUndo(h)) return null
  const past = [...h.past]
  const present = past.pop() as T
  return { past, present, future: [h.present, ...h.future], lastKey: null, lastAt: 0 }
}

/** One step forward, or null at the end. */
export function redo<T = Blocks>(h: History<T>): History<T> | null {
  if (!canRedo(h)) return null
  const [present, ...future] = h.future
  return { past: [...h.past, h.present], present, future, lastKey: null, lastAt: 0 }
}
