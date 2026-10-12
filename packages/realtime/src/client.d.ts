/**
 * File Name: client.ts
 * Purpose: createRealtimeClient - the lazy, multiplexed, self-healing
 *          realtime client for sites, apps and (through @tangen/realtime-
 *          admin) the admin.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: tasks/realtime-client-architecture.md sections 7, 8,
 *          11-15 and 41-42. The behaviours, in the order they matter:
 *
 *          LAZY. Creating the client opens nothing and mints nothing. The
 *          first subscribe mints a ticket and opens the connection; when the
 *          last handler goes, an idle timer (default 5 s) closes it. A page
 *          that never subscribes never touches the network.
 *
 *          ONE CONNECTION. Every topic is a logical subscription on the one
 *          socket; many handlers on one topic share one server subscription.
 *
 *          RESUME. The client remembers the last event id per topic and
 *          re-subscribes with `since` after a reconnect; the server replays
 *          what was missed or says `resync`, which the client surfaces as
 *          onResyncRequired(topic) so the application refetches through REST
 *          or GraphQL. Realtime signals; it does not replicate.
 *
 *          RECONNECT. Exponential backoff with full jitter, bounded. A
 *          WebSocket that never opened is retried as SSE automatically; a
 *          `revoked` close (4403) is final; `slow` (4008) and `capacity`
 *          (4013) reconnect like any drop.
 *
 *          PRESENCE ON SSE. An EventSource cannot send, so a stream publishes
 *          presence over POST /api/v1/realtime/presence instead, addressed by
 *          the connection id from `ready` (`postPresence`, which the admin
 *          fills with its authenticated fetch and the default fills with the
 *          API key). Same message, same server handler, same answers back
 *          down the stream; `presence.supported()` is true on either
 *          transport once there is a way to publish.
 *
 *          AUTH. The ticket comes from POST /api/v1/realtime/ticket with the
 *          SDK's API key as Bearer, or from a caller-supplied mintTicket (the
 *          admin's authenticated fetch). The TangenClient from @tangen/sdk
 *          does not expose its config, so `client` here is the ClientConfig
 *          object the site already passed to createClient(); a change
 *          request asks the SDK to expose it so the literal
 *          createRealtimeClient({ client: tangen }) works too.
 */
import { type BackoffOptions } from './backoff';
import { type WebSocketCtor, type EventSourceCtor } from './transports';
import { type PresenceRequest, type RealtimeEvent, type RefusedReason } from './protocol';
import { type PresenceApi, type PresenceVisibility, type PresenceTimers } from './presence';
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type RealtimeHandler<T extends Record<string, unknown> = Record<string, unknown>> = (event: RealtimeEvent<T>) => void;
export interface RealtimeClientOptions {
    /** The site's API origin (or a base ending in /api/v1). Relative values resolve against location.origin. */
    apiUrl?: string;
    /** API key for the default ticket mint. */
    apiKey?: string;
    /** The ClientConfig passed to @tangen/sdk createClient(): apiUrl, apiKey, fetch. */
    client?: {
        apiUrl: string;
        apiKey: string;
        fetch?: FetchFn;
    };
    /** Custom ticket mint; returns the raw ticket. The admin uses its authenticated fetch here. */
    mintTicket?: () => Promise<string>;
    /**
     * How a presence message is published when the connection is an SSE
     * stream (an EventSource cannot send). Defaults to POST
     * /api/v1/realtime/presence with the API key as Bearer; the admin passes
     * its own authenticated fetch. Without one - no key and no override -
     * presence on SSE stays observe-only, as it was before R4.
     */
    postPresence?: (body: PresenceRequest) => Promise<unknown>;
    fetch?: FetchFn;
    /** Milliseconds an idle connection (no handlers) stays open. Default 5000; Infinity keeps it. */
    idleCloseMs?: number;
    /** Client keep-alive ping interval while open. Default 25000; 0 disables. */
    pingIntervalMs?: number;
    reconnect?: BackoffOptions;
    /** Wait before reconnecting after a `4029 rate_limited` close (the Gateway's message budget). Default 30000. */
    rateLimitedDelayMs?: number;
    /** 'auto' (default): WebSocket, falling back to SSE when the upgrade never opens. */
    transport?: 'auto' | 'websocket' | 'sse';
    /** Injected constructors for tests and non-browser runtimes. */
    WebSocket?: WebSocketCtor;
    EventSource?: EventSourceCtor;
    /** Origin for relative apiUrl outside a browser. */
    origin?: string;
    /** R3 presence tuning; the heartbeat period defaults to what the server's `ready` says. */
    presence?: {
        heartbeatMs?: number;
        /** Minimum spacing of presence messages per scope; the server refuses closer ones. Default 2000. */
        minIntervalMs?: number;
        /** Pause heartbeats while the document is hidden. Default true. */
        pauseWhenHidden?: boolean;
        /** Injected for tests and non-browser runtimes. */
        visibility?: PresenceVisibility;
        timers?: PresenceTimers;
        now?: () => number;
    };
}
export interface RealtimeClient {
    /** Subscribes a handler to a topic; the first subscription opens the connection. Returns the unsubscribe. */
    subscribe<T extends Record<string, unknown> = Record<string, unknown>>(topic: string, handler: RealtimeHandler<T>): () => void;
    /** Removes one handler, or every handler of the topic when none is given. */
    unsubscribe(topic: string, handler?: RealtimeHandler): void;
    /** Opens the connection now, without waiting for a subscription. */
    connect(): Promise<void>;
    /** Closes the connection and stops reconnecting until the next subscribe or connect. */
    disconnect(): void;
    status(): RealtimeStatus;
    /** Which transport carries the open connection, if any. */
    transport(): 'websocket' | 'sse' | null;
    /**
     * The id the server gave this connection, or null before one opened. It
     * is the ORIGIN a write issued from this tab carries (own-write.ts): the
     * fetch helpers send it as X-Tangen-Origin and the envelope comes back
     * stamped with it, so an echo of my own write is recognisable without
     * knowing who I am logged in as.
     */
    connectionId(): string | null;
    onStatus(fn: (status: RealtimeStatus) => void): () => void;
    /** Fires after a connection is re-established and every topic re-subscribed. */
    onReconnect(fn: () => void): () => void;
    /** The server could not replay a topic's gap: refetch canonical state. */
    onResyncRequired(fn: (topic: string) => void): () => void;
    /** The server refused a topic (permission, limit, shape). */
    onRefused(fn: (topic: string | null, reason: RefusedReason) => void): () => void;
    topics(): string[];
    /** R3: join a scope, heartbeat while joined, read who is there. Needs the WebSocket transport. */
    presence: PresenceApi;
}
export declare function createRealtimeClient(options?: RealtimeClientOptions): RealtimeClient;
