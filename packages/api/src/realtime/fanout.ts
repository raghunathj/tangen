/**
 * File Name: fanout.ts
 * Purpose: The infrastructure bus - ONE physical channel per process on
 *          Redis pub/sub or Postgres LISTEN/NOTIFY, or plain local dispatch
 *          when the process is alone - and the retention store that goes
 *          with each.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R2 of tasks/plan-realtime.md (section 4.4) built to
 *          the architecture's sections 9, 10 and 36-37, which are not
 *          negotiable: logical subscriptions live ONLY in the per-process
 *          router; the infrastructure bus uses one physical channel that
 *          carries routing metadata; never a Redis subscription or a
 *          Postgres LISTEN per object, user or topic. So each process
 *          subscribes exactly once, whatever its sockets asked for, and
 *          hands every envelope it hears to its local router, which drops
 *          it unless someone local cares. 500 connections x 10 topics is
 *          5,000 map entries here and ONE subscription there; the fanout
 *          test asserts the count on a fake.
 *
 *          The ladder, resolved once at boot (resolveFanoutKind): Redis
 *          when REALTIME_FANOUT says so or is unset and REDIS_URL is
 *          configured; Postgres when REALTIME_FANOUT=postgres (or `auto`
 *          without Redis) and the db exposes postgres.js `listen`; local
 *          otherwise. Local is the default without Redis because the
 *          architecture's Small profile is one process and must cost no
 *          LISTEN connection and no table write per event; a deployment
 *          that runs several API processes without Redis sets
 *          REALTIME_FANOUT=postgres and says so in its runbook.
 *
 *          Redis: the envelope rides the message itself (pub/sub has no
 *          tight payload cap) on `<keyPrefix>tangen:realtime`, prefixed
 *          per project like every key because ioredis does not prefix
 *          channel names; the subscriber is a duplicated connection with
 *          its own retry strategy (the shared client gives up after one
 *          retry on purpose; a subscriber must not). Retention is the
 *          Redis stream store.
 *
 *          Postgres: NOTIFY carries only `{o, ch, id}` (8000-byte cap) and
 *          the receiver reads the envelope back from realtime_events. The
 *          listener is postgres.js `listen`, which holds a dedicated
 *          connection and re-LISTENs by itself after an error; what was
 *          notified while it was down is lost to THIS process, which is
 *          fine because the row is retained and a client that noticed a
 *          gap resumes by cursor (retention-postgres.ts).
 *
 *          The same one channel also carries ADDRESSED COMMANDS (R4's HTTP
 *          presence route, realtime/presence-route.ts): a small control
 *          message named for one connection id, which every process hears
 *          and only its owner acts on. It is not an event - never retained,
 *          never dispatched to a subscriber - and it exists so that a
 *          connection owned by another process can be reached without a
 *          second transport, a directory of connections or a physical
 *          channel per process. The Postgres side carries it inline rather
 *          than by readback: a command is a couple of hundred bytes, far
 *          inside NOTIFY's 8000.
 *
 *          Both skip their own messages by origin id (a process dispatches
 *          locally before it forwards, so hearing itself would double
 *          deliver). Both wrap the remote retention so that a store that
 *          is down degrades to memory retention and local dispatch, with a
 *          warning once a minute: the local tab still learns of the change;
 *          the other processes miss it, which is what a down bus means.
 */
import { redisDisabled } from '../plugins/redis'
import { randomBytes } from 'node:crypto'
import { getLogger } from '@tangen/logging'
import type { RealtimeEnvelope } from './router'
import { MemoryRetention, type RetentionStore, type RetentionOptions, type SinceResult, type MaybePromise } from './retention'
import { RedisRetention, type RedisStreamClient } from './retention-redis'
import { PostgresRetention } from './retention-postgres'

const logger = getLogger(['tangen', 'api', 'realtime', 'fanout'])

export type FanoutKind = 'local' | 'redis' | 'postgres'
export type FanoutMode = 'auto' | FanoutKind

