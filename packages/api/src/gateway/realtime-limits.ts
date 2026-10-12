/**
 * File Name: realtime-limits.ts
 * Purpose: The Gateway half of Realtime R5 - connection ceilings per
 *   workspace and per identity, and a per-connection message budget, all
 *   resolved through the policy hierarchy and counted in the M5 store so
 *   several processes agree; observe-first like everything M5 counts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/plan-realtime.md 4.6 and plan-parallel-tracks
 *   3.1. The hub exposes one seam (`setHubGate` in realtime/hub.ts: admit,
 *   opened, message) and knows no policy; this module is the only thing
 *   installed there. It takes structural shapes of the identity and the
 *   connection rather than importing the hub, the way connection-log.ts
 *   does, so the Gateway does not load the realtime module to govern it.
 *
 *   Three things are counted, and where.
 *
 *   Open connections per workspace and environment, and per identity
 *   (member or api key) within a workspace, as GAUGES in the rate-limit
 *   store (`adjust`): +1 when the hub attaches a connection, -1 when it
 *   closes, 0 to read at admission. A gauge in the shared store is what
 *   makes `maxConnections: 100` mean a hundred across the deployment rather
 *   than a hundred per process; the hub's own per-process ceiling (500,
 *   `hasCapacity`) stays above this and is not what these numbers narrow.
 *   The gauge carries a TTL as leak insurance - a process that dies with
 *   sockets open never sends its -1s - and that is the honest limit of the
 *   design: until the key is idle for that long, a crashed process's
 *   connections still count. Observe-first makes that a log line, not an
 *   outage.
 *
 *   Inbound messages per connection, as a fixed window in the same store,
 *   hit from the hub's handleMessage through the gate - which is the point
 *   the plan asked to be sure of: every message the transport hands the hub
 *   is counted, not only the ones that parse. The window is keyed on the
 *   connection id, so a reconnect starts a new budget; tickets already have
 *   their own budget (`category:realtime`, per identity).
 *
 *   Presence messages per connection per scope (join, heartbeat, update; a
 *   leave is never budgeted, because a refused leave is a ghost until the
 *   TTL), as a second fixed window in the same store. This is R3's
 *   "one presence message per two seconds per scope per connection",
 *   which lived as a timestamp inside presence.ts, folded into the
 *   Gateway's mechanism: 30 a minute per scope, never more than the
 *   connection's own message budget (the service's old limit became the
 *   budget's floor for the presence op, as plan-parallel-tracks 6 asked).
 *   It is not a CATEGORY_DEFAULTS row because it is not a surface: the
 *   HTTP dimension vocabulary (ip, member, route) does not describe a
 *   socket message, and the key is the connection and the scope, exactly
 *   what R3 keyed on. The presence service asks through `setPresenceGate`
 *   (presence.ts) the way the hub asks through `setHubGate`; index.ts
 *   installs both halves of the gate built here. A presence message is
 *   ALSO one inbound message against the per-connection budget above,
 *   because the hub counts before it parses.
 *
 *   Enforcement follows the resolved `gateway.rateLimit.enabled` for the
 *   connection's workspace and environment (D-6): off by default, so a
 *   ceiling met is a would-deny in the log and the connection opens. When a
 *   scope has turned enforcement on, admission over the workspace ceiling
 *   answers 503 (the same answer the process ceiling gives), over the
 *   identity ceiling 429, and a connection over its message budget is
 *   closed with 4029 - an application code, so the connection log records
 *   it as a warning - and a presence op over its scope budget is refused
 *   `limit`, the reason the subscription cap uses; the client coalesces.
 */
import { getLogger } from '@tangen/logging'
import type { WorkspaceProject } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { effectiveGatewayPolicy } from './effective-policy'
import type { ResolvedGatewayPolicy } from './resolve-config'
import { adjustOrOpen, hitOrOpen, type RateLimitStore } from './rate-limit/store'
import { observeRateLimit, type RateLimitObservation } from './rate-limit'
import { countConnectionOpened, type ConnectionClosed } from './connection-log'

const logger = getLogger(['tangen', 'api', 'gateway', 'realtime'])

/** What the gate needs of an identity: who, where. */
export interface GateIdentity {
  workspaceId: string
  memberId: string | null
  apiKeyId: string | null
}

/** What the gate needs of a connection: its id, its identity, and a way to end it. */
export interface GateConnection {
  id: string
  identity: GateIdentity
  transport?: 'ws' | 'sse' | null
  closed: boolean
  close(code: number, reason: string): void
}

/** What the presence budget needs of a connection: its id (the window) and where it is (the policy). */
export type PresenceGateConnection = Pick<GateConnection, 'id' | 'identity' | 'transport'>

