/**
 * File Name: presence.ts
 * Purpose: The presence service - who is on a scope right now, as joined
 *          sessions with a small state each, kept alive by heartbeats,
 *          gone on leave or expiry, announced on `presence:<scope>`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: R3 of tasks/plan-realtime.md (section 4.5) built to
 *          the architecture's sections 15, 19-24 and 44: presence is
 *          ephemeral, advisory before anything else, never the audit log,
 *          and it runs only while something is joined. The rules that
 *          shaped this file:
 *
 *          A session is one connection on one scope. Its identity comes
 *          from the connection (the member or the API key behind the
 *          ticket), and its display name and avatar are resolved ONCE, at
 *          the first join on that connection, from the members table - a
 *          heartbeat every twenty seconds from every open editor must not
 *          become a query every twenty seconds from every open editor.
 *
 *          A heartbeat is not an event. It extends the expiry in the store
 *          and nothing reaches a client; only join, leave and a state
 *          change fan out, through the hub's publish like every other
 *          envelope (retained, dispatched locally, forwarded), so the other
 *          processes see them. The store (presence-store.ts) is the cross-
 *          process truth for "who is here"; this process also keeps its own
 *          connections' sessions, so a heartbeat whose record vanished
 *          (expired while the tab was hidden, pruned) puts it back and
 *          announces the join again.
 *
 *          Expiry is a sweep, not a timer per session: one interval at the
 *          heartbeat period, started by the first join (or by the hub when
 *          a socket subscribes to a presence topic without joining, so a
 *          watcher still sees a dead process's sessions go) and cleared
 *          when nothing local is joined or watched. The sweep asks the
 *          store to remove what expired and publishes a leave for each
 *          record the store confirms it removed, so two processes sweeping
 *          one scope publish one leave between them.
 *
 *          Join, heartbeat and update are budgeted; a leave never is,
 *          because a refused leave is a ghost until the TTL. The budget is
 *          not this file's: R5 folded R3's one-per-two-seconds timestamp
 *          into the Gateway's per-connection, per-scope window in the
 *          rate-limit store (gateway/realtime-limits.ts), observe-first,
 *          and the service only asks - through the process-wide gate
 *          index.ts installs (`setPresenceGate`, the way the hub has
 *          `setHubGate`) or the one a test hands in. A refusal is `limit`,
 *          the same reason the subscription cap uses; the client
 *          coalesces. No gate, or a gate that throws, admits.
 *
 *          The advisory claim (presence-claim.ts) is reconciled after
 *          every change that can move it; the service owns nothing about
 *          its rules beyond calling the pure function and writing what it
 *          asks for.
 */
import { eq, and } from 'drizzle-orm'
import { REALTIME_PRESENCE_DEFAULTS } from '@tangen/types'
import { members, apiKeys } from '@tangen/db'
import { siteIdentityFor } from '../kernel/site-identity'
import { channelFor, topicOf, type RealtimeIdentity } from './authorize'
import { reconcileClaim } from './presence-claim'
import type { PresenceSession, PresenceState, PresenceStore } from './presence-store'

/**
 * The production actor resolver: the member's name (else email) and avatar
 * from the members row, an API key's label. Called once per connection.
 */
export async function resolvePresenceActor(db: any, identity: RealtimeIdentity): Promise<PresenceActor> {
  if (identity.siteUserId) {
    // R5: a site member; the display name only, never the email. The
    // workspace's site identity provider knows them (plan-core-slimming S4).
    const user = await (await siteIdentityFor(identity.workspaceId))?.users?.get(identity.siteUserId).catch(() => null)
    return { name: user?.name ? String(user.name) : 'Site member', avatar: null }
  }
  if (identity.authMode === 'api_key') {
    if (!identity.apiKeyId) return { name: 'API key', avatar: null }
    const [key] = await db.select({ label: apiKeys.label }).from(apiKeys)
      .where(and(eq(apiKeys.id, identity.apiKeyId), eq(apiKeys.workspaceId, identity.workspaceId))).limit(1)
    return { name: key?.label ? String(key.label) : 'API key', avatar: null }
  }
  if (!identity.memberId) return { name: 'Someone', avatar: null }
  const [member] = await db.select({ name: members.name, email: members.email, avatar: members.avatar }).from(members)
    .where(and(eq(members.id, identity.memberId), eq(members.workspaceId, identity.workspaceId))).limit(1)
  if (!member) return { name: 'Someone', avatar: null }
  return { name: String(member.name || member.email || 'Someone'), avatar: member.avatar ? String(member.avatar) : null }
}

