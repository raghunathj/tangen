/**
 * File Name: presence-store.ts
 * Purpose: Where a joined session lives while it is joined - one record per
 *          session per scope channel with an expiry - on memory, on a Redis
 *          hash, or in the `realtime_presence` table, behind one interface.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R3 of tasks/plan-realtime.md (section 4.5: "stored in
 *          the same ladder (Redis hash with expiry, Postgres realtime_presence
 *          rows pruned by the queue worker, memory)") and the architecture's
 *          sections 44 and 56.11: presence is ephemeral. Nothing here is
 *          history - a record exists from join until leave or expiry and
 *          the activity log never reads it.
 *
 *          The store is the cross-process truth. A process keeps its own
 *          connections' sessions in memory too (presence.ts), so a
 *          heartbeat that finds its row gone (pruned, expired while the tab
 *          was hidden) can put it back; the store only has to answer "who
 *          is here now" for a snapshot and "who just expired" for a sweep.
 *
 *          Expiry is a field, not a key TTL. Redis hashes have no per-field
 *          expiry before 7.4, so every record carries `exp` and readers
 *          filter by it; the hash key itself expires a little past the TTL,
 *          which bounds a quiet scope's memory. Postgres keeps `expires_at`
 *          as a column with an index so the sweep and the worker's prune
 *          are one range scan. sweep() removes and RETURNS what expired, so
 *          when two processes sweep the same scope only the one whose
 *          delete landed publishes the leave (Redis HDEL and Postgres
 *          DELETE ... RETURNING both say whether it did). Memory does the
 *          same by construction.
 */
import { sql, type SQL } from 'drizzle-orm'
import { explainMissingRealtimeTable } from './schema-diagnostic'

export type PresenceState = 'viewing' | 'editing' | 'idle'

/** One joined session, as stored and as sent to clients (minus `exp`). */
export interface PresenceSession {
  /** The connection id: one session per connection per scope. */
  id: string
  memberId: string | null
  apiKeyId: string | null
  /** Resolved once at join, never per heartbeat. */
  name: string
  avatar: string | null
  state: PresenceState
  field?: string
  block?: string
  /** The content type of an object scope, as the client named it (mirrored on `presence:objects:<typeSlug>`). */
  typeSlug?: string
  /** Aggregate records only: the object this session is on (the scope's id). */
  objectId?: string
  /** Small client extras (primitives only), capped with the whole state object at 1 KB. */
  meta?: Record<string, string | number | boolean>
  /** Joined at (ms). */
  since: number
  updatedAt: number
  /** When the session last entered `editing`, for the advisory claim's order. */
  editingSince: number | null
  /** When the session took the advisory claim; null when it does not hold it. */
  claimedAt: number | null
  /** Expires at (ms); extended by every heartbeat. */
  exp: number
}

export type MaybePromise<T> = T | Promise<T>

export interface PresenceStore {
  kind: 'memory' | 'redis' | 'postgres'
  /** Inserts or replaces the session record. */
  upsert(ch: string, session: PresenceSession): MaybePromise<void>
  /** Extends the expiry of one session. False when the record is gone. */
  touch(ch: string, sessionId: string, exp: number): MaybePromise<boolean>
  /** Removes one session; the record as it was, or null when it was not there. */
  remove(ch: string, sessionId: string): MaybePromise<PresenceSession | null>
  /** Every session that has not expired at `now`. */
  list(ch: string, now: number): MaybePromise<PresenceSession[]>
  /** Removes the sessions expired at `now` and returns them; each is returned once. */
  sweep(ch: string, now: number): MaybePromise<PresenceSession[]>
}

// ── Memory ────────────────────────────────────────────────────────────────────

export class MemoryPresenceStore implements PresenceStore {
  readonly kind = 'memory' as const
  private readonly channels = new Map<string, Map<string, PresenceSession>>()

  private of(ch: string, create: boolean): Map<string, PresenceSession> | undefined {
    let m = this.channels.get(ch)
    if (!m && create) { m = new Map(); this.channels.set(ch, m) }
    return m
  }

  upsert(ch: string, session: PresenceSession): void {
    this.of(ch, true)!.set(session.id, { ...session })
  }