/** The presence ops that are budgeted. A leave never is. */
export type PresenceGateAction = 'join' | 'heartbeat' | 'update'

/** The presence service's reading of the decision (presence.ts PresenceResult, the `limit` half). */
export type PresenceGateDecision = { ok: true } | { ok: false; reason: 'limit' }

/** The hub's gate shape, structurally (realtime/hub.ts HubGate), plus the presence half (realtime/presence.ts PresenceGate). */
export interface RealtimeGate {
  admit(identity: GateIdentity): Promise<void>
  opened(conn: GateConnection): void
  message(conn: GateConnection): void
  presence(conn: PresenceGateConnection, scope: string, action: PresenceGateAction): Promise<PresenceGateDecision>
}

/** Close code for a connection over its message budget. 4000+: the connection log warns. */
export const CLOSE_RATE_LIMITED = 4029

/** How long a connection gauge survives without a change - the leak insurance above. */
export const CONNECTION_GAUGE_TTL_SECONDS = 6 * 60 * 60

/** The per-connection message window's policy id, as the log and the monitor name it. */
export const REALTIME_MESSAGE_POLICY_ID = 'realtime:messages'
const MESSAGE_WINDOW_SECONDS = 60

/** The per-connection, per-scope presence window's policy id. */
export const REALTIME_PRESENCE_POLICY_ID = 'realtime:presence'
/** R3's one presence message per two seconds per scope per connection, as a minute window. UNMEASURED like every budget here. */
export const PRESENCE_MESSAGES_PER_MINUTE = 30

/** The presence window key for one connection on one scope. Ids only, never a secret. */
export function presenceBudgetKey(conn: { id: string }, scope: string): string {
  return `tangen:rl:${REALTIME_PRESENCE_POLICY_ID}:connection=${conn.id}:scope=${scope}`
}

/** The presence budget under a resolved policy: its own floor, never above the connection's message budget. */
export function presenceLimitFor(resolved: Pick<ResolvedGatewayPolicy, 'realtime'>): number {
  return Math.min(PRESENCE_MESSAGES_PER_MINUTE, resolved.realtime.maxMessagesPerMinute)
}

/** The workspace and identity gauge keys for one identity. Ids only, never a secret. */
export function connectionGaugeKeys(identity: GateIdentity): { workspace: string; identity: string | null } {
  const who = identity.memberId ?? identity.apiKeyId
  return {
    workspace: `tangen:rt:conn:workspace=${identity.workspaceId}`,
    identity: who ? `tangen:rt:conn:workspace=${identity.workspaceId}:identity=${who}` : null,
  }
}

/** The resolved policy for the identity's workspace and environment, and whether it enforces. */
export function realtimeLimitsFor(
  projects: WorkspaceProject[],
  identity: GateIdentity,
): { resolved: ResolvedGatewayPolicy; mode: 'observe' | 'enforce' } {
  const project = projects.find((p) => p.workspaceId === identity.workspaceId)
  const resolved = effectiveGatewayPolicy(project)
  return { resolved, mode: resolved.rateLimit.enabled ? 'enforce' : 'observe' }
}

export interface RealtimeLimitsOptions {
  store: RateLimitStore
  /** Read per decision, so a refreshed project list is seen. */
  projects: () => WorkspaceProject[]
  /** Test seam: replaces the log. */
  onObservation?: (o: RateLimitObservation) => void
}

/**
 * Builds the gate. Pure over its options: a test hands in a memory store
 * and a project list and reads the observations.
 * @param opts - The store, the projects, and the observation seam.
 * @returns The gate to install on the hub, plus the close half.
 */
