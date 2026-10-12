/**
 * File Name: presence.ts
 * Purpose: The presence hooks the admin, Studio and admin extensions use -
 *          usePresence (join while mounted), usePresenceSelector (re-render
 *          only when the selected slice changes) and useEditingClaim (the
 *          advisory claim with take-over) - over the per-environment client
 *          registry.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 16-18
 *          and 19-24. R4 moved the framework-neutral hooks to
 *          @tangen/realtime-react (selector memo, join/leave lifecycle);
 *          what stays here is the admin shape of the same calls - `env`
 *          instead of `client`, because an admin tab holds one client per
 *          environment - and useEditingClaim, which reads `claim` and
 *          `self` only and whose takeOver() re-sends the current state as
 *          `editing` with `takeover: true`; the server answers with the
 *          moved claim on the topic, which is what every subscriber,
 *          including the loser, renders from. The advisory claim is an
 *          admin concept (section 22), so it does not ship to sites.
 */
import { useCallback } from 'react'
import type { PresenceClaim, PresenceScopeSnapshot, PresenceState, RealtimeClient } from '@tangen/realtime'
import {
  usePresence as useClientPresence,
  usePresenceSelector as useClientPresenceSelector,
  usePresenceWatch as useClientPresenceWatch,
} from '@tangen/realtime-react'

export { shallowEqual } from '@tangen/realtime-react'

export interface UsePresenceOptions {
  /** What this session is doing on the scope. Compared by value across renders. */
  state: PresenceState
  /** Off leaves (or never joins) without unmounting. Default true. */
  enabled?: boolean
}

export interface UsePresenceSelectorOptions<T> {
  /** When the previous and the next selection are equal, the component does not re-render. Default: shallow. */
  equals?: (a: T, b: T) => boolean
}

export interface EditingClaim {
  /** This session holds the advisory claim. */
  mine: boolean
  /** Who holds it; null when nobody is editing. */
  holder: PresenceClaim | null
  /** Move the claim here (sends the current state as `editing` with `takeover`). */
  takeOver(): void
}

export interface UsePresenceWatchOptions {
  /** Off unwatches (or never watches) without unmounting. Default true. */
  enabled?: boolean
}

export interface PresenceHooks {
  usePresence(scope: string, opts: UsePresenceOptions): PresenceScopeSnapshot
  usePresenceSelector<T>(scope: string, selector: (snapshot: PresenceScopeSnapshot) => T, opts: UsePresenceSelectorOptions<T>): T
  /** Observes a scope while mounted without joining it (the per-type aggregate `objects:<type>` a list watches once). */
  usePresenceWatch(scope: string, opts: UsePresenceWatchOptions): void
  useEditingClaim(scope: string, opts?: { enabled?: boolean }): EditingClaim
}

/** Builds the three hooks over the admin's per-environment client registry. */
export function createPresenceHooks(client: () => RealtimeClient): PresenceHooks {
  function usePresenceSelector<T>(scope: string, selector: (snapshot: PresenceScopeSnapshot) => T, opts: UsePresenceSelectorOptions<T>): T {
    return useClientPresenceSelector(scope, selector, { client: client(), equals: opts.equals })
  }

  function usePresence(scope: string, opts: UsePresenceOptions): PresenceScopeSnapshot {
    return useClientPresence(scope, opts.state, { client: opts.enabled === false ? null : client(), enabled: opts.enabled })
  }

  function usePresenceWatch(scope: string, opts: UsePresenceWatchOptions): void {
    useClientPresenceWatch(scope, { client: opts.enabled === false ? null : client(), enabled: opts.enabled })
  }

  function useEditingClaim(scope: string, opts: { enabled?: boolean } = {}): EditingClaim {
    const c = opts.enabled === false ? null : client()
    const { self, claim } = usePresenceSelector<{ self: PresenceScopeSnapshot['self']; claim: PresenceScopeSnapshot['claim'] }>(scope, (s) => ({ self: s.self, claim: s.claim }), {})
    const takeOver = useCallback(() => {
      if (!c) return
      const intent = c.presence.intent(scope) ?? { state: 'editing' as const }
      c.presence.update(scope, { ...intent, state: 'editing' }, { takeover: true })
    }, [c, scope])
    return { mine: !!claim && !!self && claim.session === self, holder: claim, takeOver }
  }

  return { usePresence, usePresenceSelector, usePresenceWatch, useEditingClaim }
}