  touch(ch: string, sessionId: string, exp: number): boolean {
    const s = this.of(ch, false)?.get(sessionId)
    if (!s) return false
    s.exp = exp
    return true
  }

  remove(ch: string, sessionId: string): PresenceSession | null {
    const m = this.of(ch, false)
    const s = m?.get(sessionId) ?? null
    if (m && s) { m.delete(sessionId); if (m.size === 0) this.channels.delete(ch) }
    return s
  }

  list(ch: string, now: number): PresenceSession[] {
    return [...(this.of(ch, false)?.values() ?? [])].filter((s) => s.exp > now).map((s) => ({ ...s }))
  }

  sweep(ch: string, now: number): PresenceSession[] {
    const m = this.of(ch, false)
    if (!m) return []
    const gone: PresenceSession[] = []
    for (const s of [...m.values()]) {
      if (s.exp > now) continue
      m.delete(s.id)
      gone.push(s)
    }
    if (m.size === 0) this.channels.delete(ch)
    return gone
  }

  /** Channels with at least one record (tests and diagnostics). */
  channelNames(): string[] {
    return [...this.channels.keys()]
  }
}

// ── Redis ─────────────────────────────────────────────────────────────────────

/** What the store needs of an ioredis client. */
export interface RedisHashClient {
  hset(key: string, field: string, value: string): Promise<unknown>
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string>>
  hdel(key: string, ...fields: string[]): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
}

export interface RedisPresenceOptions {
  /** The key lives this long past the last write, so a quiet scope costs nothing. */
  ttlSeconds?: number
  keyPrefix?: string
}

const parseSession = (raw: string | null | undefined): PresenceSession | null => {
  if (!raw) return null
  try { return JSON.parse(raw) as PresenceSession } catch { return null }
}

export class RedisPresenceStore implements PresenceStore {
  readonly kind = 'redis' as const
  private readonly prefix: string
  private readonly keyTtl: number

  constructor(private readonly redis: RedisHashClient, opts: RedisPresenceOptions = {}) {
    this.prefix = opts.keyPrefix ?? 'rt:pr:'
    this.keyTtl = Math.max((opts.ttlSeconds ?? 60) * 2, 120)
  }

  key(ch: string): string {
    return `${this.prefix}${ch}`
  }

  async upsert(ch: string, session: PresenceSession): Promise<void> {
    const key = this.key(ch)
    await this.redis.hset(key, session.id, JSON.stringify(session))
    void this.redis.expire(key, this.keyTtl)
  }

  async touch(ch: string, sessionId: string, exp: number): Promise<boolean> {
    const key = this.key(ch)
    const s = parseSession(await this.redis.hget(key, sessionId))
    if (!s) return false
    s.exp = exp
    await this.redis.hset(key, sessionId, JSON.stringify(s))
    void this.redis.expire(key, this.keyTtl)
    return true
  }

  async remove(ch: string, sessionId: string): Promise<PresenceSession | null> {
    const key = this.key(ch)
    const s = parseSession(await this.redis.hget(key, sessionId))
    if (!s) return null
    const removed = await this.redis.hdel(key, sessionId)
    return removed > 0 ? s : null
  }

  async list(ch: string, now: number): Promise<PresenceSession[]> {
    const all = await this.redis.hgetall(this.key(ch))
    const out: PresenceSession[] = []
    for (const raw of Object.values(all ?? {})) {
      const s = parseSession(raw)
      if (s && s.exp > now) out.push(s)
    }
    return out
  }

  async sweep(ch: string, now: number): Promise<PresenceSession[]> {
    const key = this.key(ch)
    const all = await this.redis.hgetall(key)
    const gone: PresenceSession[] = []
    for (const raw of Object.values(all ?? {})) {
      const s = parseSession(raw)
      if (!s || s.exp > now) continue
      // HDEL says whether THIS process removed it; another sweeper may have won.
      if ((await this.redis.hdel(key, s.id)) > 0) gone.push(s)
    }
    return gone
  }
}

// ── Postgres ──────────────────────────────────────────────────────────────────


