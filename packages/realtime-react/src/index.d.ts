/**
 * File Name: index.ts
 * Purpose: Public entry point of @tangen/realtime-react - the React
 *          bindings over @tangen/realtime for sites and applications:
 *          RealtimeProvider, useRealtime, useRealtimeStatus,
 *          useRealtimeEvent, usePresence, usePresenceSelector.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 3 and
 *          16-18 (the bindings named there) and 54 (dependencies are
 *          one-directional: sdk <- realtime <- realtime-react <-
 *          realtime-admin). Nothing here knows about the admin, Studio or
 *          extensions; @tangen/realtime-admin wraps these hooks with its
 *          per-environment client registry and adds the collaboration
 *          helpers (advisory claims, conflict indicators) on top.
 */
export { RealtimeProvider, useRealtime, useResolvedClient } from './provider';
export type { RealtimeProviderProps, ClientOption } from './provider';
export { useRealtimeEvent, useRealtimeStatus } from './hooks';
export type { UseRealtimeEventOptions } from './hooks';
export { usePresence, usePresenceSelector, usePresenceWatch, shallowEqual, EMPTY_PRESENCE } from './presence';
export type { UsePresenceOptions, UsePresenceSelectorOptions, UsePresenceWatchOptions } from './presence';
export type { RealtimeClient, RealtimeEvent, RealtimeHandler, RealtimeStatus, PresenceState, PresenceStateWord, PresenceSession, PresenceClaim, PresenceScopeSnapshot, } from '@tangen/realtime';