/** The physical Redis channel (suffix; the project key prefix goes in front). */
export const REDIS_CHANNEL = 'tangen:realtime'
/** The Postgres NOTIFY channel. */
export const PG_CHANNEL = 'tangen_realtime'

/** What the Redis transport needs of the ioredis client. */
export interface RedisFanoutClient extends RedisStreamClient {
  publish(channel: string, message: string): Promise<unknown>
  duplicate(override?: Record<string, unknown>): RedisSubscriberClient
  options?: { keyPrefix?: string }
}

export interface RedisSubscriberClient {
  subscribe(channel: string): Promise<unknown>
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
  on(event: 'error', listener: (err: unknown) => void): unknown
  quit(): Promise<unknown>
}

/** What the Postgres transport needs of postgres.js (db.$rawClient). */
export interface PgListenClient {
  listen(channel: string, onnotify: (payload: string) => void, onlisten?: () => void): Promise<{ unlisten(): Promise<void> }>
  notify(channel: string, payload: string): Promise<unknown>
}

/** Who a command says it is from: the identity the sending process authenticated. */
export interface RealtimeCommandCaller {
  workspaceId: string
  memberId: string | null
  apiKeyId: string | null
}

/**
 * An addressed control message between processes. Not an event: it is never
 * retained and never reaches a subscriber; the process that owns `to` acts
 * on it and every other process drops it. The payload is re-validated by the
 * owner, so a malformed command is refused exactly as a malformed frame is.
 */
export interface RealtimeCommand {
  /** What to do. One op today: the HTTP presence route. */
  op: 'presence'
  /** The connection id this is addressed to. */
  to: string
  /** The identity the sending process authenticated, asserted to the owner. */
  caller: RealtimeCommandCaller
  /** The op's payload (a presence client message without its `op`). */
  payload: Record<string, unknown>
}

export interface FanoutOptions {
  redis?: unknown
  db?: unknown
  /** Where heard envelopes and commands go: the hub's dispatch, and the command handler. */
  local: {
    dispatch(envelope: RealtimeEnvelope): unknown
    /** Optional: a process that mounts no HTTP presence route needs none. */
    command?(command: RealtimeCommand): unknown
  }
  /** Default: REALTIME_FANOUT, else `redis` with REDIS_URL, else `local`. */
  mode?: FanoutMode
  redisDisabled?: boolean
  retention?: RetentionOptions
  processId?: string
}

export interface Fanout {
  kind: FanoutKind
  processId: string
  /** The retention store the hub should use (memory for local). */
  retention: RetentionStore
  /** Tells the other processes about an envelope this one retained. */
  forward(envelope: RealtimeEnvelope): void
  /**
   * Sends one addressed command to the other processes. A local fan-out has
   * none, so nothing is sent and the caller already knows the connection is
   * not here.
   */
  forwardCommand(command: RealtimeCommand): void
  /** Opens the one subscription. Idempotent. */
  start(): Promise<void>
  stop(): Promise<void>
  stats(): { kind: FanoutKind; subscriptions: number; forwarded: number; received: number; dropped: number; commandsForwarded: number; commandsReceived: number }
}

/** The ladder, as a pure function of what is configured and available. */
export function resolveFanoutKind(input: { mode?: FanoutMode | string | null; hasRedis: boolean; hasPgListen: boolean }): FanoutKind {
  const mode = (input.mode ?? (input.hasRedis ? 'redis' : 'local')) as FanoutMode
  switch (mode) {
    case 'redis':
      return input.hasRedis ? 'redis' : input.hasPgListen ? 'postgres' : 'local'
    case 'postgres':
      return input.hasPgListen ? 'postgres' : 'local'
    case 'auto':
      return input.hasRedis ? 'redis' : input.hasPgListen ? 'postgres' : 'local'
    default:
      return 'local'
  }
}

