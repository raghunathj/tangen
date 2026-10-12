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
import type { ClientMessage, PresenceClaim, PresenceMessage, PresenceSession, PresenceState, RealtimeEvent } from './protocol';
export interface PresenceScopeSnapshot {
    scope: string;
    /** This client asked to be on the scope (join without a leave yet). */
    joined: boolean;
    /** This client's own session id on the scope, once the server acknowledged the join. */
    self: string | null;
    /** Everyone on the scope including self, oldest first. */
    members: PresenceSession[];
    claim: PresenceClaim | null;
    /** Increments on every change; a cheap "did anything change" for consumers. */
    version: number;
}
export declare class PresenceStore {
    private readonly scopes;
    private readonly listeners;
    private readonly empties;
    /** The scope's snapshot; a stable empty one for a scope nothing has touched. */
    get(scope: string): PresenceScopeSnapshot;
    subscribe(scope: string, listener: (snapshot: PresenceScopeSnapshot) => void): () => void;
    private put;
    setJoined(scope: string, joined: boolean): void;
    /** The server's answer to a join replaces everything known about the scope. */
    applySnapshot(message: PresenceMessage): void;
    /** A presence envelope on `presence:<scope>`: join and update set the session, leave removes it; all carry the claim. */
    applyEvent(event: RealtimeEvent): void;
    /** No longer joined, but still observed: the members stay, the server's envelopes keep them right. */
    unjoin(scope: string): void;
    /** Forgets the scope entirely (after a leave). */
    clear(scope: string): void;
}
export interface PresenceVisibility {
    hidden(): boolean;
    onChange(listener: () => void): () => void;
}
export interface PresenceTimers {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}
export interface PresenceControllerDeps {
    store: PresenceStore;
    /** Sends one upstream message on the open WebSocket; false when there is none (or it is SSE). */
    send(message: ClientMessage): boolean;
    /** Subscribes a handler to a topic (the client's own subscribe). */
    subscribeTopic(topic: string, handler: (event: RealtimeEvent) => void): () => void;
    /** Override of the server's heartbeat period (ms). */
    heartbeatMs?: number;
    /** Minimum spacing of presence messages per scope. Default 2000 (the server's limit). */
    minIntervalMs?: number;
    pauseWhenHidden?: boolean;
    visibility?: PresenceVisibility;
    timers?: PresenceTimers;
    now?: () => number;
}
export interface PresenceApi {
    /** Joins a scope with a state; subscribes to `presence:<scope>`; returns the leave. */
    join(scope: string, state: PresenceState): () => void;
    /** Replaces the state; `takeover: true` with `state: 'editing'` moves the advisory claim here. */
    update(scope: string, state: PresenceState, opts?: {
        takeover?: boolean;
    }): void;
    leave(scope: string): void;
    /**
     * Observes a scope without joining: subscribes to `presence:<scope>` so
     * the server's snapshot (sent for a per-type aggregate such as
     * `objects:post` on subscribe) and its envelopes fill the store. Returns
     * the unwatch; the last unwatch of a scope nothing joined forgets it.
     */
    watch(scope: string): () => void;
    /** Sends a heartbeat now (every joined scope, or one). */
    heartbeat(scope?: string): void;
    get(scope: string): PresenceScopeSnapshot;
    subscribe(scope: string, listener: (snapshot: PresenceScopeSnapshot) => void): () => void;
    /** The state this client last asked for on a scope. */
    intent(scope: string): PresenceState | null;
    /** Scopes joined right now. */
    scopes(): string[];
    /** True while the heartbeat timer runs: exactly while something is joined and the document is visible. */
    heartbeatRunning(): boolean;
    /** True when the open transport can carry presence (WebSocket). */
    supported(): boolean;
}
/** The controller as the client drives it (PresenceApi plus the connection hooks). */
export interface PresenceController extends PresenceApi {
    onReady(self: string, heartbeatSeconds?: number, canSend?: boolean): void;
    onDisconnected(): void;
    applySnapshot(message: PresenceMessage): void;
    dispose(): void;
}
export declare function createPresenceController(deps: PresenceControllerDeps): PresenceController;
