/**
 * File Name: connection-log.ts
 * Purpose: The connection-lifecycle access-log record - one line when a
 *   WebSocket or SSE connection closes, with what the per-request log cannot
 *   say about a connection that outlived its request.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Realtime R5 preparation, done by the Gateway track
 *   against tasks/plan-realtime.md 4.6 after M6 (plan-parallel-tracks 3.1).
 *   The upgrade request itself already gets an access-log line like any
 *   other request; what it cannot carry is how long the connection lived,
 *   how much crossed it and why it ended, because all of that happens after
 *   the response. This record carries exactly that, and the same identity
 *   fields the request log uses, so the two can be joined on workspace,
 *   environment and member or key.
 *
 *   The seam is Realtime's: `onConnectionClosed` in realtime/hub.ts fires
 *   once per connection whichever side closed it. This module is
 *   deliberately free of any hub import - it takes a structural shape the
 *   hub's listener info satisfies - so the Gateway does not load the
 *   realtime module to log about it; `packages/api/src/index.ts` wires the
 *   two with one line at module scope.
 *
 *   Never logged, per the locked list: the ticket, the permissions the
 *   identity holds, message bodies, or anything a subscriber was sent. The
 *   close reason is a string the CLIENT chooses, so it is clipped.
 */
import { getLogger } from '@tangen/logging'

/** What the hub's close listener provides, as this module needs it. */
export interface ConnectionClosed {
  connection: {
    id: string
    openedAt: number
    messagesIn: number
    messagesOut: number
    /** Which adapter the socket came through (HubConnection.transport); null when the hub was not told. */
    transport?: 'ws' | 'sse' | null
    identity: {
      workspaceId: string
      memberId: string | null
      apiKeyId: string | null
      authMode: 'member' | 'api_key'
      /** R5: the site member behind a `site-key` ticket; the hub keeps `authMode: 'api_key'` and names the person here. */
      siteUserId?: string | null
    }
  }
  code: number | null
  reason: string | null
  subscriptions: number
}

const REASON_MAX = 120

/**
 * Builds the record for one closed connection.
 * @param info - What the hub's listener was told.
 * @param now - The close time; a parameter so the duration is testable.
 * @returns A flat record safe to serialise.
 */
export function connectionLogRecord(info: ConnectionClosed, now: number = Date.now()): Record<string, unknown> {
  const { connection: conn } = info
  return {
    kind: 'realtime-connection',
    connectionId: conn.id,
    workspaceId: conn.identity.workspaceId,
    userId: conn.identity.memberId,
    apiKeyId: conn.identity.apiKeyId,
    // The access log spells it 'api-key'; the hub spells it 'api_key'. A key
    // identity with a site member on it is the access log's 'site-key'.
    authMode: conn.identity.authMode === 'api_key' ? (conn.identity.siteUserId ? 'site-key' : 'api-key') : 'member',
    ...(conn.identity.siteUserId ? { siteUserId: conn.identity.siteUserId } : {}),
    durationMs: Math.max(0, now - conn.openedAt),
    messagesIn: conn.messagesIn,
    messagesOut: conn.messagesOut,
    subscriptions: info.subscriptions,
    closeCode: info.code,
    closeReason: info.reason === null ? null : info.reason.slice(0, REASON_MAX),
  }
}

/**
 * The human-readable half of the line.
 * @param record - From connectionLogRecord.
 * @returns The message text.
 */
export function connectionLogLine(record: Record<string, unknown>): string {
  const code = record.closeCode ?? '-'
  const reason = record.closeReason ?? ''
  return `realtime connection ${record.connectionId} closed ${code} ${reason} ${record.durationMs}ms ` +
    `in=${record.messagesIn} out=${record.messagesOut} subs=${record.subscriptions}`
}

const logger = getLogger(['tangen', 'api', 'gateway'])

/** What the gate tells this module when a connection is registered (realtime-limits.ts `opened`). */
export interface ConnectionOpened {
  identity: { workspaceId: string}
  transport?: 'ws' | 'sse' | null
}

/** One remembered close, for the Performance Monitor's "last closes" (slice 5). Ids and codes only, never a person. */
export interface RememberedClose {
  at: number
  code: number | null
  reason: string | null
  workspaceId: string
  transport: 'ws' | 'sse' | null
  authMode: 'member' | 'api-key' | 'site-key'
}

