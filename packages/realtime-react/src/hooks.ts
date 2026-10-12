/**
 * File Name: hooks.ts
 * Purpose: useRealtimeEvent (subscribe to a topic for the component's
 *          lifetime) and useRealtimeStatus (the connection status as React
 *          state) over one @tangen/realtime client.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 7, 12
 *          and 16-18. The hook is a thin useEffect over client.subscribe():
 *          the client already multiplexes, opens lazily on the first
 *          subscription and idle-closes after the last, so React only has
 *          to subscribe on mount and unsubscribe on unmount. The handler
 *          and the resync callback live in refs, so an inline arrow never
 *          re-subscribes (which would cost an unsubscribe/subscribe round
 *          trip per render) and the latest closure always runs. The
 *          subscription follows the topic, the client and `enabled`.
 *
 *          Realtime signals, it does not replicate: the handler is where a
 *          page invalidates its cache and refetches; `onResync` is the
 *          same refetch for the case where the server could not replay.
 */
import { useEffect, useRef, useState } from 'react'
import type { RealtimeHandler, RealtimeStatus, RealtimeClient } from '@tangen/realtime'
import { useResolvedClient, type ClientOption } from './provider'

export interface UseRealtimeEventOptions extends ClientOption {
  /** Off switches the subscription without unmounting the caller. Default true. */
  enabled?: boolean
  /**
   * The server could not replay what this topic missed (reconnect outside
   * the window): refetch canonical state. Most pages pass their load().
   */
  onResync?: (topic: string) => void
}

/**
 * Subscribes a handler to a topic while the component is mounted; the
 * latest handler always runs.
 * @param topic - A logical topic (`objects:post`, `object:<id>`, `ext:<id>:<name>`).
 * @param handler - Runs per envelope; refetch from here.
 * @param opts - `client` (else the provider's), `enabled`, `onResync`.
 */
export function useRealtimeEvent<T extends Record<string, unknown> = Record<string, unknown>>(
  topic: string,
  handler: RealtimeHandler<T>,
  opts?: UseRealtimeEventOptions,
): void {
  const client = useResolvedClient(opts, 'useRealtimeEvent')
  const latest = useRef(handler)
  latest.current = handler
  const latestResync = useRef(opts?.onResync)
  latestResync.current = opts?.onResync
  const enabled = opts?.enabled ?? true
  const wantsResync = !!opts?.onResync
  useEffect(() => {
    if (!enabled || !client || !topic) return
    const off = client.subscribe<T>(topic, (event) => latest.current(event))
    if (!wantsResync) return off
    const offResync = client.onResyncRequired((t) => { if (t === topic) latestResync.current?.(t) })
    return () => { offResync(); off() }
  }, [client, topic, enabled, wantsResync])
}

/**
 * The connection status of a client as React state: `idle` until something
 * subscribes, then `connecting | open | reconnecting | closed`.
 * @param client - Explicit client; `null` reads as idle; omitted uses the provider's.
 */
export function useRealtimeStatus(client?: RealtimeClient | null): RealtimeStatus {
  const resolved = useResolvedClient(client !== undefined ? { client } : undefined, 'useRealtimeStatus')
  const [status, setStatus] = useState<RealtimeStatus>(() => (resolved ? resolved.status() : 'idle'))
  useEffect(() => {
    if (!resolved) { setStatus('idle'); return }
    setStatus(resolved.status())
    return resolved.onStatus(setStatus)
  }, [resolved])
  return status
}