/** What the service needs of a connection; HubConnection satisfies it. */
export interface PresenceConnection {
  id: string
  identity: RealtimeIdentity
}

export interface PresenceActor {
  name: string
  avatar: string | null
}

/** Resolves the display identity once per connection (members table, API key label). */
export type ActorResolver = (identity: RealtimeIdentity) => Promise<PresenceActor>

/** The budgeted presence ops. */
export type PresenceGateAction = 'join' | 'heartbeat' | 'update'

/** The Gateway's presence budget, structurally (gateway/realtime-limits.ts RealtimeGate.presence). */
export type PresenceGate = (conn: PresenceConnection, scope: string, action: PresenceGateAction) => Promise<{ ok: true } | { ok: false; reason: 'limit' }>

let presenceGate: PresenceGate | null = null

/** Installs (or clears) the process-wide presence gate; the Gateway does this at boot. */
export function setPresenceGate(gate: PresenceGate | null): void {
  presenceGate = gate
}

/** The state a client sends: what it is doing on the scope, in at most 1 KB. */
export interface PresenceStateInput {
  state: PresenceState
  field?: string
  block?: string
  /** The content type of an `object:<id>` scope; names the aggregate the session is mirrored on. */
  typeSlug?: string
  meta?: Record<string, string | number | boolean>
}

/** A session as clients see it (no expiry). */
export type PresenceSessionWire = Omit<PresenceSession, 'exp'>

/** Who holds the advisory claim on a scope. */
export interface PresenceClaim {
  /** The holding session (connection id). */
  session: string
  memberId: string | null
  apiKeyId: string | null
  name: string
  since: number
}

export interface PresenceSnapshot {
  scope: string
  /** The caller's own session id. */
  self: string
  members: PresenceSessionWire[]
  claim: PresenceClaim | null
}

export type PresenceRefusal = 'limit' | 'not_joined'
export type PresenceResult = { ok: true } | { ok: false; reason: PresenceRefusal }
export type PresenceJoinResult = { ok: true; snapshot: PresenceSnapshot } | { ok: false; reason: PresenceRefusal }