/** How many closes the monitor shows. A ring, not a log: the access log has the rest. */
export const LAST_CLOSES_MAX = 10

const lifecycle = {
  opened: 0,
  closed: 0,
  byCode: new Map<string, number>(),
  /** Open right now, by workspace. A gauge: +1 on open, -1 on close, never below zero. */
  openByScope: new Map<string, number>(),
  /** Open right now, per transport (`ws`, `sse`, or `unknown` when the hub was not told). */
  openByTransport: new Map<string, number>(),
  lastCloses: [] as RememberedClose[],
}

const transportKey = (transport: 'ws' | 'sse' | null | undefined): string => transport ?? 'unknown'

function adjust(map: Map<string, number>, key: string, by: 1 | -1): void {
  const next = (map.get(key) ?? 0) + by
  if (next <= 0) map.delete(key)
  else map.set(key, next)
}

/**
 * Connections this process has seen open and close since it started, the
 * close codes, what is open right now per workspace and environment and per
 * transport, and the last closes, for the Performance Monitor (plan 29.5,
 * slice 5). `open` is the difference - this process's share, not the
 * deployment's; the store-backed gauges in realtime-limits.ts are the
 * cross-process numbers and are what the ceilings enforce on.
 */
export function connectionCounts(): {
  opened: number
  closed: number
  open: number
  byCode: Record<string, number>
  openByScope: Record<string, number>
  openByTransport: Record<string, number>
  lastCloses: RememberedClose[]
} {
  return {
    opened: lifecycle.opened,
    closed: lifecycle.closed,
    open: Math.max(0, lifecycle.opened - lifecycle.closed),
    byCode: Object.fromEntries(lifecycle.byCode),
    openByScope: Object.fromEntries(lifecycle.openByScope),
    openByTransport: Object.fromEntries(lifecycle.openByTransport),
    lastCloses: [...lifecycle.lastCloses],
  }
}

/**
 * Counts one opened connection; the hub gate calls it on attach.
 * @param info - Where the connection is and over what, when the gate knows;
 *               a bare call still counts the total.
 */
export function countConnectionOpened(info?: ConnectionOpened): void {
  lifecycle.opened += 1
  if (!info) return
  adjust(lifecycle.openByScope, `${info.identity.workspaceId}`, 1)
  adjust(lifecycle.openByTransport, transportKey(info.transport), 1)
}

/** Tests only. */
export function resetConnectionCounts(): void {
  lifecycle.opened = 0; lifecycle.closed = 0; lifecycle.byCode.clear()
  lifecycle.openByScope.clear(); lifecycle.openByTransport.clear(); lifecycle.lastCloses.length = 0
}

/**
 * Writes one line for a closed connection. Normal closes (1000, 1001, 1005,
 * or no code at all) are debug, like a 2xx; an application close code
 * (4000 and up: capacity, revoked, unauthenticated) is a warning, because
 * it is the server ending a connection for a reason worth counting.
 * @param info - What the hub's listener was told.
 */
export function logConnectionClosed(info: ConnectionClosed): void {
  lifecycle.closed += 1
  const code = info.code === null ? 'none' : String(info.code)
  lifecycle.byCode.set(code, (lifecycle.byCode.get(code) ?? 0) + 1)
  const record = connectionLogRecord(info)
  const { identity } = info.connection
  adjust(lifecycle.openByScope, `${identity.workspaceId}`, -1)
  adjust(lifecycle.openByTransport, transportKey(info.connection.transport), -1)
  lifecycle.lastCloses.unshift({
    at: Date.now(),
    code: info.code,
    reason: record.closeReason as string | null,
    workspaceId: identity.workspaceId,
    transport: info.connection.transport ?? null,
    authMode: record.authMode as RememberedClose['authMode'],
  })
  if (lifecycle.lastCloses.length > LAST_CLOSES_MAX) lifecycle.lastCloses.length = LAST_CLOSES_MAX
  const line = connectionLogLine(record)
  if (typeof info.code === 'number' && info.code >= 4000) logger.warn(line, record)
  else logger.debug(line, record)
}
