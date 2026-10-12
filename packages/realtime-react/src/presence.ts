/**
 * File Name: presence.ts
 * Purpose: The presence bindings - usePresence (join a scope while mounted)
 *          and usePresenceSelector (re-render only when the selected slice
 *          changes) - plus the shallowEqual they default to.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 15
 *          and 16-18: selector-based reactivity is required, so a component
 *          subscribes to the smallest slice it needs and re-renders only
 *          when that slice changes. The store in @tangen/realtime hands out
 *          a new snapshot object per change and never mutates the old one,
 *          which is what lets useSyncExternalStore do the work: getSnapshot
 *          runs the selector on the current snapshot and, when the result
 *          is equal (shallow by default) to the last one, returns the LAST
 *          one, so React sees the same reference and skips the render. The
 *          selector lives in a ref, so an inline arrow is fine.
 *
 *          usePresence joins on mount, re-sends the state when it changes
 *          (by value, so an inline object is fine too), and leaves on
 *          unmount; the heartbeat, the hidden-document pause and the
 *          reconnect re-join belong to the client and need nothing from
 *          React. Moved here from @tangen/realtime-admin in R4 so a site
 *          gets the same hooks; the admin wraps these with its
 *          per-environment registry and keeps useEditingClaim, which is an
 *          admin concept (the advisory claim), on its side.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { PresenceScopeSnapshot, PresenceState } from '@tangen/realtime'
import { useResolvedClient, type ClientOption } from './provider'

export interface UsePresenceOptions extends ClientOption {
  /** Off leaves (or never joins) without unmounting. Default true. */
  enabled?: boolean
}

export interface UsePresenceSelectorOptions<T> extends ClientOption {
  /** When the previous and the next selection are equal, the component does not re-render. Default: shallow. */
  equals?: (a: T, b: T) => boolean
}

/** Shallow equality: primitives by Object.is, arrays and plain objects one level deep. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

const identity = (s: PresenceScopeSnapshot) => s
/** What a scope looks like with no client bound: nobody there, nothing joined. */
export const EMPTY_PRESENCE: PresenceScopeSnapshot = { scope: '', joined: false, self: null, members: [], claim: null, version: 0 }

/**
 * Re-renders only when the selected slice of a scope's presence changes.
 * Observes without joining; pair it with usePresence (or a join elsewhere)
 * to make the scope live.
 * @param scope - `object:<id>`, `page:<id>` or `flow:<id>`.
 * @param selector - Picks the slice; runs on every snapshot, cheap by design.
 * @param opts - `client` (else the provider's), `equals` (default shallow).
 */
export function usePresenceSelector<T>(
  scope: string,
  selector: (snapshot: PresenceScopeSnapshot) => T,
  opts?: UsePresenceSelectorOptions<T>,
): T {
  const client = useResolvedClient(opts, 'usePresenceSelector')
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const equalsRef = useRef(opts?.equals ?? shallowEqual)
  equalsRef.current = opts?.equals ?? shallowEqual
  const memo = useRef<{ snapshot: PresenceScopeSnapshot | null; selected: T } | null>(null)

  const subscribe = useCallback((onChange: () => void) => {
    if (!client) return () => {}
    return client.presence.subscribe(scope, onChange)
  }, [client, scope])

  const getSnapshot = useCallback((): T => {
    const snapshot = client ? client.presence.get(scope) : EMPTY_PRESENCE
    const last = memo.current
    if (last && last.snapshot === snapshot) return last.selected
    const next = selectorRef.current(snapshot)
    if (last && equalsRef.current(last.selected, next)) {
      memo.current = { snapshot, selected: last.selected }
      return last.selected
    }
    memo.current = { snapshot, selected: next }
    return next
  }, [client, scope])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Joins a scope with a state while mounted (heartbeats meanwhile, leaves on
 * unmount) and returns the scope's snapshot. The state is compared by
 * value across renders; a change is sent as an update.
 * @param scope - `object:<id>`, `page:<id>` or `flow:<id>`.
 * @param state - What this session is doing: `{ state: 'viewing' | 'editing' | 'idle', field?, block?, meta? }`.
 * @param opts - `client` (else the provider's), `enabled`.
 */
export function usePresence(scope: string, state: PresenceState, opts?: UsePresenceOptions): PresenceScopeSnapshot {
  const client = useResolvedClient(opts, 'usePresence')
  const enabled = opts?.enabled ?? true
  const stateKey = JSON.stringify(state)
  const latestState = useRef(state)
  latestState.current = state
  // The key the join was sent with, so the first state effect after a join sends nothing twice.
  const joinedWith = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !client) return
    joinedWith.current = JSON.stringify(latestState.current)
    const leave = client.presence.join(scope, latestState.current)
    return () => { joinedWith.current = null; leave() }
  }, [client, scope, enabled])

  useEffect(() => {
    if (!enabled || !client || joinedWith.current === null || joinedWith.current === stateKey) return
    joinedWith.current = stateKey
    client.presence.update(scope, latestState.current)
  }, [client, scope, enabled, stateKey])

  return usePresenceSelector(scope, identity, { client, equals: Object.is })
}

export interface UsePresenceWatchOptions extends ClientOption {
  /** Off unwatches (or never watches) without unmounting. Default true. */
  enabled?: boolean
}

/**
 * Observes a scope while mounted without joining it: the subscription to
 * `presence:<scope>` brings the server's snapshot (answered on subscribe for
 * a per-type aggregate such as `objects:post`) and its envelopes into the
 * store, which usePresenceSelector reads. One watch per list, never one
 * per row: each row selects its own people from this one scope.
 * @param scope - `objects:<type>` (the aggregate), or any presence scope.
 * @param opts - `client` (else the provider's), `enabled`.
 */
export function usePresenceWatch(scope: string, opts?: UsePresenceWatchOptions): void {
  const client = useResolvedClient(opts, 'usePresenceWatch')
  const enabled = opts?.enabled ?? true
  useEffect(() => {
    if (!enabled || !client) return
    return client.presence.watch(scope)
  }, [client, scope, enabled])
}