export interface PresenceTimers {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface PresenceServiceOptions {
  store: PresenceStore
  /** The hub's publishChannel: retain, dispatch locally, forward. */
  publish: (channel: string, type: string, data: Record<string, unknown>) => unknown
  resolveActor: ActorResolver
  heartbeatSeconds?: number
  ttlSeconds?: number
  /** Channels this process watches without a local session (the hub's presence subscriptions). */
  watchedChannels?: () => string[]
  /** The presence budget to ask (tests); otherwise the process-wide one from setPresenceGate. */
  gate?: PresenceGate
  now?: () => number
  timers?: PresenceTimers
}

/** The session's mirror on the per-type aggregate channel, while it has one. */
interface AggregateMirror {
  channel: string
  scope: string
  objectId: string
  session: PresenceSession
}

interface LocalScope {
  channel: string
  session: PresenceSession
  aggregate: AggregateMirror | null
}

interface LocalConnection {
  conn: PresenceConnection
  actor: Promise<PresenceActor> | null
  scopes: Map<string, LocalScope>
}

export const PRESENCE_TOPIC_PREFIX = 'presence:'

// ── The per-type aggregate ────────────────────────────────────────────────────
//
// An objects list must show who is on each row without a presence
// subscription per row (architecture sections 9 and 45: 32 subscriptions
// per connection). So a session on `object:<id>` whose state names its
// `typeSlug` is mirrored, as a second record and a second envelope, on
// `objects:<typeSlug>` - derived, never joined; the hub refuses a direct
// join and answers a subscription to it with a snapshot. The mirror's id is
// `<connection>@<objectId>`, so one connection on two objects of a type is
// two rows, and the aggregate carries no claim (claims belong to the object).

const OBJECT_SCOPE_PREFIX = 'object:'
const AGGREGATE_SCOPE_PREFIX = 'objects:'

/** Is the scope a per-type aggregate (`objects:<typeSlug>`)? */
export function isAggregateScope(scope: string): boolean {
  return scope.startsWith(AGGREGATE_SCOPE_PREFIX) && scope.length > AGGREGATE_SCOPE_PREFIX.length
}

/** The aggregate scope an object session is mirrored on, or null when it has no type or is not an object. */
export function aggregateScopeOf(scope: string, typeSlug: string | undefined): string | null {
  if (!typeSlug || !scope.startsWith(OBJECT_SCOPE_PREFIX) || scope.length === OBJECT_SCOPE_PREFIX.length) return null
  return AGGREGATE_SCOPE_PREFIX + typeSlug
}

/** The aggregate record's id: one per connection per object. */
export function aggregateSessionId(connectionId: string, objectId: string): string {
  return `${connectionId}@${objectId}`
}

/** The scope of a presence channel (`<ws>/<env>/presence:object:o1` -> `object:o1`). */
export function scopeOf(channel: string): string {
  const topic = topicOf(channel)
  return topic.startsWith(PRESENCE_TOPIC_PREFIX) ? topic.slice(PRESENCE_TOPIC_PREFIX.length) : topic
}

/** The session minus what only the store needs. */
export function toWire(session: PresenceSession): PresenceSessionWire {
  const { exp: _exp, ...wire } = session
  return wire
}

export class PresenceService {
  private readonly store: PresenceStore
  private readonly publish: PresenceServiceOptions['publish']
  private readonly resolveActor: ActorResolver
  private readonly heartbeatSeconds: number
  private readonly ttlSeconds: number
  private readonly watchedChannels: () => string[]
  private readonly gate: PresenceGate | null
  private readonly now: () => number
  private readonly timers: PresenceTimers
  private readonly connections = new Map<string, LocalConnection>()
  private timer: unknown = null
  private sweeping: Promise<void> | null = null

  constructor(opts: PresenceServiceOptions) {
    this.store = opts.store
    this.publish = opts.publish
    this.resolveActor = opts.resolveActor
    this.heartbeatSeconds = opts.heartbeatSeconds ?? REALTIME_PRESENCE_DEFAULTS.heartbeatSeconds
    this.ttlSeconds = opts.ttlSeconds ?? REALTIME_PRESENCE_DEFAULTS.ttlSeconds
    this.watchedChannels = opts.watchedChannels ?? (() => [])
    this.gate = opts.gate ?? null
    this.now = opts.now ?? Date.now
    this.timers = opts.timers ?? { setInterval: (fn, ms) => { const t = setInterval(fn, ms); (t as { unref?: () => void }).unref?.(); return t }, clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) }
  }

  limits(): { heartbeatSeconds: number; ttlSeconds: number } {
    return { heartbeatSeconds: this.heartbeatSeconds, ttlSeconds: this.ttlSeconds }
  }

  /** Is the sweep timer running? False whenever nothing is joined or watched. */
  running(): boolean {
    return this.timer !== null
  }

  /** Sessions this process's own connections hold, across scopes. */
  localSessions(): number {
    let n = 0
    for (const c of this.connections.values()) n += c.scopes.size
    return n
  }

  /** The current members of a scope as a client would see them (snapshot without joining). */
  async members(identity: Pick<RealtimeIdentity, 'workspaceId'>, scope: string): Promise<PresenceSessionWire[]> {
    const list = await this.store.list(channelFor(identity, PRESENCE_TOPIC_PREFIX + scope), this.now())
    return list.map(toWire)
  }

  // ── Operations ──────────────────────────────────────────────────────────────

