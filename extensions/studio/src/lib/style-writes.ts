/**
 * File Name: style-writes.ts
 * Purpose: How the Style panel's writes reach the server - one at a time, the
 *          intermediate steps of a gesture dropped, and each one built on the
 *          version the previous one produced.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A class is shared, so every class and tag write carries
 *          the version it was built on and the server refuses one built on a
 *          version somebody has moved past ("Someone else changed this class -
 *          reload before saving again"). That guard is right, and it stays.
 *
 *          What was wrong was who tripped it. `<input type="color">` fires on
 *          every step of the picker and the hex field on every keystroke, and
 *          each fired its own PATCH carrying the version the panel had
 *          RENDERED with. The first write moved the row on; the rest of the
 *          same gesture arrived stale, and the designer - alone in the
 *          workspace - was told a stack of times that somebody else had
 *          changed their class.
 *
 *          Two pieces fix it without touching the guard:
 *
 *          The writer runs one write at a time and keeps at most one waiting
 *          write per key, so a forty-step drag sends the first and the last.
 *          A superseded write resolves with undefined rather than hanging -
 *          its caller has nothing left to do.
 *
 *          The ledger remembers the chain of versions THIS editor's own
 *          accepted writes produced. A write built on a version in that chain
 *          is re-based onto the head of it, with the props that went with it;
 *          a version the ledger has never seen - the panel reloaded, or a
 *          colleague really did save - is passed through untouched and
 *          refused exactly as before. The ledger can therefore never mask
 *          somebody else's write: it only ever advances along writes the
 *          server already accepted from here.
 *
 *          Pure, so the sequence in the bug report is a test rather than a
 *          click-through.
 */

// ── The writer ────────────────────────────────────────────────────────────────

export type WriteTask<T> = () => Promise<T>

export interface StyleWriter {
  /**
   * Queues a write. Writes run one at a time in the order their keys were
   * first seen; a second write on a key that is still waiting REPLACES it, so
   * only the newest value of a gesture is sent.
   * @param key - What this write is about (`class:<id>.background`). Two
   *              different properties are two keys and both are sent.
   * @param task - The write itself. It should read the version it needs when
   *               it RUNS, not when it is queued.
   * @returns The task's result, or undefined when a newer write superseded it.
   */
  run<T>(key: string, task: WriteTask<T>): Promise<T | undefined>
  /** Whether a write is in flight or waiting. */
  busy(): boolean
  /** Resolves when nothing is in flight or waiting. For tests and for teardown. */
  settled(): Promise<void>
}

interface Waiting {
  task: WriteTask<unknown>
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

export function createStyleWriter(): StyleWriter {
  let inFlight = false
  const waiting = new Map<string, Waiting>()
  /** Keys in the order they were first queued; a replaced key keeps its place. */
  const order: string[] = []
  const idle: Array<() => void> = []

  const pump = (): void => {
    if (inFlight) return
    const key = order.shift()
    if (key === undefined) {
      while (idle.length) idle.pop()!()
      return
    }
    const entry = waiting.get(key)
    waiting.delete(key)
    if (!entry) { pump(); return }
    inFlight = true
    void Promise.resolve()
      .then(() => entry.task())
      .then(entry.resolve, entry.reject)
      .finally(() => { inFlight = false; pump() })
  }

  return {
    run<T>(key: string, task: WriteTask<T>): Promise<T | undefined> {
      return new Promise<T | undefined>((resolve, reject) => {
        const superseded = waiting.get(key)
        // The one still waiting has been overtaken. Let its caller go.
        if (superseded) superseded.resolve(undefined)
        else order.push(key)
        waiting.set(key, { task: task as WriteTask<unknown>, resolve: resolve as (v: unknown) => void, reject })
        pump()
      })
    },
    busy: () => inFlight || waiting.size > 0,
    settled: () => (inFlight || waiting.size > 0
      ? new Promise<void>((r) => { idle.push(r) })
      : Promise.resolve()),
  }
}

// ── The ledger ────────────────────────────────────────────────────────────────

/** A row as a write should build on it: which version to claim, and from what. */
export interface StyleVersion {
  rev: string | undefined
  props: Record<string, unknown>
}

export interface StyleLedger {
  /**
   * Records that a write built on `from` was accepted and produced `to`.
   * @param key - The class id, or `tag:<tag>`.
   * @param from - The version the accepted write claimed; undefined for a create.
   * @param to - The version the server minted.
   * @param props - What is now stored.
   */
  note(key: string, from: string | undefined, to: string | undefined, props: Record<string, unknown>): void
  /**
   * The version and props the next write should build on.
   * @param rev - What the panel is holding, which may be several of this
   *              editor's own writes behind.
   * @param props - The props that went with it.
   * @returns The head of this editor's own chain when `rev` is part of it;
   *          otherwise `rev` and `props` unchanged, so a version from anywhere
   *          else reaches the server's guard exactly as it is.
   */
  resolve(key: string, rev: string | undefined, props: Record<string, unknown>): StyleVersion
  /** Drops everything. Called when the page changes. */
  forget(): void
}

/** How many versions of one row are remembered; a chain longer than this is history. */
const MAX_CHAIN = 64
/** How many rows are remembered at once. */
const MAX_ROWS = 200

interface Chain {
  /** Every version this editor's own accepted writes have claimed or produced. */
  seen: Set<string>
  head: string | undefined
  props: Record<string, unknown>
}

export function createStyleLedger(): StyleLedger {
  const rows = new Map<string, Chain>()
  return {
    note(key, from, to, props) {
      if (!to) return
      let chain = rows.get(key)
      if (!chain) {
        if (rows.size >= MAX_ROWS) rows.clear()
        chain = { seen: new Set(), head: undefined, props: {} }
        rows.set(key, chain)
      }
      if (from) chain.seen.add(from)
      chain.seen.add(to)
      if (chain.seen.size > MAX_CHAIN) {
        // Keep the recent end: an old version is one nobody is still holding.
        chain.seen = new Set([...chain.seen].slice(-MAX_CHAIN))
      }
      chain.head = to
      chain.props = props
    },
    resolve(key, rev, props) {
      const chain = rows.get(key)
      // Not a version this editor produced: a reload, or somebody else's write.
      // It goes to the server as it is, and the guard decides.
      if (!chain || !rev || !chain.seen.has(rev) || !chain.head) return { rev, props }
      return { rev: chain.head, props: chain.props }
    },
    forget() { rows.clear() },
  }
}
