/**
 * File Name: retention-postgres.ts
 * Purpose: The replay window on Postgres - the `realtime_events` table that
 *          gives NOTIFY its payload back, ids minted by one sequence,
 *          since(cursor) as an ordered read, pruning for the queue worker.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R2 of tasks/plan-realtime.md (section 4.4 and the
 *          risk in section 7: "NOTIFY payload and connection semantics").
 *          A NOTIFY payload is capped at 8000 bytes and a listener that
 *          reconnects loses what was sent meanwhile, so the envelope never
 *          rides the notification: it is written here first, the
 *          notification carries only `{ch, id}`, and the receiving process
 *          reads the row back. A missed NOTIFY is then recoverable, because
 *          the row is still here and a client resumes by cursor.
 *
 *          Ids keep retention.ts's `<epoch>-<seq>` shape: the epoch is the
 *          database clock at insert (one clock for every process), the seq
 *          one bigserial for the table (one minting point for every
 *          process). Ordering uses the seq alone, which is assigned in
 *          insert order; the epoch is there for the cursor grammar and for
 *          the coalescing comparison. The one window this leaves open is a
 *          reconnect in the same millisecond as a concurrent insert that
 *          took its seq earlier and committed later; the live path does not
 *          depend on since(), so the cost is one missed replay event, never
 *          a missed live one.
 *
 *          since() is conservative like memory: the cursor row must still
 *          exist (or the cursor must be at or past the channel's newest
 *          row, which means nothing was missed); otherwise resync. Pruning
 *          (queue worker housekeeping, like rate_limit_counters) drops rows
 *          older than the window and beyond the count, but never a
 *          channel's newest row, so an idle client's cursor stays covered.
 *
 *          Queries go through the drizzle client's `execute` with a bound
 *          SQL chunk, which runs on postgres.js in production and on PGlite
 *          in the harness, so the store is tested on a real SQL engine.
 */
import { sql, type SQL } from 'drizzle-orm'
import { explainMissingRealtimeTable } from './schema-diagnostic'
import type { RealtimeEnvelope } from './router'
import { compareIds, parseId, type RetentionStore, type SinceResult } from './retention'

export interface PostgresRetentionOptions {
  maxEvents?: number
  seconds?: number
}

const DEFAULT_MAX_EVENTS = 200
const DEFAULT_SECONDS = 60


type Rows = Record<string, unknown>[]

/** Binds `$1..$n` placeholders in `text` to `params` as a drizzle SQL chunk. */
function bind(text: string, params: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/)
  const chunks: SQL[] = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { if (parts[i]) chunks.push(sql.raw(parts[i]!)) }
    else chunks.push(sql`${params[Number(parts[i]) - 1]}`)
  }
  return sql.join(chunks, sql.raw(''))
}

