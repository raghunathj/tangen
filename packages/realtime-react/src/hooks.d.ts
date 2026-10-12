import type { RealtimeHandler, RealtimeStatus, RealtimeClient } from '@tangen/realtime';
import { type ClientOption } from './provider';
export interface UseRealtimeEventOptions extends ClientOption {
    /** Off switches the subscription without unmounting the caller. Default true. */
    enabled?: boolean;
    /**
     * The server could not replay what this topic missed (reconnect outside
     * the window): refetch canonical state. Most pages pass their load().
     */
    onResync?: (topic: string) => void;
}
/**
 * Subscribes a handler to a topic while the component is mounted; the
 * latest handler always runs.
 * @param topic - A logical topic (`objects:post`, `object:<id>`, `ext:<id>:<name>`).
 * @param handler - Runs per envelope; refetch from here.
 * @param opts - `client` (else the provider's), `enabled`, `onResync`.
 */
export declare function useRealtimeEvent<T extends Record<string, unknown> = Record<string, unknown>>(topic: string, handler: RealtimeHandler<T>, opts?: UseRealtimeEventOptions): void;
/**
 * The connection status of a client as React state: `idle` until something
 * subscribes, then `connecting | open | reconnecting | closed`.
 * @param client - Explicit client; `null` reads as idle; omitted uses the provider's.
 */
export declare function useRealtimeStatus(client?: RealtimeClient | null): RealtimeStatus;
