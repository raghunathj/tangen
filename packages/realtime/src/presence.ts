/**
 * File Name: presence.ts
 * Purpose: The client side of presence - the local store a page reads
 *          (who is on a scope, who holds the claim) and the controller that
 *          joins, heartbeats while joined, coalesces updates and leaves.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 15,
 *          16-18 and 44, and R3 of tasks/plan-realtime.md. The store is
 *          framework-neutral and selector-friendly: every change produces
 *          a new snapshot object for the scope and the previous one is
 *          never mutated, so a React binding can hand useSyncExternalStore
 *          a stable reference and a selector can compare slices by value.
 *
 *          The controller is where "presence runs only while used" is
 *          kept. Joining a scope subscribes to `presence:<scope>` (so the
 *          connection opens and stays open) and sends the join; the one
 *          heartbeat timer starts with the first joined scope and is
 *          cleared with the last leave - no scope, no timer, no listener.
 *          The heartbeat period comes from the server's `ready` (the
 *          config's heartbeatSeconds) unless the caller overrides it. A
 *          hidden document pauses the heartbeat: the server expires the
 *          session at the TTL and others see it go, and the first
 *          heartbeat on return brings it back, which is what a tab in the
 *          background should look like to the people still editing.
 *
 *          The server refuses more than one presence message per two
 *          seconds per scope, so updates inside that window are held and
 *          the latest one is sent when the window opens; a heartbeat
 *          inside the window is skipped because the message that opened
 *          it already extended the expiry. A reconnect re-joins every
 *          scope with its current state and the new snapshot replaces the
 *          local one. Presence needs the WebSocket: an EventSource cannot
 *          send, so on the SSE fallback the controller still subscribes
 *          (you see others) but cannot join (others do not see you), and
 *          supported() says so.
 */
import type { ClientMessage, PresenceClaim, PresenceMessage, PresenceSession, PresenceState, RealtimeEvent } from './protocol'

// ── Store ─────────────────────────────────────────────────────────────────────

export interface PresenceScopeSnapshot {
  scope: string
  /** This client asked to be on the scope (join without a leave yet). */
  joined: boolean
  /** This client's own session id on the scope, once the server acknowledged the join. */
  self: string | null
  /** Everyone on the scope including self, oldest first. */
  members: PresenceSession[]
  claim: PresenceClaim | null
  /** Increments on every change; a cheap "did anything change" for consumers. */
  version: number
}

const emptySnapshot = (scope: string): PresenceScopeSnapshot => ({ scope, joined: false, self: null, members: [], claim: null, version: 0 })

