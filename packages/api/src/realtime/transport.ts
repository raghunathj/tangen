/**
 * File Name: transport.ts
 * Purpose: The two wire adapters over one hub - the WebSocket route on
 *          Elysia and the EventSource-compatible SSE fallback - both opened
 *          with a ticket, plus the plugin that mounts them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R1 of tasks/plan-realtime.md (sections 4.3 and 4.6)
 *          and the architecture's section 6. Neither adapter knows the
 *          protocol: it turns a socket into a HubSocket (send that reports
 *          backpressure, close) and hands frames to the hub.
 *
 *          WebSocket. The ticket is redeemed in beforeHandle, BEFORE
 *          server.upgrade: a bad ticket is a plain 401 response and no
 *          socket ever exists, which is what "a revoked or used ticket is
 *          refused" should mean. Elysia spreads the context it ran the hooks
 *          on into ws.data, so the identity resolved there is the one open()
 *          attaches. Bun's send() returns -1 when it buffered the frame
 *          under pressure; the adapter accepts that frame but marks the
 *          socket pressured so the NEXT goes to the router's bounded queue,
 *          and the `drain` event releases it. Without that, Bun's own buffer
 *          would grow to its 16 MB limit per slow tab before anything said
 *          `slow`.
 *
 *          SSE. An EventSource can send nothing after the request, so the
 *          topics ride the query string and the cursor rides Last-Event-ID
 *          (or ?since= on the first connect). Every `id:` encodes the cursor
 *          of every topic on the stream (protocol.ts encodeCursorMap), since
 *          the browser resends only the last id it saw. `retry: 3000` sets
 *          the browser's reconnect delay; a comment every heartbeatMs keeps
 *          proxies from closing a quiet stream; X-Accel-Buffering: no keeps
 *          nginx from buffering it (docs/deployment.md). Backpressure comes
 *          from the ReadableStream: desiredSize at or below zero refuses the
 *          frame, and pull() - the consumer asking for more - drains.
 *
 *          Policy rows for both paths are `self-authenticating` in
 *          gateway/route-policy.ts (the ticket is the credential), so the
 *          Bearer derive steps aside; the ticket route itself is
 *          `authenticated`. The connection-lifecycle access log and the
 *          ceilings through the resolver are R5, the Gateway track's.
 *
 *          R5: GraphQL subscriptions ride the SAME WebSocket route. A client
 *          that asks for the `graphql-transport-ws` subprotocol on the
 *          upgrade gets the graphql-ws adapter (graphql-ws.ts) instead of
 *          the native framing, on the same ticket, the same hub attach and
 *          every Gateway control the route already has; a sibling route
 *          would have needed a policy row of its own for nothing. Where
 *          GraphQL is not enabled for the ticket's environment the upgrade
 *          is refused 404, as the POST mount is.
 */
import { redisDisabled } from '../plugins/redis'
import type { Elysia } from 'elysia'
import type { WorkspaceProject } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { RequestError } from '../lib/errors'
import { RealtimeHub, type HubConnection, type HubSocket } from './hub'
import { makeTicketStore, configureTicketStore } from './ticket'
import { loadIdentityPermissions } from './authorize'
import { onMemberPermissionsInvalidated } from '../middleware/auth'
import { decodeCursorMap, encodeCursorMap } from './protocol'
import { attachRealtimeBridge, memberNameResolver } from './bridge'
import { createFanout, type Fanout, type FanoutMode } from './fanout'
import { PresenceService, resolvePresenceActor } from './presence'
import { presenceCommandHandler } from './presence-route'
import { MemoryPresenceStore, RedisPresenceStore, PostgresPresenceStore, type PresenceStore } from './presence-store'
import { eventBus, type EventBus } from '../services/event-bus'
import type { RealtimePresenceConfig } from '@tangen/types'
import { wantsGraphqlWs, GraphqlWsSession, GRAPHQL_WS_SUBPROTOCOL, type GraphqlWsSource, type GraphqlWsTarget } from './graphql-ws'

