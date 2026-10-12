/**
 * File Name: retention.ts
 * Purpose: The bounded replay window - per-channel monotonic ids and the
 *          since(cursor) a reconnecting client resumes with.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md (section 4.2) and the
 *          architecture's section 42. Replay exists so a tab that dropped
 *          for a few seconds does not have to refetch everything; it is NOT
 *          the audit log, and the two bounds (200 events, 60 seconds, both
 *          starting points until R6 benchmarks them) keep it from becoming
 *          one. A cursor the window still covers gets exactly the envelopes
 *          after it; one it no longer covers gets `resync`, and the client
 *          refetches canonical state through REST or GraphQL.
 *
 *          Ids are `<epoch>-<seq>` per channel, the shape a Redis stream
 *          mints, so the R2 stores swap in without changing a cursor.
 *          The epoch never goes backwards inside a channel even if the clock
 *          does, because a cursor comparison must stay a number comparison.
 *
 *          The one subtle rule is the floor. After eviction the store
 *          remembers the id of the LAST event it dropped; a cursor at or
 *          after the floor is fully covered, one before it is not. Before
 *          anything is evicted the floor is the first event this process saw
 *          on the channel - a cursor older than that came from another
 *          process or another life of this one, and the store cannot vouch
 *          for the gap, so it says resync rather than guess. Conservative by
 *          construction: the cost of a wrong `events` is a missed change, the
 *          cost of a wrong `resync` is one refetch.
 */
import type { RealtimeEnvelope } from './router'

export interface RetentionOptions {
  maxEvents?: number
  seconds?: number
  /** Injected clock for tests. */
  now?: () => number
}

export type SinceResult =
  | { kind: 'events'; events: RealtimeEnvelope[] }
  | { kind: 'resync' }

export type MaybePromise<T> = T | Promise<T>

/**
 * The store the hub retains into and replays from. Memory answers
 * synchronously, which keeps the single-process path one tick long; the
 * Redis and Postgres stores (R2: retention-redis.ts, retention-postgres.ts)
 * answer with promises, and the hub handles both shapes.
 */
export interface RetentionStore {
  kind: 'memory' | 'redis' | 'postgres'
  /** Mints the next id on the channel, retains the envelope, returns it. */
  append(ch: string, event: { type: string; data: Record<string, unknown> }): MaybePromise<RealtimeEnvelope>
  /** What a client at `cursor` has missed, or resync when the window no longer covers it. */
  since(ch: string, cursor: string): MaybePromise<SinceResult>
  latestId(ch: string): MaybePromise<string | null>
  limits(): { maxEvents: number; seconds: number }
}

const DEFAULT_MAX_EVENTS = 200
const DEFAULT_SECONDS = 60

const ID_RE = /^(\d+)-(\d+)$/

/** Parses `<epoch>-<seq>`; null for anything else. */
export function parseId(id: string): { epoch: number; seq: number } | null {
  const m = ID_RE.exec(id)
  if (!m) return null
  return { epoch: Number(m[1]), seq: Number(m[2]) }
}

/** Numeric order of two ids; callers guarantee both parse. */
export function compareIds(a: string, b: string): number {
  const pa = parseId(a)!
  const pb = parseId(b)!
  return pa.epoch !== pb.epoch ? pa.epoch - pb.epoch : pa.seq - pb.seq
}

interface ChannelState {
  events: RealtimeEnvelope[]
  lastEpoch: number
  lastSeq: number
  /** Id of the last evicted event, or the first retained event before any eviction. */
  floor: string
}

export class MemoryRetention implements RetentionStore {
  readonly kind = 'memory' as const
  private readonly channels = new Map<string, ChannelState>()
  private readonly maxEvents: number
  private readonly seconds: number
  private readonly now: () => number

  constructor(opts: RetentionOptions = {}) {
    this.maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS
    this.seconds = opts.seconds ?? DEFAULT_SECONDS
    this.now = opts.now ?? Date.now
  }

  limits(): { maxEvents: number; seconds: number } {
    return { maxEvents: this.maxEvents, seconds: this.seconds }
  }

  append(ch: string, event: { type: string; data: Record<string, unknown> }): RealtimeEnvelope {
    const t = this.now()
    let state = this.channels.get(ch)
    let epoch: number
    let seq: number
    if (!state) {
      epoch = t
      seq = 0
      state = { events: [], lastEpoch: epoch, lastSeq: seq, floor: `${epoch}-${seq}` }
      this.channels.set(ch, state)
    } else if (t > state.lastEpoch) {
      epoch = t
      seq = 0
    } else {
      epoch = state.lastEpoch
      seq = state.lastSeq + 1
    }
    state.lastEpoch = epoch
    state.lastSeq = seq
    const envelope: RealtimeEnvelope = { ch, id: `${epoch}-${seq}`, t, type: event.type, data: event.data }
    state.events.push(envelope)
    this.evict(state)
    return envelope
  }

  since(ch: string, cursor: string): SinceResult {
    const state = this.channels.get(ch)
    if (!state || !parseId(cursor)) return { kind: 'resync' }
    this.evict(state)
    if (compareIds(cursor, state.floor) < 0) return { kind: 'resync' }
    const events = state.events.filter((e) => compareIds(e.id, cursor) > 0)
    return { kind: 'events', events }
  }

  latestId(ch: string): string | null {
    const state = this.channels.get(ch)
    return state ? `${state.lastEpoch}-${state.lastSeq}` : null
  }

  /** Drops what the two bounds no longer cover and moves the floor past it. */
  private evict(state: ChannelState): void {
    const cutoff = this.now() - this.seconds * 1000
    let drop = 0
    while (drop < state.events.length && state.events[drop]!.t < cutoff) drop++
    if (state.events.length - drop > this.maxEvents) drop = state.events.length - this.maxEvents
    if (drop > 0) {
      state.floor = state.events[drop - 1]!.id
      state.events.splice(0, drop)
    }
  }
}