/** Logs at most once per interval per key, so a down store does not flood the log. */
function warnOnce(intervalMs = 60_000) {
  const last = new Map<string, number>()
  return (key: string, message: string, cause?: unknown) => {
    const now = Date.now()
    if (now - (last.get(key) ?? 0) < intervalMs) return
    last.set(key, now)
    logger.warn(`${message}${cause ? `: ${cause instanceof Error ? cause.message : String(cause)}` : ''}`)
  }
}

/**
 * A remote store that degrades to memory when it fails: append falls back
 * to a local id (the envelope still reaches local sockets), since() to
 * the memory window it has. The failure is logged once a minute.
 */
export function resilientRetention(remote: RetentionStore, fallback: MemoryRetention = new MemoryRetention(remote.limits())): RetentionStore {
  const warn = warnOnce()
  return {
    kind: remote.kind,
    limits: () => remote.limits(),
    append(ch, event): MaybePromise<RealtimeEnvelope> {
      try {
        const r = remote.append(ch, event)
        if (r instanceof Promise) return r.catch((e) => { warn('append', `realtime ${remote.kind} retention unavailable, retaining in memory`, e); return fallback.append(ch, event) })
        return r
      } catch (e) {
        warn('append', `realtime ${remote.kind} retention unavailable, retaining in memory`, e)
        return fallback.append(ch, event)
      }
    },
    since(ch, cursor): MaybePromise<SinceResult> {
      try {
        const r = remote.since(ch, cursor)
        if (r instanceof Promise) return r.catch((e) => { warn('since', `realtime ${remote.kind} retention unavailable, replaying from memory`, e); return fallback.since(ch, cursor) })
        return r
      } catch (e) {
        warn('since', `realtime ${remote.kind} retention unavailable, replaying from memory`, e)
        return fallback.since(ch, cursor)
      }
    },
    latestId(ch): MaybePromise<string | null> {
      try {
        const r = remote.latestId(ch)
        if (r instanceof Promise) return r.catch(() => fallback.latestId(ch))
        return r
      } catch {
        return fallback.latestId(ch)
      }
    },
  }
}

interface Wire { o: string; e?: RealtimeEnvelope; ch?: string; id?: string; k?: RealtimeCommand }

const pgListenClientOf = (db: unknown): PgListenClient | null => {
  const raw = (db as { $rawClient?: Partial<PgListenClient> } | null | undefined)?.$rawClient
  return raw && typeof raw.listen === 'function' && typeof raw.notify === 'function' ? (raw as PgListenClient) : null
}

/**
 * Builds the fanout for this process. Call start() once the hub exists;
 * the retention it returns is the one to give the hub.
 */
