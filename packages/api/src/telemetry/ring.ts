/**
 * File Name: ring.ts
 * Purpose: The recent operational history a developer reads (closure plan
 *          Phase 9C, Units 6 and 34): a fixed-size ring PER workspace x
 *          environment, so one workspace's events can never appear in
 *          another's view.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Deliberately EPHEMERAL. It does not survive a restart
 *          and does not pretend to: everything that must survive one already
 *          has a durable home - job runs, flow runs, release history, webhook
 *          deliveries, the audit log. This is the last few minutes, in memory,
 *          bounded, and gone when the process is.
 */
import type { TelemetryEvent } from './contract'

/** Events kept per scope. 500 x ~300 bytes is ~150 KB per active scope. */
export const RING_CAPACITY = 500
/** Scopes kept. A workspace x environment that stops emitting is evicted. */
export const MAX_SCOPES = 32

interface Scope {
  events: TelemetryEvent[]
  /** Write cursor - the ring overwrites rather than shifting. */
  next: number
  /** Total ever written, so eviction is observable without scanning. */
  written: number
  lastWriteAt: number
}

const scopes = new Map<string, Scope>()

/** One scope key: the workspace. A deployment has one database, so nothing else divides it. */
export const scopeKey = (workspaceId?: string): string => workspaceId ?? '-'

export function recordEvent(event: TelemetryEvent): void {
  const key = scopeKey(event.workspaceId)
  let scope = scopes.get(key)
  if (!scope) {
    if (scopes.size >= MAX_SCOPES) evictQuietestScope()
    scope = { events: new Array<TelemetryEvent>(RING_CAPACITY), next: 0, written: 0, lastWriteAt: 0 }
    scopes.set(key, scope)
  }
  scope.events[scope.next] = event
  scope.next = (scope.next + 1) % RING_CAPACITY
  scope.written++
  scope.lastWriteAt = event.timestamp
}

/** The scope nobody has written to for longest makes room for a new one. */
function evictQuietestScope(): void {
  let oldestKey: string | undefined
  let oldest = Number.POSITIVE_INFINITY
  for (const [key, scope] of scopes) {
    if (scope.lastWriteAt < oldest) { oldest = scope.lastWriteAt; oldestKey = key }
  }
  if (oldestKey) scopes.delete(oldestKey)
}

export interface RingQuery {
  workspaceId?: string
  /** Event names to include. Absent = all. */
  names?: string[]
  severity?: TelemetryEvent['severity']
  status?: TelemetryEvent['status']
  requestId?: string
  operationId?: string
  /** Only events at or after this epoch millisecond. */
  since?: number
  limit?: number
}

export interface RingPage {
  events: TelemetryEvent[]
  /** Events this scope has ever seen - `written - kept` have been evicted. */
  written: number
  /** How many the ring currently holds, before filtering. */
  kept: number
  /** True when a filter narrowed the result - the Admin needs to tell empty apart. */
  filtered: boolean
}

/**
 * Newest first. Reads ONE scope: a query without a workspace reads the
 * unscoped events (a boot, a job with no workspace), never everybody's.
 */
export function queryEvents(query: RingQuery = {}): RingPage {
  const scope = scopes.get(scopeKey(query.workspaceId))
  const filtered = Boolean(query.names?.length || query.severity || query.status || query.requestId || query.operationId || query.since)
  if (!scope) return { events: [], written: 0, kept: 0, filtered }

  const held: TelemetryEvent[] = []
  // Walk backwards from the write cursor: newest first, without sorting.
  for (let i = 0; i < RING_CAPACITY; i++) {
    const event = scope.events[(scope.next - 1 - i + RING_CAPACITY * 2) % RING_CAPACITY]
    if (event) held.push(event)
  }

  const names = query.names?.length ? new Set(query.names) : null
  const matched = held.filter((e) =>
    (!names || names.has(e.name)) &&
    (!query.severity || e.severity === query.severity) &&
    (!query.status || e.status === query.status) &&
    (!query.requestId || e.requestId === query.requestId) &&
    (!query.operationId || e.operationId === query.operationId) &&
    (!query.since || e.timestamp >= query.since),
  )

  const limit = Math.min(Math.max(query.limit ?? 100, 1), RING_CAPACITY)
  return { events: matched.slice(0, limit), written: scope.written, kept: held.length, filtered }
}

/** Every scope currently holding events. For the Admin's scope picker. */
export function ringScopes(): Array<{ workspaceId: string; kept: number; written: number }> {
  return [...scopes.entries()].map(([workspaceId, scope]) => ({
    workspaceId, kept: Math.min(scope.written, RING_CAPACITY), written: scope.written,
  }))
}

export function clearRing(query: { workspaceId?: string } = {}): void {
  if (query.workspaceId === undefined) { scopes.clear(); return }
  scopes.delete(scopeKey(query.workspaceId))
}
