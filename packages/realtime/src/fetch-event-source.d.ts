/**
 * File Name: fetch-event-source.ts
 * Purpose: An EventSource built on fetch, for runtimes that have none
 *          (Bun, Node, workers) and for callers that need headers or a
 *          custom fetch on the stream.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The SSE fallback is only automatic if there is an
 *          EventSource to fall back to. Browsers have one; Bun and Node do
 *          not. This is the subset the client's SSE adapter uses: named
 *          event listeners, onopen, onerror, close(), and the browser's own
 *          reconnect behaviour - retry after the server's `retry:` delay,
 *          resending the last `id:` as Last-Event-ID - because that is
 *          what makes a cursor survive a dropped stream. Not a full
 *          EventSource: no readyState constants, no `message` default
 *          dispatch beyond what the listeners ask for.
 */
import type { EventSourceCtor } from './transports';
export interface FetchEventSourceOptions {
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    /** Extra headers on every stream request. */
    headers?: Record<string, string>;
    /** Initial retry delay before the server says otherwise. Default 3000 ms. */
    retryMs?: number;
}
/** Returns an EventSource constructor backed by fetch. */
export declare function createFetchEventSource(opts?: FetchEventSourceOptions): EventSourceCtor;