export function realtimeHubGate(opts: RealtimeLimitsOptions): RealtimeGate & { closed(info: ConnectionClosed): void } {
  const observe = (o: RateLimitObservation) => opts.onObservation ? opts.onObservation(o) : observeRateLimit(o)

  return {
    async admit(identity) {
      const { resolved, mode } = realtimeLimitsFor(opts.projects(), identity)
      const keys = connectionGaugeKeys(identity)
      const base = { route: 'realtime', workspaceId: identity.workspaceId }

      const open = await adjustOrOpen(opts.store, keys.workspace, 0, CONNECTION_GAUGE_TTL_SECONDS)
      if (open !== null && open >= resolved.realtime.maxConnections) {
        observe({ kind: mode === 'enforce' ? 'denied' : 'would-deny', policy: 'realtime:connections', key: keys.workspace, count: open + 1, limit: resolved.realtime.maxConnections, ...base })
        if (mode === 'enforce') {
          throw new RequestError('REALTIME_AT_CAPACITY', 'this workspace is at its realtime connection ceiling - close a connection or raise gateway.realtime.maxConnections', 503)
        }
      }
      if (!keys.identity) return
      const mine = await adjustOrOpen(opts.store, keys.identity, 0, CONNECTION_GAUGE_TTL_SECONDS)
      if (mine !== null && mine >= resolved.realtime.maxConnectionsPerIdentity) {
        observe({ kind: mode === 'enforce' ? 'denied' : 'would-deny', policy: 'realtime:connections-per-identity', key: keys.identity, count: mine + 1, limit: resolved.realtime.maxConnectionsPerIdentity, ...base })
        if (mode === 'enforce') {
          throw new RequestError('REALTIME_TOO_MANY_CONNECTIONS', 'this identity has too many realtime connections open - close one or raise gateway.realtime.maxConnectionsPerIdentity', 429)
        }
      }
    },

    opened(conn) {
      countConnectionOpened({ identity: conn.identity, transport: conn.transport ?? null })
      const keys = connectionGaugeKeys(conn.identity)
      void adjustOrOpen(opts.store, keys.workspace, 1, CONNECTION_GAUGE_TTL_SECONDS)
      if (keys.identity) void adjustOrOpen(opts.store, keys.identity, 1, CONNECTION_GAUGE_TTL_SECONDS)
    },

    closed(info) {
      const keys = connectionGaugeKeys(info.connection.identity)
      void adjustOrOpen(opts.store, keys.workspace, -1, CONNECTION_GAUGE_TTL_SECONDS)
      if (keys.identity) void adjustOrOpen(opts.store, keys.identity, -1, CONNECTION_GAUGE_TTL_SECONDS)
    },

    message(conn) {
      // Counted on every message the transport hands over; the decision
      // lands a tick later, which observe-first can afford.
      const key = `tangen:rl:${REALTIME_MESSAGE_POLICY_ID}:connection=${conn.id}`
      void hitOrOpen(opts.store, key, MESSAGE_WINDOW_SECONDS).then((state) => {
        if (!state) return
        const { resolved, mode } = realtimeLimitsFor(opts.projects(), conn.identity)
        const limit = resolved.realtime.maxMessagesPerMinute
        const base = { policy: REALTIME_MESSAGE_POLICY_ID, key, count: state.count, limit, route: conn.transport ? `realtime-${conn.transport}` : 'realtime', workspaceId: conn.identity.workspaceId }
        if (state.count > limit) {
          observe({ kind: mode === 'enforce' ? 'denied' : 'would-deny', ...base })
          if (mode === 'enforce' && !conn.closed) conn.close(CLOSE_RATE_LIMITED, 'rate_limited')
        } else if (state.count > limit * 0.8) {
          observe({ kind: 'near-miss', ...base })
        }
      })
    },

    async presence(conn, scope, _action) {
      // Awaited, unlike the message window: the service needs the answer
      // to refuse on the wire. One store round trip per presence op; a
      // store that fails answers null and the op is admitted (D-5).
      const key = presenceBudgetKey(conn, scope)
      const state = await hitOrOpen(opts.store, key, MESSAGE_WINDOW_SECONDS)
      if (!state) return { ok: true }
      const { resolved, mode } = realtimeLimitsFor(opts.projects(), conn.identity)
      const limit = presenceLimitFor(resolved)
      const base = { policy: REALTIME_PRESENCE_POLICY_ID, key, count: state.count, limit, route: conn.transport ? `realtime-${conn.transport}` : 'realtime', workspaceId: conn.identity.workspaceId }
      if (state.count > limit) {
        observe({ kind: mode === 'enforce' ? 'denied' : 'would-deny', ...base })
        if (mode === 'enforce') return { ok: false, reason: 'limit' }
      } else if (state.count > limit * 0.8) {
        observe({ kind: 'near-miss', ...base })
      }
      return { ok: true }
    },
  }
}

let current: ReturnType<typeof realtimeHubGate> | null = null

/**
 * Builds the gate for this server and makes it the one the close listener
 * reaches. index.ts installs the returned gate on the hub (`setHubGate`);
 * the close subscription is made once at module scope and delegates here,
 * so a second createServer in one process (every test file) replaces the
 * store rather than stacking listeners.
 * @param opts - The store and the projects.
 * @returns The gate to hand to setHubGate.
 */
export function installRealtimeLimits(opts: RealtimeLimitsOptions): RealtimeGate {
  current = realtimeHubGate(opts)
  logger.debug(`realtime ceilings: counted in the ${opts.store.kind} store${opts.store.distributed ? '' : ' (one process only)'}; enforcement follows gateway.rateLimit.enabled per workspace, default observe`)
  return current
}

/** The close half, for the hub's onConnectionClosed seam. No-op until installed. */
export function realtimeConnectionClosed(info: ConnectionClosed): void {
  current?.closed(info)
}

/** Tests only. */
export function resetRealtimeLimits(): void { current = null }