export function createFanout(opts: FanoutOptions): Fanout {
  const processId = opts.processId ?? `rtp_${randomBytes(6).toString('hex')}`
  const hasRedis = !!opts.redis && !(opts.redisDisabled ?? redisDisabled())
  const pg = pgListenClientOf(opts.db)
  const kind = resolveFanoutKind({ mode: opts.mode ?? process.env.REALTIME_FANOUT ?? null, hasRedis, hasPgListen: !!pg })
  const warn = warnOnce()
  const counters = { subscriptions: 0, forwarded: 0, received: 0, dropped: 0, commandsForwarded: 0, commandsReceived: 0 }

  const hear = (wire: Wire | null, fetch?: (ch: string, id: string) => Promise<RealtimeEnvelope | null>) => {
    if (!wire || wire.o === processId) return
    if (wire.k) {
      counters.commandsReceived++
      // The handler decides whether this process owns the connection; a
      // command for somebody else's is silently nothing.
      try { opts.local.command?.(wire.k) } catch (e) { warn('command', 'realtime could not apply a forwarded command', e) }
      return
    }
    if (wire.e) {
      counters.received++
      opts.local.dispatch(wire.e)
      return
    }
    if (wire.ch && wire.id && fetch) {
      void fetch(wire.ch, wire.id).then((envelope) => {
        if (!envelope) { counters.dropped++; return }
        counters.received++
        opts.local.dispatch(envelope)
      }).catch((e) => { counters.dropped++; warn('readback', 'realtime could not read a notified event back', e) })
    }
  }

  const parse = (message: string): Wire | null => {
    try { return JSON.parse(message) as Wire } catch { return null }
  }

  if (kind === 'redis') {
    const redis = opts.redis as RedisFanoutClient
    const prefix = redis.options?.keyPrefix ?? ''
    const channel = `${prefix}${REDIS_CHANNEL}`
    const retention = resilientRetention(new RedisRetention(redis, opts.retention))
    let subscriber: RedisSubscriberClient | null = null
    let started: Promise<void> | null = null
    return {
      kind, processId, retention,
      forward(envelope) {
        counters.forwarded++
        redis.publish(channel, JSON.stringify({ o: processId, e: envelope } satisfies Wire))
          .catch((e) => warn('publish', 'realtime could not publish to Redis', e))
      },
      forwardCommand(command) {
        counters.commandsForwarded++
        redis.publish(channel, JSON.stringify({ o: processId, k: command } satisfies Wire))
          .catch((e) => warn('publish-command', 'realtime could not publish a command to Redis', e))
      },
      start() {
        if (started) return started
        started = (async () => {
          // Own connection: pub/sub mode blocks every other command on it, and
          // it must keep retrying where the shared client stops after one try.
          subscriber = redis.duplicate({ retryStrategy: (times: number) => Math.min(times * 500, 5000), maxRetriesPerRequest: null, lazyConnect: false })
          subscriber.on('error', (e) => warn('subscriber', 'realtime Redis subscriber error', e))
          subscriber.on('message', (ch, message) => { if (ch === channel) hear(parse(message)) })
          await subscriber.subscribe(channel)
          counters.subscriptions = 1
          logger.info(`realtime fan-out: Redis pub/sub on ${channel}`)
        })()
        return started
      },
      async stop() {
        if (subscriber) { try { await subscriber.quit() } catch { /* gone */ } }
        subscriber = null
        started = null
        counters.subscriptions = 0
      },
      stats: () => ({ kind, ...counters }),
    }
  }

  if (kind === 'postgres' && pg) {
    const store = new PostgresRetention(opts.db, opts.retention)
    const retention = resilientRetention(store)
    let listener: { unlisten(): Promise<void> } | null = null
    let started: Promise<void> | null = null
    return {
      kind, processId, retention,
      forward(envelope) {
        counters.forwarded++
        pg.notify(PG_CHANNEL, JSON.stringify({ o: processId, ch: envelope.ch, id: envelope.id } satisfies Wire))
          .catch((e) => warn('notify', 'realtime could not NOTIFY', e))
      },
      forwardCommand(command) {
        // Inline: a command is nowhere near NOTIFY's 8000 bytes, and there is
        // no row to read it back from (commands are never retained).
        counters.commandsForwarded++
        pg.notify(PG_CHANNEL, JSON.stringify({ o: processId, k: command } satisfies Wire))
          .catch((e) => warn('notify-command', 'realtime could not NOTIFY a command', e))
      },
      start() {
        if (started) return started
        started = (async () => {
          listener = await pg.listen(
            PG_CHANNEL,
            (payload) => hear(parse(payload), (ch, id) => store.get(ch, id)),
            () => { counters.subscriptions = 1; logger.info(`realtime fan-out: Postgres LISTEN ${PG_CHANNEL}`) },
          )
          counters.subscriptions = 1
        })()
        return started
      },
      async stop() {
        if (listener) { try { await listener.unlisten() } catch { /* gone */ } }
        listener = null
        started = null
        counters.subscriptions = 0
      },
      stats: () => ({ kind, ...counters }),
    }
  }

  return {
    kind: 'local', processId,
    retention: new MemoryRetention(opts.retention),
    forward() { /* alone: the local dispatch already happened */ },
    forwardCommand() { /* alone: a connection that is not here is nowhere */ },
    async start() { /* nothing to subscribe to */ },
    async stop() {},
    stats: () => ({ kind: 'local', ...counters }),
  }
}
