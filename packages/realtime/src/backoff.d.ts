/**
 * File Name: backoff.ts
 * Purpose: Reconnect delays - exponential with full jitter, bounded.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The architecture's section 41: reconnect is the SDK's
 *          job, with exponential backoff, jitter and bounded retries. Full
 *          jitter (a uniform draw between zero and the capped exponential)
 *          is what keeps a thousand tabs that lost one process from all
 *          returning in the same hundred milliseconds. Pure and injectable,
 *          so the client's tests can make it deterministic.
 */
export interface BackoffOptions {
    /** First delay ceiling. Default 500 ms. */
    baseMs?: number;
    /** Largest delay ceiling. Default 30 s. */
    maxMs?: number;
    /** Attempts before the client gives up. Default 20. Infinity never gives up. */
    maxAttempts?: number;
    /** Injected for tests; default Math.random. */
    random?: () => number;
}
export interface Backoff {
    /** Delay for the given attempt (0-based), or null when attempts are exhausted. */
    delayFor(attempt: number): number | null;
}
export declare function createBackoff(opts?: BackoffOptions): Backoff;
