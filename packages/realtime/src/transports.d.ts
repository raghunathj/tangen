/**
 * File Name: transports.ts
 * Purpose: The two client-side adapters - a WebSocket and an EventSource -
 *          behind one interface the client drives without knowing which.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The architecture's section 6: one protocol, two
 *          adapters, the SDK hides the choice. The WebSocket adapter sends
 *          protocol messages. The SSE adapter cannot send anything after the
 *          request, so subscribe and unsubscribe change its topic set and
 *          schedule a reopen with the new set and the current cursors; the
 *          client treats the `ready` and `subscribed` a reopen re-sends as
 *          idempotent. Both take their constructors by injection so a test,
 *          a worker or a non-browser runtime can supply its own.
 *
 *          R4: the SSE adapter gained one upstream, injected rather than
 *          invented - `send` posts a presence message to
 *          POST /api/v1/realtime/presence, addressed by the connection id
 *          the server named in `ready`. Same protocol, same server handler,
 *          same answers back down the stream; only the direction of the one
 *          message differs, because an EventSource has no direction.
 *
 *          `failedBeforeOpen` on close is the signal the client's automatic
 *          fallback keys on: a WebSocket that never opened (a proxy that
 *          does not forward upgrades, a corporate middlebox) is retried as
 *          SSE, not as another WebSocket.
 */
import { type ServerMessage, type ClientMessage } from './protocol';
export interface TransportHandlers {
    onOpen(): void;
    onMessage(message: ServerMessage): void;
    onClose(info: {
        code: number;
        reason: string;
        failedBeforeOpen: boolean;
    }): void;
}
export interface Transport {
    readonly kind: 'websocket' | 'sse';
    subscribe(topic: string, since?: string): void;
    unsubscribe(topic: string): void;
    ping(): void;
    /** R3: an upstream message beyond the three ops (presence). False when the transport cannot send. */
    send(message: ClientMessage): boolean;
    close(): void;
}
/** The subset of the WebSocket constructor and instance the adapter uses. */
export interface WebSocketLike {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: {
        data: unknown;
    }) => void) | null;
    onclose: ((ev: {
        code: number;
        reason: string;
    }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;
/** The subset of EventSource the adapter uses. */
export interface EventSourceLike {
    close(): void;
    addEventListener(type: string, listener: (ev: {
        data: string;
        lastEventId?: string;
    }) => void): void;
    onerror: ((ev: unknown) => void) | null;
    onopen: ((ev: unknown) => void) | null;
}
export type EventSourceCtor = new (url: string, init?: {
    withCredentials?: boolean;
}) => EventSourceLike;
export declare function openWebSocketTransport(url: string, WS: WebSocketCtor, handlers: TransportHandlers): Transport;
export interface SseTransportOptions {
    /** Builds the stream URL for a topic set and the cursors to resume from. */
    url: (topics: string[], cursors: Map<string, string>) => string;
    /** The client's current cursor for a topic, for a reopen. */
    cursorOf: (topic: string) => string | null;
    /**
     * R4: how this adapter sends upstream. An EventSource cannot, so the
     * client hands in the HTTP presence route (POST /realtime/presence,
     * addressed by connection id); without one the adapter still cannot send
     * and presence stays observe-only, as it was.
     */
    send?: (message: ClientMessage) => boolean;
    schedule?: (fn: () => void) => void;
}
export declare function openSseTransport(ES: EventSourceCtor, opts: SseTransportOptions, handlers: TransportHandlers, initialTopics?: string[]): Transport;
/** Shared URL helpers. */
export declare function resolveApiBase(apiUrl: string, origin?: string): string;
export declare function websocketUrl(apiBase: string, ticket: string): string;
export declare function streamUrl(apiBase: string, ticket: string, topics: string[], cursors: Map<string, string>): string;