export interface RealtimePluginOptions {
  /** A prepared hub (tests); otherwise one is built from the clients below. */
  hub?: RealtimeHub
  redis?: unknown
  db?: unknown
  redisDisabled?: boolean
  projects?: () => WorkspaceProject[]
  /** SSE keep-alive comment interval. */
  heartbeatMs?: number
  /** Browser reconnect delay sent on the SSE stream. */
  retryMs?: number
  /** The bus to bridge (default: the process singleton); `bridge: false` leaves it detached. */
  eventBus?: EventBus
  bridge?: boolean
  /** Infrastructure fan-out ladder; default REALTIME_FANOUT (see fanout.ts). */
  fanout?: FanoutMode
  /** R3: presence timing from tangen.config `realtime.presence`; defaults 20 s / 60 s. */
  presence?: RealtimePresenceConfig
  /** R3: a prepared presence store (tests); otherwise one follows the fan-out rung. */
  presenceStore?: PresenceStore
  /**
   * R5: where the graphql-ws adapter finds the env's GraphQL schema for a
   * connection; default reads the API mount's memoized schema
   * (routes/graphql.ts), `false` refuses the subprotocol outright.
   */
  graphql?: GraphqlWsSource | false
  /** R5: how long a graphql-ws client has to send connection_init (3 s). */
  graphqlInitTimeoutMs?: number
}

const logger = getLogger(['tangen', 'api', 'realtime'])

const DEFAULT_HEARTBEAT_MS = 25_000
const DEFAULT_RETRY_MS = 3_000

/** Is realtime wanted by these projects? Default yes; off only when every project that says anything says `enabled: false`. */
export function realtimeEnabled(projects: ReadonlyArray<{ config?: { realtime?: { enabled?: boolean } } }>): boolean {
  const said = projects.map((p) => p.config?.realtime?.enabled).filter((v): v is boolean => typeof v === 'boolean')
  return said.length === 0 || said.some((v) => v)
}

let processHub: RealtimeHub | null = null
let processFanout: Fanout | null = null

/** The hub this process publishes through (bridge.ts), once the plugin mounted. */
export function getRealtimeHub(): RealtimeHub | null {
  return processHub
}

/** The infrastructure fan-out this process runs, once the plugin mounted (diagnostics). */
export function getRealtimeFanout(): Fanout | null {
  return processFanout
}

/** Installs the process hub; the plugin does this, tests may too. */
export function setRealtimeHub(hub: RealtimeHub | null): void {
  processHub = hub
}

function buildHub(opts: RealtimePluginOptions): RealtimeHub {
  const redisOff = opts.redisDisabled ?? redisDisabled()
  const ticketStore = makeTicketStore({ redis: opts.redis, db: opts.db, redisDisabled: redisOff })
  configureTicketStore(ticketStore)
  const projects = opts.projects ?? (() => [])
  // ONE infrastructure subscription per process; every envelope it hears
  // goes to this hub's router, which drops it unless a local socket asked.
  let hub: RealtimeHub | null = null
  const fanout = createFanout({
    redis: opts.redis,
    db: opts.db,
    redisDisabled,
    mode: opts.fanout,
    // R4: the same one channel also carries the HTTP presence route's
    // addressed commands, so a connection owned by another process is
    // reachable without a second transport (presence-route.ts).
    local: { dispatch: (envelope) => hub?.dispatch(envelope), command: presenceCommandHandler(() => hub) },
  })
  // R3: presence lives on the same rung as the fan-out - the store is the
  // cross-process truth only when there is more than one process.
  const presenceStore: PresenceStore = opts.presenceStore
    ?? (fanout.kind === 'redis' ? new RedisPresenceStore(opts.redis as never, { ttlSeconds: opts.presence?.ttlSeconds })
      : fanout.kind === 'postgres' ? new PostgresPresenceStore(opts.db)
        : new MemoryPresenceStore())
  const presence = new PresenceService({
    store: presenceStore,
    publish: (channel, type, data) => hub?.publishChannel(channel, type, data),
    resolveActor: (identity) => resolvePresenceActor(opts.db, identity),
    heartbeatSeconds: opts.presence?.heartbeatSeconds,
    ttlSeconds: opts.presence?.ttlSeconds,
    watchedChannels: () => hub?.presenceChannels() ?? [],
  })
  hub = new RealtimeHub({
    ticketStore,
    retention: fanout.retention,
    forward: (envelope) => fanout.forward(envelope),
    permissionLoader: (identity) => loadIdentityPermissions({ db: opts.db, redis: opts.redis, projects }, identity),
    presence,
  })
  processFanout = fanout
  processPresence = presence
  // The fan-out subscription (Redis subscriber / Postgres LISTEN) opens at
  // START (startRealtime), not at mount: mounting a route starts nothing.
  return hub
}

let processPresence: PresenceService | null = null
let fanoutStarted = false
const detachers: Array<() => void> = []

/** What the realtime capability has running, for diagnostics and the lifecycle tests. */
export function realtimeRuntimeState(): { mounted: boolean; fanoutStarted: boolean; presenceSweeping: boolean; listeners: number; connections: number } {
  return {
    mounted: processHub !== null,
    fanoutStarted,
    presenceSweeping: processPresence?.running() ?? false,
    listeners: detachers.length,
    connections: processHub?.stats().connections ?? 0,
  }
}