  async join(conn: PresenceConnection, scope: string, state: PresenceStateInput): Promise<PresenceJoinResult> {
    const admitted = await this.admit(conn, scope, 'join')
    if (!admitted.ok) return admitted
    const local = this.localOf(conn)
    const existing = local.scopes.get(scope)
    const actor = await this.actorOf(local)
    const now = this.now()
    const channel = channelFor(conn.identity, PRESENCE_TOPIC_PREFIX + scope)
    const session: PresenceSession = {
      id: conn.id,
      memberId: conn.identity.memberId,
      apiKeyId: conn.identity.apiKeyId,
      name: actor.name,
      avatar: actor.avatar,
      ...stateFields(state),
      since: existing?.session.since ?? now,
      updatedAt: now,
      editingSince: state.state === 'editing' ? (existing?.session.editingSince ?? now) : null,
      claimedAt: existing?.session.claimedAt ?? null,
      exp: now + this.ttlSeconds * 1000,
    }
    const entry: LocalScope = { channel, session, aggregate: existing?.aggregate ?? null }
    local.scopes.set(scope, entry)
    const before = await this.store.list(channel, now)
    const after = [...before.filter((s) => s.id !== session.id), session]
    const outcome = await this.settleClaim(channel, before, after, null, now)
    await this.store.upsert(channel, session)
    this.publish(channel, 'presence.join', { scope, session: toWire(session), ...outcome })
    await this.mirror(entry, scope, 'presence.join', conn.identity)
    this.ensureTimer()
    return { ok: true, snapshot: { scope, self: conn.id, members: after.map(toWire), claim: outcome.claim } }
  }

  async heartbeat(conn: PresenceConnection, scope: string): Promise<PresenceResult> {
    const local = this.connections.get(conn.id)?.scopes.get(scope)
    if (!local) return { ok: false, reason: 'not_joined' }
    const admitted = await this.admit(conn, scope, 'heartbeat')
    if (!admitted.ok) return admitted
    const now = this.now()
    local.session.exp = now + this.ttlSeconds * 1000
    const touched = await this.store.touch(local.channel, conn.id, local.session.exp)
    if (!touched) {
      // The record went (expired while the tab was hidden, or pruned): put it back and say so.
      local.session.claimedAt = null
      const before = await this.store.list(local.channel, now)
      const after = [...before.filter((s) => s.id !== conn.id), local.session]
      const outcome = await this.settleClaim(local.channel, before, after, null, now)
      await this.store.upsert(local.channel, local.session)
      this.publish(local.channel, 'presence.join', { scope, session: toWire(local.session), ...outcome })
    }
    const agg = local.aggregate
    if (agg) {
      // The mirror's expiry follows the session's; a mirror that went is announced again like the session.
      agg.session.exp = local.session.exp
      const mirrored = await this.store.touch(agg.channel, agg.session.id, agg.session.exp)
      if (!mirrored) {
        await this.store.upsert(agg.channel, agg.session)
        this.publish(agg.channel, 'presence.join', this.aggregateEnvelope(agg))
      }
    }
    return { ok: true }
  }

  /**
   * Replaces the state. With `takeover` and `state: 'editing'` the advisory
   * claim moves to this session and the envelope names `claimMovedFrom`.
   */
  async update(conn: PresenceConnection, scope: string, state: PresenceStateInput, takeover = false): Promise<PresenceResult> {
    const local = this.connections.get(conn.id)?.scopes.get(scope)
    if (!local) return { ok: false, reason: 'not_joined' }
    const admitted = await this.admit(conn, scope, 'update')
    if (!admitted.ok) return admitted
    const now = this.now()
    const prev = local.session
    const next: PresenceSession = {
      id: prev.id, memberId: prev.memberId, apiKeyId: prev.apiKeyId, name: prev.name, avatar: prev.avatar,
      ...stateFields(state),
      since: prev.since,
      updatedAt: now,
      editingSince: state.state === 'editing' ? (prev.editingSince ?? now) : null,
      claimedAt: state.state === 'editing' ? prev.claimedAt : null,
      exp: now + this.ttlSeconds * 1000,
    }
    local.session = next
    const before = await this.store.list(local.channel, now)
    const after = [...before.filter((s) => s.id !== conn.id), next]
    const outcome = await this.settleClaim(local.channel, before, after, takeover ? conn.id : null, now)
    await this.store.upsert(local.channel, next)
    this.publish(local.channel, 'presence.update', { scope, session: toWire(next), ...outcome })
    await this.mirror(local, scope, 'presence.update', conn.identity)
    return { ok: true }
  }

