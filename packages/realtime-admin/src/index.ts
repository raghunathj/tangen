/**
 * File Name: index.ts
 * Purpose: @tangen/realtime-admin - what the admin, Studio and admin-facing
 *          extensions need over the primitive: one client per environment,
 *          tickets minted through the admin's own authenticated fetch, and
 *          the useRealtime React hook.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 3 and
 *          19-24, and section 54: this package builds richer conveniences
 *          ON @tangen/realtime and must never become a second transport or
 *          protocol. R1 shipped what the first consumer needed; R2 added
 *          the resync callback (the server could not replay a gap: refetch)
 *          and the conflict indicator's decision (conflict.ts); presence,
 *          advisory claims and the Studio helpers arrive in R3.
 *
 *          Why per environment: a ticket is minted for one environment and
 *          every channel belongs to this deployment, so an admin tab
 *          and one looking at production are two connections by design -
 *          the same rule REST and GraphQL follow. Clients are created on
 *          first use and idle-close on their own.
 *
 *          React is a peer dependency and the host's copy is the one used
 *          (the admin's Vite config dedupes it). R4 moved the hooks
 *          themselves to @tangen/realtime-react (section 54: sdk <-
 *          realtime <- realtime-react <- realtime-admin); what this file
 *          keeps is the admin's shape of them - no client handle to pass,
 *          resolved through the registry - so the kit's call sites did not
 *          change and a site never pulls admin code to get the same hooks.
 */
import {
  createRealtimeClient,
  type PresenceRequest, type RealtimeClient, type RealtimeClientOptions, type RealtimeEvent, type RealtimeHandler, type RealtimeStatus,
} from '@tangen/realtime'
import { useRealtimeEvent, useRealtimeStatus as useClientStatus } from '@tangen/realtime-react'

import { createPresenceHooks, type PresenceHooks } from './presence'

export type {
  RealtimeClient, RealtimeEvent, RealtimeHandler, RealtimeStatus, PresenceRequest,
  PresenceState, PresenceStateWord, PresenceSession, PresenceClaim, PresenceScopeSnapshot,
} from '@tangen/realtime'
export { isChangedElsewhere, changedElsewhereLabel, isOwnActor, OBJECT_CHANGE_TYPES, type ChangedElsewhereContext } from './conflict'
export {
  othersEditingField, editingFieldLabel, initialsOf, othersOnObject, rowPresenceModel, rowPresenceLabel, type RowPresenceModel,
  fieldAtOrUnder, fieldRootOf, sessionDoing, SURFACES_ROOT,
} from './presence-views'
export { shallowEqual, type UsePresenceOptions, type UsePresenceSelectorOptions, type UsePresenceWatchOptions, type EditingClaim, type PresenceHooks } from './presence'

export interface AdminRealtimeOptions extends Omit<RealtimeClientOptions, 'mintTicket' | 'apiKey' | 'client' | 'postPresence'> {
  /** Mints a ticket for this deployment through the admin's authenticated fetch. */
  mintTicket: () => Promise<string>
  /**
   * R4: publishes one presence message for a connection on the SSE fallback,
   * through the admin's authenticated fetch (POST /realtime/presence). An
   * EventSource cannot send, and the admin runs on SSE whenever the upgrade
   * does not get through - a dev proxy without `ws: true`, a middlebox - so
   * without this an admin tab shows everyone and is shown to nobody.
   */
  postPresence?: (body: PresenceRequest) => Promise<unknown>
}

export interface UseRealtimeOptions {
  /** Off switches the subscription without unmounting the caller. Default true. */
  enabled?: boolean
  /**
   * The server could not replay what this topic missed (reconnect outside
   * the window): refetch canonical state. Most list pages pass their load().
   */
  onResync?: (topic: string) => void
}

export interface SubscribeOptions {
  onResync?: (topic: string) => void
}

export interface AdminRealtime {
  /** The one client of this deployment, created on first use. */
  client(): RealtimeClient
  subscribe<T extends Record<string, unknown> = Record<string, unknown>>(topic: string, handler: RealtimeHandler<T>, opts?: SubscribeOptions): () => void
  useRealtime<T extends Record<string, unknown> = Record<string, unknown>>(topic: string, handler: RealtimeHandler<T>, opts?: UseRealtimeOptions): void
  useRealtimeStatus(): RealtimeStatus
  dispose(): void
  usePresence: PresenceHooks['usePresence']
  usePresenceSelector: PresenceHooks['usePresenceSelector']
  usePresenceWatch: PresenceHooks['usePresenceWatch']
  useEditingClaim: PresenceHooks['useEditingClaim']
}

export function createAdminRealtime(options: AdminRealtimeOptions): AdminRealtime {
  const { mintTicket, postPresence, ...clientOptions } = options
  let instance: RealtimeClient | null = null

  const client = (): RealtimeClient => {
    if (!instance) {
      instance = createRealtimeClient({
        ...clientOptions,
        mintTicket,
        ...(postPresence ? { postPresence } : {}),
      })
    }
    return instance
  }

  const subscribe: AdminRealtime['subscribe'] = (topic, handler, opts) => {
    const c = client()
    const off = c.subscribe(topic, handler)
    if (!opts?.onResync) return off
    const onResync = opts.onResync
    const offResync = c.onResyncRequired((t) => { if (t === topic) onResync(t) })
    return () => { offResync(); off() }
  }

  function useRealtime<T extends Record<string, unknown>>(topic: string, handler: RealtimeHandler<T>, opts: UseRealtimeOptions = {}): void {
    useRealtimeEvent<T>(topic, handler, { client: opts.enabled === false ? null : client(), enabled: opts.enabled, onResync: opts.onResync })
  }

  function useRealtimeStatus(): RealtimeStatus {
    return useClientStatus(client())
  }

  const presenceHooks = createPresenceHooks(client)

  return {
    client,
    subscribe,
    useRealtime,
    useRealtimeStatus,
    ...presenceHooks,
    dispose() {
      instance?.disconnect()
      instance = null
    },
  }
}