const bySince = (a: PresenceSession, b: PresenceSession): number => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export class PresenceStore {
  private readonly scopes = new Map<string, PresenceScopeSnapshot>()
  private readonly listeners = new Map<string, Set<(snapshot: PresenceScopeSnapshot) => void>>()
  private readonly empties = new Map<string, PresenceScopeSnapshot>()

  /** The scope's snapshot; a stable empty one for a scope nothing has touched. */
  get(scope: string): PresenceScopeSnapshot {
    const known = this.scopes.get(scope)
    if (known) return known
    let empty = this.empties.get(scope)
    if (!empty) { empty = emptySnapshot(scope); this.empties.set(scope, empty) }
    return empty
  }

  subscribe(scope: string, listener: (snapshot: PresenceScopeSnapshot) => void): () => void {
    let set = this.listeners.get(scope)
    if (!set) { set = new Set(); this.listeners.set(scope, set) }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) this.listeners.delete(scope)
    }
  }

  private put(scope: string, next: Omit<PresenceScopeSnapshot, 'version' | 'scope'>): void {
    const prev = this.get(scope)
    const snapshot: PresenceScopeSnapshot = { scope, ...next, version: prev.version + 1 }
    this.scopes.set(scope, snapshot)
    for (const fn of [...(this.listeners.get(scope) ?? [])]) { try { fn(snapshot) } catch { /* a listener never breaks the store */ } }
  }

  setJoined(scope: string, joined: boolean): void {
    const prev = this.get(scope)
    if (prev.joined === joined) return
    this.put(scope, { joined, self: joined ? prev.self : null, members: joined ? prev.members : [], claim: joined ? prev.claim : null })
  }

  /** The server's answer to a join replaces everything known about the scope. */
  applySnapshot(message: PresenceMessage): void {
    const prev = this.get(message.scope)
    this.put(message.scope, { joined: prev.joined, self: message.self, members: [...message.members].sort(bySince), claim: message.claim })
  }

  /** A presence envelope on `presence:<scope>`: join and update set the session, leave removes it; all carry the claim. */
  applyEvent(event: RealtimeEvent): void {
    const d = event.data as { scope?: string; session?: PresenceSession; sessionId?: string; claim?: PresenceClaim | null }
    const scope = typeof d.scope === 'string' ? d.scope : event.topic.startsWith('presence:') ? event.topic.slice('presence:'.length) : null
    if (!scope) return
    const prev = this.get(scope)
    let members = prev.members
    if ((event.type === 'presence.join' || event.type === 'presence.update') && d.session) {
      const session = d.session
      members = [...prev.members.filter((m) => m.id !== session.id), session].sort(bySince)
    } else if (event.type === 'presence.leave' && typeof d.sessionId === 'string') {
      members = prev.members.filter((m) => m.id !== d.sessionId)
    } else {
      return
    }
    const claim = d.claim === undefined ? prev.claim : d.claim
    this.put(scope, { joined: prev.joined, self: prev.self, members, claim })
  }

  /** No longer joined, but still observed: the members stay, the server's envelopes keep them right. */
  unjoin(scope: string): void {
    const prev = this.get(scope)
    if (!prev.joined) return
    this.put(scope, { joined: false, self: prev.self, members: prev.members, claim: prev.claim })
  }

  /** Forgets the scope entirely (after a leave). */
  clear(scope: string): void {
    if (!this.scopes.has(scope)) return
    this.put(scope, { joined: false, self: null, members: [], claim: null })
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

export interface PresenceVisibility {
  hidden(): boolean
  onChange(listener: () => void): () => void
}

export interface PresenceTimers {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface PresenceControllerDeps {
  store: PresenceStore
  /** Sends one upstream message on the open WebSocket; false when there is none (or it is SSE). */
  send(message: ClientMessage): boolean
  /** Subscribes a handler to a topic (the client's own subscribe). */
  subscribeTopic(topic: string, handler: (event: RealtimeEvent) => void): () => void
  /** Override of the server's heartbeat period (ms). */
  heartbeatMs?: number
  /** Minimum spacing of presence messages per scope. Default 2000 (the server's limit). */
  minIntervalMs?: number
  pauseWhenHidden?: boolean
  visibility?: PresenceVisibility
  timers?: PresenceTimers
  now?: () => number
}

export interface PresenceApi {
  /** Joins a scope with a state; subscribes to `presence:<scope>`; returns the leave. */
  join(scope: string, state: PresenceState): () => void
  /** Replaces the state; `takeover: true` with `state: 'editing'` moves the advisory claim here. */
  update(scope: string, state: PresenceState, opts?: { takeover?: boolean }): void
  leave(scope: string): void
  /**
   * Observes a scope without joining: subscribes to `presence:<scope>` so
   * the server's snapshot (sent for a per-type aggregate such as
   * `objects:post` on subscribe) and its envelopes fill the store. Returns
   * the unwatch; the last unwatch of a scope nothing joined forgets it.
   */
  watch(scope: string): () => void
  /** Sends a heartbeat now (every joined scope, or one). */
  heartbeat(scope?: string): void
  get(scope: string): PresenceScopeSnapshot
  subscribe(scope: string, listener: (snapshot: PresenceScopeSnapshot) => void): () => void
  /** The state this client last asked for on a scope. */
  intent(scope: string): PresenceState | null
  /** Scopes joined right now. */
  scopes(): string[]
  /** True while the heartbeat timer runs: exactly while something is joined and the document is visible. */
  heartbeatRunning(): boolean
  /** True when the open transport can carry presence (WebSocket). */
  supported(): boolean
}

/** The controller as the client drives it (PresenceApi plus the connection hooks). */
export interface PresenceController extends PresenceApi {
  onReady(self: string, heartbeatSeconds?: number, canSend?: boolean): void
  onDisconnected(): void
  applySnapshot(message: PresenceMessage): void
  dispose(): void
}

interface Intent {
  state: PresenceState
  off: () => void
  lastSentAt: number
  pending: { state: PresenceState; takeover: boolean; timer: unknown } | null
}

const DEFAULT_HEARTBEAT_MS = 20_000
const DEFAULT_MIN_INTERVAL_MS = 2_000

const documentVisibility = (): PresenceVisibility | null => {
  const doc = (globalThis as { document?: { hidden?: boolean; addEventListener?: Function; removeEventListener?: Function } }).document
  if (!doc || typeof doc.addEventListener !== 'function') return null
  return {
    hidden: () => doc.hidden === true,
    onChange: (listener) => {
      doc.addEventListener!('visibilitychange', listener)
      return () => doc.removeEventListener!('visibilitychange', listener)
    },
  }
}

export function createPresenceController(deps: PresenceControllerDeps): PresenceController {
  const store = deps.store
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const now = deps.now ?? Date.now
  // Wrapped, not referenced: a browser's setInterval is a window method and
  // refuses a foreign `this` with "Illegal invocation" when called off a
  // plain object. Bun and Node accept either, which is why tests never saw
  // the object editor fail to render.
  const timers: PresenceTimers = deps.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as never),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as never),
  }
  const visibility = deps.pauseWhenHidden === false ? null : (deps.visibility ?? documentVisibility())
  const intents = new Map<string, Intent>()
  // Scopes observed without a join (a list watching a per-type aggregate), refcounted per scope.
  const watchers = new Map<string, { count: number; off: () => void }>()
  let serverHeartbeatMs: number | null = null
  let connected = false
  let supported = false
  let timer: unknown = null
  let offVisibility: (() => void) | null = null

  const heartbeatMs = () => deps.heartbeatMs ?? serverHeartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const hidden = () => visibility?.hidden() === true

  const sendNow = (scope: string, intent: Intent, m: ClientMessage): boolean => {
    if (!connected || !deps.send(m)) return false
    intent.lastSentAt = now()
    return true
  }

  const flushPending = (scope: string, intent: Intent) => {
    const p = intent.pending
    if (!p) return
    intent.pending = null
    intent.state = p.state
    sendNow(scope, intent, { op: 'presence', scope, action: 'update', state: p.state, ...(p.takeover ? { takeover: true } : {}) })
  }

  const tick = () => {
    if (hidden()) return
    for (const [scope, intent] of intents) {
      if (now() - intent.lastSentAt < minIntervalMs) continue
      sendNow(scope, intent, { op: 'presence', scope, action: 'heartbeat' })
    }
  }

  const startTimer = () => {
    // No timer unless there is something to heartbeat on AND a transport that can carry it.
    if (timer !== null || intents.size === 0 || hidden() || !supported) return
    timer = timers.setInterval(tick, heartbeatMs())
  }
  const stopTimer = () => {
    if (timer === null) return
    timers.clearInterval(timer)
    timer = null
  }
  const restartTimer = () => { stopTimer(); startTimer() }

  const onVisibility = () => {
    if (hidden()) { stopTimer(); return }
    // Back in view: say so at once (the session may have expired meanwhile), then keep the rhythm.
    for (const [scope, intent] of intents) {
      if (now() - intent.lastSentAt >= minIntervalMs) sendNow(scope, intent, { op: 'presence', scope, action: 'heartbeat' })
    }
    startTimer()
  }

  const settleListeners = () => {
    if (intents.size > 0) {
      if (visibility && !offVisibility) offVisibility = visibility.onChange(onVisibility)
      startTimer()
      return
    }
    stopTimer()
    if (offVisibility) { offVisibility(); offVisibility = null }
  }

  const api: PresenceController = {
    join(scope, state) {
      const existing = intents.get(scope)
      if (existing) {
        api.update(scope, state)
        return () => api.leave(scope)
      }
      const off = deps.subscribeTopic(`presence:${scope}`, (event) => store.applyEvent(event))
      const intent: Intent = { state, off, lastSentAt: -Infinity, pending: null }
      intents.set(scope, intent)
      store.setJoined(scope, true)
      sendNow(scope, intent, { op: 'presence', scope, action: 'join', state })
      settleListeners()
      return () => api.leave(scope)
    },
    update(scope, state, opts) {
      const intent = intents.get(scope)
      if (!intent) return
      const takeover = opts?.takeover === true
      const wait = minIntervalMs - (now() - intent.lastSentAt)
      if (wait > 0 || !connected) {
        // Inside the window (or offline): hold the latest; the reconnect re-joins with it.
        if (intent.pending) { timers.clearTimeout(intent.pending.timer); intent.pending = null }
        intent.state = state
        if (!connected) return
        intent.pending = { state, takeover, timer: timers.setTimeout(() => flushPending(scope, intent), wait) }
        return
      }
      intent.state = state
      sendNow(scope, intent, { op: 'presence', scope, action: 'update', state, ...(takeover ? { takeover: true } : {}) })
    },
    leave(scope) {
      const intent = intents.get(scope)
      if (!intent) return
      if (intent.pending) { timers.clearTimeout(intent.pending.timer); intent.pending = null }
      intents.delete(scope)
      if (connected) deps.send({ op: 'presence', scope, action: 'leave' })
      intent.off()
      // A watcher still observes the scope; the server's leave envelope removes this session from it.
      if (watchers.has(scope)) store.unjoin(scope)
      else store.clear(scope)
      settleListeners()
    },
    watch(scope) {
      let watcher = watchers.get(scope)
      if (!watcher) {
        watcher = { count: 0, off: deps.subscribeTopic(`presence:${scope}`, (event) => store.applyEvent(event)) }
        watchers.set(scope, watcher)
      }
      const w = watcher
      w.count++
      let done = false
      return () => {
        if (done) return
        done = true
        w.count--
        if (w.count > 0) return
        watchers.delete(scope)
        w.off()
        if (!intents.has(scope)) store.clear(scope)
      }
    },
    heartbeat(scope) {
      for (const [s, intent] of intents) {
        if (scope && s !== scope) continue
        sendNow(s, intent, { op: 'presence', scope: s, action: 'heartbeat' })
      }
    },
    get: (scope) => store.get(scope),
    subscribe: (scope, listener) => store.subscribe(scope, listener),
    intent: (scope) => intents.get(scope)?.state ?? null,
    scopes: () => [...intents.keys()],
    heartbeatRunning: () => timer !== null,
    supported: () => supported,
    onReady(_self, heartbeatSeconds, canSend = true) {
      connected = true
      supported = canSend
      if (typeof heartbeatSeconds === 'number' && heartbeatSeconds > 0) serverHeartbeatMs = heartbeatSeconds * 1000
      // Re-join everything with the current state; the snapshots replace the local view.
      for (const [scope, intent] of intents) {
        if (intent.pending) { timers.clearTimeout(intent.pending.timer); intent.state = intent.pending.state; intent.pending = null }
        intent.lastSentAt = -Infinity
        sendNow(scope, intent, { op: 'presence', scope, action: 'join', state: intent.state })
      }
      if (intents.size > 0) restartTimer()
    },
    onDisconnected() {
      connected = false
      supported = false
      stopTimer()
      for (const intent of intents.values()) {
        if (intent.pending) { timers.clearTimeout(intent.pending.timer); intent.state = intent.pending.state; intent.pending = null }
      }
    },
    applySnapshot: (message) => store.applySnapshot(message),
    dispose() {
      for (const scope of [...intents.keys()]) api.leave(scope)
      for (const [scope, w] of [...watchers]) { watchers.delete(scope); w.off(); store.clear(scope) }
      stopTimer()
    },
  }
  return api
}
