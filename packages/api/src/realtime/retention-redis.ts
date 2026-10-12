/**
 * File Name: retention-redis.ts
 * Purpose: The replay window on Redis - one capped stream per channel, ids
 *          minted by XADD, since(cursor) as a range read.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R2 of tasks/plan-realtime.md (section 4.4: "the
 *          retention buffer") behind R1's RetentionStore. A Redis stream
 *          mints exactly the `<epoch>-<seq>` ids retention.ts defined, and
 *          it mints them in one place, so two API processes appending to
 *          the same channel get ids a cursor can order - which is the whole
 *          reason the store moves out of process memory when there is more
 *          than one process.
 *
 *          Bounds: XADD MAXLEN ~ maxEvents trims the count (the `~` lets
 *          Redis trim in whole nodes, cheaper and never below the bound),
 *          and an EXPIRE on the key bounds a quiet channel's memory. The
 *          time window is therefore "at least `seconds`": a client may be
 *          replayed slightly more than the memory store would have kept,
 *          never less. since() is conservative the same way memory is: the
 *          cursor must still be in the stream (or be at or past its newest
 *          entry, which means nothing was missed); a cursor the stream no
 *          longer holds, or more than maxEvents entries behind, is `resync`.
 *          Range reads are inclusive and drop the cursor entry itself, so
 *          the store works on Redis 5 as well as 6.2's exclusive ranges.
 *
 *          The client is ioredis (plugins/redis.ts); keyPrefix applies to
 *          the stream keys automatically, as to every other key. Typed as
 *          the four commands used, so tests run on a fake.
 */
import type { RealtimeEnvelope } from './router'
import { compareIds, parseId, type RetentionStore, type SinceResult } from './retention'

/** What the store needs of a Redis client. */
export interface RedisStreamClient {
  xadd(key: string, ...args: (string | number)[]): Promise<string | null>
  xrange(key: string, start: string, end: string, ...args: (string | number)[]): Promise<Array<[string, string[]]>>
  xrevrange(key: string, end: string, start: string, ...args: (string | number)[]): Promise<Array<[string, string[]]>>
  expire(key: string, seconds: number): Promise<unknown>
}

export interface RedisRetentionOptions {
  maxEvents?: number
  seconds?: number
  /** Key prefix inside the project's namespace. */
  keyPrefix?: string
}

const DEFAULT_MAX_EVENTS = 200
const DEFAULT_SECONDS = 60
/** A quiet channel's stream is dropped after this many seconds of silence. */
const IDLE_TTL_FLOOR_SECONDS = 600

/** Turns a stream entry's flat field list into the envelope it carried. */
function entryToEnvelope(ch: string, id: string, fields: string[]): RealtimeEnvelope | null {
  const map: Record<string, string> = {}
  for (let i = 0; i + 1 < fields.length; i += 2) map[fields[i]!] = fields[i + 1]!
  if (!map.type) return null
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(map.data ?? '{}') } catch { /* malformed entry: empty data */ }
  return { ch, id, t: Number(map.t ?? parseId(id)?.epoch ?? 0), type: map.type, data }
}

export class RedisRetention implements RetentionStore {
  readonly kind = 'redis' as const
  private readonly maxEvents: number
  private readonly seconds: number
  private readonly prefix: string

  constructor(private readonly redis: RedisStreamClient, opts: RedisRetentionOptions = {}) {
    this.maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS
    this.seconds = opts.seconds ?? DEFAULT_SECONDS
    this.prefix = opts.keyPrefix ?? 'rt:ev:'
  }

  limits(): { maxEvents: number; seconds: number } {
    return { maxEvents: this.maxEvents, seconds: this.seconds }
  }

  key(ch: string): string {
    return `${this.prefix}${ch}`
  }

  async append(ch: string, event: { type: string; data: Record<string, unknown> }): Promise<RealtimeEnvelope> {
    const key = this.key(ch)
    const t = Date.now()
    const id = await this.redis.xadd(key, 'MAXLEN', '~', this.maxEvents, '*', 'type', event.type, 't', String(t), 'data', JSON.stringify(event.data))
    if (!id) throw new Error('XADD returned no id')
    void this.redis.expire(key, Math.max(this.seconds * 2, IDLE_TTL_FLOOR_SECONDS))
    return { ch, id, t, type: event.type, data: event.data }
  }

  async since(ch: string, cursor: string): Promise<SinceResult> {
    if (!parseId(cursor)) return { kind: 'resync' }
    const key = this.key(ch)
    const rows = await this.redis.xrange(key, cursor, '+', 'COUNT', this.maxEvents + 2)
    if (rows.length === 0 || rows[0]![0] !== cursor) {
      // The cursor entry is gone (trimmed or expired). Nothing was missed only
      // if the cursor is at or past the newest entry the stream still holds.
      const newest = await this.redis.xrevrange(key, '+', '-', 'COUNT', 1)
      if (newest.length === 0) return { kind: 'resync' }
      return compareIds(cursor, newest[0]![0]) >= 0 ? { kind: 'events', events: [] } : { kind: 'resync' }
    }
    const after = rows.slice(1)
    if (after.length > this.maxEvents) return { kind: 'resync' }
    const events: RealtimeEnvelope[] = []
    for (const [id, fields] of after) {
      const e = entryToEnvelope(ch, id, fields)
      if (e) events.push(e)
    }
    return { kind: 'events', events }
  }

  async latestId(ch: string): Promise<string | null> {
    const newest = await this.redis.xrevrange(this.key(ch), '+', '-', 'COUNT', 1)
    return newest[0]?.[0] ?? null
  }
}