/** START: opens the fan-out subscription this process was mounted with. Idempotent; a failure degrades to local delivery. */
export async function startRealtime(): Promise<void> {
  const fanout = processFanout
  if (!fanout || fanoutStarted) return
  fanoutStarted = true
  try {
    await fanout.start()
  } catch (e) {
    logger.warn(`realtime fan-out (${fanout.kind}) could not start; this process delivers locally only: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * STOP: closes every connection (1001), ends the presence sweep, closes the
 * fan-out subscription and detaches the bus and role listeners. Safe to
 * repeat; a mounted route keeps answering with a fresh hub only after a new
 * compose.
 */
export async function stopRealtime(): Promise<void> {
  processHub?.closeAll()
  processPresence?.dispose()
  for (const detach of detachers.splice(0)) { try { detach() } catch { /* already detached */ } }
  const fanout = processFanout
  if (fanout && fanoutStarted) {
    fanoutStarted = false
    try { await fanout.stop() } catch (e) { logger.warn(`realtime fan-out stop: ${e instanceof Error ? e.message : String(e)}`) }
  }
}

const TICKET_REFUSED = () => new RequestError('REALTIME_TICKET_REFUSED', 'realtime ticket is missing, already used or expired - mint a new one', 401)
const AT_CAPACITY = () => new RequestError('REALTIME_AT_CAPACITY', 'this process is at its hard realtime connection cap', 503)
// The same uniform answer the POST mount gives where GraphQL is off: the route is indistinguishable from absent.
const GRAPHQL_NOT_ENABLED = () => new RequestError('NOT_FOUND', 'Route not found', 404)

/** R5: the default graphql-ws source, over the API mount's memoized schema (loaded lazily: a cycle-free import). */
function defaultGraphqlSource(opts: RealtimePluginOptions): GraphqlWsSource {
  let source: GraphqlWsSource | null = null
  return async (identity) => {
    if (!source) {
      const { realtimeGraphqlSource } = await import('../routes/graphql')
      source = realtimeGraphqlSource({ db: opts.db, redis: opts.redis, projects: opts.projects ?? (() => []) })
    }
    return source(identity)
  }
}

/** The ws adapter's view of Bun's send result: -1 buffered under pressure, 0 dropped. */
function wsSocket(raw: { send(data: string): number; close(code?: number, reason?: string): void }): HubSocket & { released(): void } {
  let pressured = false
  return {
    send(text) {
      if (pressured) return false
      const result = raw.send(text)
      if (result === -1) pressured = true
      return true
    },
    close(code, reason) {
      try { raw.close(code, reason) } catch { /* already gone */ }
    },
    released() { pressured = false },
  }
}

/** One SSE frame for a server message, with the cursor map as `id:` on events. */
export function sseFrame(text: string, cursors: Map<string, string>): string {
  let op = 'message'
  try {
    const parsed = JSON.parse(text) as { op?: string; topic?: string; id?: string }
    if (typeof parsed.op === 'string') op = parsed.op
    if (parsed.op === 'event' && typeof parsed.topic === 'string' && typeof parsed.id === 'string') {
      cursors.set(parsed.topic, parsed.id)
      return `event: event\nid: ${encodeCursorMap(cursors)}\ndata: ${text}\n\n`
    }
  } catch { /* not JSON: sent as a bare message frame */ }
  return `event: ${op}\ndata: ${text}\n\n`
}

/**
 * Mounts GET /api/v1/realtime (WebSocket) and GET /api/v1/realtime/stream
 * (SSE). Mount BEFORE authMiddleware: both rows are self-authenticating and
 * the ticket is the credential.
 */
export const realtimePlugin = (opts: RealtimePluginOptions = {}) => (app: Elysia): Elysia => {
  const hub = opts.hub ?? buildHub(opts)
  setRealtimeHub(hub)
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const retryMs = opts.retryMs ?? DEFAULT_RETRY_MS
  const graphqlSource: GraphqlWsSource | null = opts.graphql === false ? null : (opts.graphql ?? defaultGraphqlSource(opts))

  // The bus is the only way an event reaches a client (bridge.ts). R5: the
  // design rows name their actor from the members table, cached briefly.
  if (opts.bridge !== false) detachers.push(attachRealtimeBridge(hub, opts.eventBus ?? eventBus, { resolveActorName: memberNameResolver(opts.db ?? null) }))
  // A permission change anywhere in the process re-checks every open connection it touches.
  detachers.push(onMemberPermissionsInvalidated((memberId) => { void hub.reauthorizeMember(memberId) }))

  return (app as any)
    .ws('/api/v1/realtime', {
      async beforeHandle(ctx: any) {
        // Elysia runs this hook once as a route hook and once more inside its
        // ws handler, on the same context: redeem the ticket the first time only.
        if (ctx.realtimeIdentity) return
        const identity = await hub.identify(ctx.query?.ticket)
        if (!identity) throw TICKET_REFUSED()
        if (!hub.hasCapacity()) throw AT_CAPACITY()
        // R5: a client asking for the graphql-ws subprotocol gets the adapter
        // on this same route; the selected subprotocol rides the upgrade
        // response, which graphql-ws clients require before they speak.
        if (wantsGraphqlWs(ctx.request.headers.get('sec-websocket-protocol'))) {
          const target = graphqlSource ? await graphqlSource(identity) : null
          if (!target) throw GRAPHQL_NOT_ENABLED()
          ctx.realtimeGraphql = target
          ctx.set.headers['Sec-WebSocket-Protocol'] = GRAPHQL_WS_SUBPROTOCOL
        }
        ctx.realtimeIdentity = identity
      },
      open(ws: any) {
        const identity = ws.data?.realtimeIdentity
        if (!identity) { ws.close(4401, 'unauthenticated'); return }
        const target: GraphqlWsTarget | undefined = ws.data?.realtimeGraphql
        if (target) {
          const session = new GraphqlWsSession({ hub, identity, raw: ws.raw, target, initTimeoutMs: opts.graphqlInitTimeoutMs })
          if (!session.open()) return
          ws.data.realtimeConn = session.conn
          ws.data.realtimeSession = session
          return
        }
        const socket = wsSocket(ws.raw)
        const conn = hub.attach(identity, socket, 'ws')
        if (!conn) return
        ws.data.realtimeConn = conn
        ws.data.realtimeSocket = socket
      },
      message(ws: any, message: unknown) {
        const session: GraphqlWsSession | undefined = ws.data?.realtimeSession
        if (session) { session.handleFrame(message); return }
        const conn: HubConnection | undefined = ws.data?.realtimeConn
        if (conn) hub.handleMessage(conn, message)
      },
      drain(ws: any) {
        const conn: HubConnection | undefined = ws.data?.realtimeConn
        ws.data?.realtimeSocket?.released()
        if (conn) hub.drain(conn)
      },
      close(ws: any, code?: number, reason?: string) {
        const session: GraphqlWsSession | undefined = ws.data?.realtimeSession
        if (session) { session.closed(code, reason); return }
        const conn: HubConnection | undefined = ws.data?.realtimeConn
        if (conn) hub.disconnect(conn, code, reason)
      },
    })
    .get('/api/v1/realtime/stream', async (ctx: any) => {
      const identity = await hub.identify(ctx.query?.ticket)
      if (!identity) throw TICKET_REFUSED()
      if (!hub.hasCapacity()) throw AT_CAPACITY()
      const topics = String(ctx.query?.topics ?? '').split(',').map((t: string) => t.trim()).filter(Boolean)
      const since = decodeCursorMap(ctx.request.headers.get('last-event-id') ?? ctx.query?.since ?? null)
      const cursors = new Map<string, string>()
      let conn: HubConnection | null = null
      let heartbeat: ReturnType<typeof setInterval> | undefined

      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(`retry: ${retryMs}\n\n`)
          const socket: HubSocket = {
            send(text) {
              if (controller.desiredSize !== null && controller.desiredSize <= 0) return false
              try {
                controller.enqueue(sseFrame(text, cursors))
                return true
              } catch {
                return true   // stream closed: the cancel() path forgets the connection
              }
            },
            close(code, reason) {
              clearInterval(heartbeat)
              try { controller.enqueue(`event: close\ndata: ${JSON.stringify({ code, reason })}\n\n`) } catch { /* gone */ }
              try { controller.close() } catch { /* gone */ }
            },
          }
          conn = hub.attach(identity, socket, 'sse')
          if (!conn) return
          for (const topic of topics) hub.subscribe(conn, topic, since.get(topic))
          heartbeat = setInterval(() => {
            try { controller.enqueue(': ping\n\n') } catch { clearInterval(heartbeat) }
          }, heartbeatMs)
        },
        pull() {
          if (conn) hub.drain(conn)
        },
        cancel() {
          clearInterval(heartbeat)
          if (conn) hub.disconnect(conn)
        },
      }, { highWaterMark: 64 })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }) as Elysia
}