/** A `(text, params) => rows` executor over a drizzle client, or null when it has none. */
export function pgExecutor(db: unknown): ((text: string, params?: unknown[]) => Promise<Rows>) | null {
  const d = db as { execute?: (q: SQL) => Promise<unknown>; $rawClient?: { unsafe?: Function } } | null | undefined
  if (!d) return null
  // A missing table is the operator's diagnostic, never a CREATE (migration 0028_realtime_events owns the table).
  const explained = (run: () => Promise<Rows>) => run().catch((e) => explainMissingRealtimeTable(e, 'realtime_events', '0028_realtime_events'))
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

function rowToEnvelope(ch: string, row: Record<string, unknown>): RealtimeEnvelope {
  const raw = row.data
  const data = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : ((raw as Record<string, unknown>) ?? {})
  return { ch, id: String(row.id), t: Number(row.t), type: String(row.type), data }
}

export class PostgresRetention implements RetentionStore {
  readonly kind = 'postgres' as const
  private readonly exec: NonNullable<ReturnType<typeof pgExecutor>>
  private readonly maxEvents: number
  private readonly seconds: number

  constructor(db: unknown, opts: PostgresRetentionOptions = {}) {
    const exec = pgExecutor(db)
    if (!exec) throw new Error('PostgresRetention needs a drizzle client with execute() or a raw postgres.js client')
    this.exec = exec
    this.maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS
    this.seconds = opts.seconds ?? DEFAULT_SECONDS
  }

  limits(): { maxEvents: number; seconds: number } {
    return { maxEvents: this.maxEvents, seconds: this.seconds }
  }

  async append(ch: string, event: { type: string; data: Record<string, unknown> }): Promise<RealtimeEnvelope> {
    const rows = await this.exec(
      `WITH n AS (SELECT nextval(pg_get_serial_sequence('realtime_events', 'seq')) AS seq, (extract(epoch from clock_timestamp()) * 1000)::bigint AS t)
       INSERT INTO realtime_events (seq, channel, id, t, type, data)
       SELECT n.seq, $1, n.t::text || '-' || n.seq::text, n.t, $2, $3::jsonb FROM n
       RETURNING id, t`,
      [ch, event.type, JSON.stringify(event.data)],
    )
    const row = rows[0]
    if (!row) throw new Error('realtime_events insert returned no row')
    return { ch, id: String(row.id), t: Number(row.t), type: event.type, data: event.data }
  }

  /** One retained envelope by channel and id (the NOTIFY receiver's read-back). */
  async get(ch: string, id: string): Promise<RealtimeEnvelope | null> {
    const rows = await this.exec(`SELECT id, t, type, data FROM realtime_events WHERE channel = $1 AND id = $2 LIMIT 1`, [ch, id])
    return rows[0] ? rowToEnvelope(ch, rows[0]) : null
  }

  async since(ch: string, cursor: string): Promise<SinceResult> {
    if (!parseId(cursor)) return { kind: 'resync' }
    const at = await this.exec(`SELECT seq FROM realtime_events WHERE channel = $1 AND id = $2 LIMIT 1`, [ch, cursor])
    if (!at[0]) {
      const newest = await this.latestId(ch)
      if (!newest) return { kind: 'resync' }
      return compareIds(cursor, newest) >= 0 ? { kind: 'events', events: [] } : { kind: 'resync' }
    }
    const rows = await this.exec(
      `SELECT id, t, type, data FROM realtime_events WHERE channel = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [ch, Number(at[0].seq), this.maxEvents + 1],
    )
    if (rows.length > this.maxEvents) return { kind: 'resync' }
    return { kind: 'events', events: rows.map((r) => rowToEnvelope(ch, r)) }
  }

  async latestId(ch: string): Promise<string | null> {
    const rows = await this.exec(`SELECT id FROM realtime_events WHERE channel = $1 ORDER BY seq DESC LIMIT 1`, [ch])
    return rows[0] ? String(rows[0].id) : null
  }
}

/**
 * Drops rows outside the window - older than `seconds`, or beyond
 * `maxEvents` per channel - keeping every channel's newest row. Run by the
 * queue worker's housekeeping, like rate_limit_counters; best effort.
 */
export async function pruneRealtimeEvents(db: unknown, opts: PostgresRetentionOptions = {}): Promise<void> {
  const exec = pgExecutor(db)
  if (!exec) return
  const seconds = opts.seconds ?? DEFAULT_SECONDS
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS
  const cutoff = Date.now() - seconds * 1000
  await exec(
    `DELETE FROM realtime_events WHERE t < $1 AND seq NOT IN (SELECT max(seq) FROM realtime_events GROUP BY channel)`,
    [cutoff],
  ).catch(() => {})
  await exec(
    `DELETE FROM realtime_events WHERE seq IN (
       SELECT seq FROM (SELECT seq, row_number() OVER (PARTITION BY channel ORDER BY seq DESC) AS rn FROM realtime_events) x WHERE x.rn > $1
     )`,
    [maxEvents],
  ).catch(() => {})
}