  async leave(conn: PresenceConnection, scope: string): Promise<PresenceResult> {
    const entry = this.connections.get(conn.id)
    const local = entry?.scopes.get(scope)
    if (!entry || !local) return { ok: true }
    entry.scopes.delete(scope)
    if (entry.scopes.size === 0) this.connections.delete(conn.id)
    const now = this.now()
    const before = await this.store.list(local.channel, now)
    await this.store.remove(local.channel, conn.id)
    const after = before.filter((s) => s.id !== conn.id)
    const outcome = await this.settleClaim(local.channel, before, after, null, now)
    this.publish(local.channel, 'presence.leave', { scope, sessionId: conn.id, memberId: local.session.memberId, apiKeyId: local.session.apiKeyId, ...outcome })
    if (local.aggregate) await this.unmirror(local.aggregate)
    this.settleTimer()
    return { ok: true }
  }

  /** The connection closed: every scope it joined is left. */
  async leaveAll(conn: PresenceConnection): Promise<void> {
    const entry = this.connections.get(conn.id)
    if (!entry) return
    for (const scope of [...entry.scopes.keys()]) await this.leave(conn, scope)
    this.connections.delete(conn.id)
    this.settleTimer()
  }

  // ── Expiry ──────────────────────────────────────────────────────────────────

  /** The hub saw a subscription to a presence topic: make sure the sweep runs. */
  wake(): void {
    this.ensureTimer()
  }

  /** STOP: the sweep timer is cleared whatever the interest; a later wake() arms it again. */
  dispose(): void {
    if (this.timer === null) return
    this.timers.clearInterval(this.timer)
    this.timer = null
  }