type Rows = Record<string, unknown>[]

function bind(text: string, params: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/)
  const chunks: SQL[] = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { if (parts[i]) chunks.push(sql.raw(parts[i]!)) }
    else chunks.push(sql`${params[Number(parts[i]) - 1]}`)
  }
  return sql.join(chunks, sql.raw(''))
}

/** A `(text, params) => rows` executor over a drizzle client (postgres.js or PGlite), or null. */
function executor(db: unknown): ((text: string, params?: unknown[]) => Promise<Rows>) | null {
  const d = db as { execute?: (q: SQL) => Promise<unknown>; $rawClient?: { unsafe?: Function } } | null | undefined
  if (!d) return null
  // A missing table is the operator's diagnostic, never a CREATE (migration 0031_realtime_presence owns the table).
  const explained = (run: () => Promise<Rows>) => run().catch((e) => explainMissingRealtimeTable(e, 'realtime_presence', '0031_realtime_presence'))
  if (typeof d.$rawClient?.unsafe === 'function') {
    return (text, params = []) => explained(async () => (await d.$rawClient!.unsafe!(text, params as never)) as Rows)
  }
  if (typeof d.execute === 'function') {
    return (text, params = []) => explained(async () => {
      const res = await d.execute!(bind(text, params)) as Rows | { rows: Rows }
      return Array.isArray(res) ? res : (res.rows ?? [])
    })
  }
  return null
}

const rowToSession = (row: Record<string, unknown>): PresenceSession | null => {
  const raw = row.data
  if (typeof raw === 'string') return parseSession(raw)
  return (raw as PresenceSession) ?? null
}

export class PostgresPresenceStore implements PresenceStore {
  readonly kind = 'postgres' as const
  private readonly exec: NonNullable<ReturnType<typeof executor>>

  constructor(db: unknown) {
    const exec = executor(db)
    if (!exec) throw new Error('PostgresPresenceStore needs a drizzle client with execute() or a raw postgres.js client')
    this.exec = exec
  }

  async upsert(ch: string, session: PresenceSession): Promise<void> {
    await this.exec(
      `INSERT INTO realtime_presence (channel, session_id, data, expires_at) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (channel, session_id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [ch, session.id, JSON.stringify(session), session.exp],
    )
  }

  async touch(ch: string, sessionId: string, exp: number): Promise<boolean> {
    const rows = await this.exec(
      `UPDATE realtime_presence SET expires_at = $3, data = data || jsonb_build_object('exp', $3::bigint)
       WHERE channel = $1 AND session_id = $2 RETURNING session_id`,
      [ch, sessionId, exp],
    )
    return rows.length > 0
  }

  async remove(ch: string, sessionId: string): Promise<PresenceSession | null> {
    const rows = await this.exec(`DELETE FROM realtime_presence WHERE channel = $1 AND session_id = $2 RETURNING data`, [ch, sessionId])
    return rows[0] ? rowToSession(rows[0]) : null
  }

  async list(ch: string, now: number): Promise<PresenceSession[]> {
    const rows = await this.exec(`SELECT data FROM realtime_presence WHERE channel = $1 AND expires_at > $2 ORDER BY session_id`, [ch, now])
    return rows.map(rowToSession).filter((s): s is PresenceSession => !!s)
  }

  async sweep(ch: string, now: number): Promise<PresenceSession[]> {
    const rows = await this.exec(`DELETE FROM realtime_presence WHERE channel = $1 AND expires_at <= $2 RETURNING data`, [ch, now])
    return rows.map(rowToSession).filter((s): s is PresenceSession => !!s)
  }
}

/**
 * Drops rows whose expiry is more than `graceSeconds` in the past: the
 * sweep normally removes them as they expire, this catches the scopes no
 * live process was watching. Run by the queue worker's housekeeping like
 * realtime_events; best effort.
 */
export async function pruneRealtimePresence(db: unknown, graceSeconds = 60): Promise<void> {
  const exec = executor(db)
  if (!exec) return
  await exec(`DELETE FROM realtime_presence WHERE expires_at < $1`, [Date.now() - graceSeconds * 1000]).catch(() => {})
}
