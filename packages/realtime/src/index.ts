/**
 * File Name: index.ts
 * Purpose: Public entry point of @tangen/realtime - the small, framework-
 *          neutral realtime client for Tangen sites and applications.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md section 3. One
 *          export matters: createRealtimeClient. Everything else is the
 *          typed protocol and the adapters, exported so @tangen/realtime-
 *          admin and the React bindings build on them rather than beside
 *          them (section 54: one-directional dependencies, one transport).
 */
export { createRealtimeClient } from './client'
export type { RealtimeClient, RealtimeClientOptions, RealtimeStatus, RealtimeHandler, FetchFn } from './client'
export type {
  RealtimeEvent, ServerMessage, ClientMessage, ReadyMessage, RefusedReason,
  PresenceState, PresenceStateWord, PresenceSession, PresenceClaim, PresenceMessage, PresenceAction, PresenceRequest,
} from './protocol'
export { PresenceStore, createPresenceController } from './presence'
export type { PresenceApi, PresenceController, PresenceControllerDeps, PresenceScopeSnapshot, PresenceVisibility, PresenceTimers } from './presence'
export { parseServerMessage, encodeCursorMap, CLOSE_SLOW, CLOSE_CAPACITY, CLOSE_RATE_LIMITED, CLOSE_REVOKED } from './protocol'
export { createBackoff } from './backoff'
export type { Backoff, BackoffOptions } from './backoff'
export type { Transport, TransportHandlers, WebSocketCtor, WebSocketLike, EventSourceCtor, EventSourceLike } from './transports'
export { resolveApiBase, websocketUrl, streamUrl } from './transports'
export { createFetchEventSource } from './fetch-event-source'
/**
 * The ONE rule for "was this envelope my own write coming back?". Every
 * "changed elsewhere" notice - the object editor's, Studio's Variables
 * panel, Studio's Style panel - is built on it; see own-write.ts for why it
 * is not three rules.
 */
export {
  isOwnWrite, ownWriteVerdict, originOf, actorOf, isOwnOrigin,
  rememberOrigin, currentOrigin, knownOrigins, forgetOrigins,
  WRITE_ORIGIN_HEADER, MAX_REMEMBERED_ORIGINS, OWN_SAVE_WINDOW_MS,
} from './own-write'
export type { OwnWriteContext, OwnWriteVerdict, OwnWriteEvent } from './own-write'
export type { FetchEventSourceOptions } from './fetch-event-source'