  /** Removes what expired on every channel this process has a session on or watches; one leave each. */
  sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping
    this.sweeping = this.doSweep().finally(() => { this.sweeping = null })
    return this.sweeping
  }

  private async doSweep(): Promise<void> {
    const now = this.now()
    const channels = new Set<string>(this.watchedChannels())
    for (const c of this.connections.values()) {
      for (const s of c.scopes.values()) {
        channels.add(s.channel)
        if (s.aggregate) channels.add(s.aggregate.channel)
      }
    }
    for (const channel of channels) {
      let gone: PresenceSession[]
      let after: PresenceSession[]
      try {
        gone = await this.store.sweep(channel, now)
        if (gone.length === 0) continue
        after = await this.store.list(channel, now)
      } catch {
        continue   // a store that is down: the next sweep tries again
      }
      const scope = scopeOf(channel)
      if (isAggregateScope(scope)) {
        // A mirror expired: one leave each on the aggregate, no claim to settle there.
        for (const s of gone) {
          this.publish(channel, 'presence.leave', { scope, objectId: s.objectId, typeSlug: s.typeSlug, sessionId: s.id, memberId: s.memberId, apiKeyId: s.apiKeyId, expired: true })
        }
        continue
      }
      const outcome = await this.settleClaim(channel, [...after, ...gone], after, null, now)
      for (const s of gone) {
        const moved = outcome.claimMovedFrom?.session === s.id ? { claimMovedFrom: outcome.claimMovedFrom } : {}
        this.publish(channel, 'presence.leave', { scope, sessionId: s.id, memberId: s.memberId, apiKeyId: s.apiKeyId, expired: true, claim: outcome.claim, ...moved })
      }
    }
    this.settleTimer()
  }

  /**
   * Applies the claim rules to a change and writes what they ask for;
   * returns the envelope fields (`claim`, and `claimMovedFrom` when it moved).
   */
  private async settleClaim(
    channel: string,
    before: PresenceSession[],
    after: PresenceSession[],
    takeoverBy: string | null,
    now: number,
  ): Promise<{ claim: PresenceClaim | null; claimMovedFrom?: PresenceClaim }> {
    const outcome = reconcileClaim(before, after, { takeoverBy }, now)
    for (const w of outcome.writes) {
      const s = after.find((x) => x.id === w.id)
      if (!s) continue
      s.claimedAt = w.claimedAt
      try { await this.store.upsert(channel, s) } catch { /* advisory: the next change rewrites it */ }
    }
    return outcome.movedFrom ? { claim: outcome.claim, claimMovedFrom: outcome.movedFrom } : { claim: outcome.claim }
  }

  // ── The aggregate mirror ────────────────────────────────────────────────────

  /** The envelope fields every aggregate join/update carries. */
  private aggregateEnvelope(agg: AggregateMirror): Record<string, unknown> {
    return { scope: agg.scope, objectId: agg.objectId, typeSlug: agg.session.typeSlug, session: toWire(agg.session) }
  }

  /**
   * Brings the session's mirror on its aggregate in line with the session:
   * written and announced as `type` while the aggregate is the same one, as
   * a join when the session moved to another type (the old mirror leaves),
   * removed when the session no longer names a type.
   */
  private async mirror(entry: LocalScope, scope: string, type: 'presence.join' | 'presence.update', identity: RealtimeIdentity): Promise<void> {
    const previous = entry.aggregate
    const aggScope = aggregateScopeOf(scope, entry.session.typeSlug)
    const channel = aggScope ? channelFor(identity, PRESENCE_TOPIC_PREFIX + aggScope) : null
    if (previous && previous.channel !== channel) {
      entry.aggregate = null
      await this.unmirror(previous)
    }
    if (!aggScope || !channel) return
    const objectId = scope.slice(OBJECT_SCOPE_PREFIX.length)
    const session: PresenceSession = { ...entry.session, id: aggregateSessionId(entry.session.id, objectId), objectId, claimedAt: null }
    const agg: AggregateMirror = { channel, scope: aggScope, objectId, session }
    entry.aggregate = agg
    try { await this.store.upsert(channel, session) } catch { /* advisory: the next heartbeat puts it back */ }
    this.publish(channel, previous && previous.channel === channel ? type : 'presence.join', this.aggregateEnvelope(agg))
  }

  /** Removes a mirror and announces its leave on the aggregate. */
  private async unmirror(agg: AggregateMirror): Promise<void> {
    try { await this.store.remove(agg.channel, agg.session.id) } catch { /* the sweep removes what is left */ }
    this.publish(agg.channel, 'presence.leave', {
      scope: agg.scope, objectId: agg.objectId, typeSlug: agg.session.typeSlug,
      sessionId: agg.session.id, memberId: agg.session.memberId, apiKeyId: agg.session.apiKeyId,
    })
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private localOf(conn: PresenceConnection): LocalConnection {
    let entry = this.connections.get(conn.id)
    if (!entry) {
      entry = { conn, actor: null, scopes: new Map() }
      this.connections.set(conn.id, entry)
    }
    return entry
  }

  /** Resolved once per connection; a resolver that fails names the identity by id rather than refusing the join. */
  private actorOf(entry: LocalConnection): Promise<PresenceActor> {
    if (!entry.actor) {
      entry.actor = this.resolveActor(entry.conn.identity).catch(() => ({
        name: entry.conn.identity.memberId ?? entry.conn.identity.apiKeyId ?? 'Someone',
        avatar: null,
      }))
    }
    return entry.actor
  }

  /** Asks the budget; no gate, or a gate that fails, admits (the Gateway's own fail-open, D-5). */
  private async admit(conn: PresenceConnection, scope: string, action: PresenceGateAction): Promise<PresenceResult> {
    const gate = this.gate ?? presenceGate
    if (!gate) return { ok: true }
    try {
      return await gate(conn, scope, action)
    } catch {
      return { ok: true }
    }
  }

  private hasInterest(): boolean {
    return this.connections.size > 0 || this.watchedChannels().length > 0
  }

  private ensureTimer(): void {
    if (this.timer !== null) return
    this.timer = this.timers.setInterval(() => { void this.sweep() }, this.heartbeatSeconds * 1000)
  }

  private settleTimer(): void {
    if (this.timer === null || this.hasInterest()) return
    this.timers.clearInterval(this.timer)
    this.timer = null
  }
}

/** The state fields of a session from the client's input, with absent keys absent. */
function stateFields(state: PresenceStateInput): Pick<PresenceSession, 'state' | 'field' | 'block' | 'typeSlug' | 'meta'> {
  const out: Pick<PresenceSession, 'state' | 'field' | 'block' | 'typeSlug' | 'meta'> = { state: state.state }
  if (state.field !== undefined) out.field = state.field
  if (state.block !== undefined) out.block = state.block
  if (state.typeSlug !== undefined) out.typeSlug = state.typeSlug
  if (state.meta !== undefined) out.meta = state.meta
  return out
}
