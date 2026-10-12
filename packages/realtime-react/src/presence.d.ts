import type { PresenceScopeSnapshot, PresenceState } from '@tangen/realtime';
import { type ClientOption } from './provider';
export interface UsePresenceOptions extends ClientOption {
    /** Off leaves (or never joins) without unmounting. Default true. */
    enabled?: boolean;
}
export interface UsePresenceSelectorOptions<T> extends ClientOption {
    /** When the previous and the next selection are equal, the component does not re-render. Default: shallow. */
    equals?: (a: T, b: T) => boolean;
}
/** Shallow equality: primitives by Object.is, arrays and plain objects one level deep. */
export declare function shallowEqual(a: unknown, b: unknown): boolean;
/** What a scope looks like with no client bound: nobody there, nothing joined. */
export declare const EMPTY_PRESENCE: PresenceScopeSnapshot;
/**
 * Re-renders only when the selected slice of a scope's presence changes.
 * Observes without joining; pair it with usePresence (or a join elsewhere)
 * to make the scope live.
 * @param scope - `object:<id>`, `page:<id>` or `flow:<id>`.
 * @param selector - Picks the slice; runs on every snapshot, cheap by design.
 * @param opts - `client` (else the provider's), `equals` (default shallow).
 */
export declare function usePresenceSelector<T>(scope: string, selector: (snapshot: PresenceScopeSnapshot) => T, opts?: UsePresenceSelectorOptions<T>): T;
/**
 * Joins a scope with a state while mounted (heartbeats meanwhile, leaves on
 * unmount) and returns the scope's snapshot. The state is compared by
 * value across renders; a change is sent as an update.
 * @param scope - `object:<id>`, `page:<id>` or `flow:<id>`.
 * @param state - What this session is doing: `{ state: 'viewing' | 'editing' | 'idle', field?, block?, meta? }`.
 * @param opts - `client` (else the provider's), `enabled`.
 */
export declare function usePresence(scope: string, state: PresenceState, opts?: UsePresenceOptions): PresenceScopeSnapshot;
export interface UsePresenceWatchOptions extends ClientOption {
    /** Off unwatches (or never watches) without unmounting. Default true. */
    enabled?: boolean;
}
/**
 * Observes a scope while mounted without joining it: the subscription to
 * `presence:<scope>` brings the server's snapshot (answered on subscribe for
 * a per-type aggregate such as `objects:post`) and its envelopes into the
 * store, which usePresenceSelector reads. One watch per list, never one
 * per row: each row selects its own people from this one scope.
 * @param scope - `objects:<type>` (the aggregate), or any presence scope.
 * @param opts - `client` (else the provider's), `enabled`.
 */
export declare function usePresenceWatch(scope: string, opts?: UsePresenceWatchOptions): void;
