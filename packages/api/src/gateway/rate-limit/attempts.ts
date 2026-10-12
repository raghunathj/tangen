/**
 * File Name: attempts.ts
 * Purpose: A small attempt limiter over the rate-limit store, for the
 *   budgets that live outside the Gateway hook - a route counting its own
 *   attempts against a key of its choosing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Plan section 15 named two in-process Maps that did
 *   not use any store: workspace setup (3 attempts a minute per workspace)
 *   and the Porter gatekeeper (10 redemption attempts in 15 minutes per
 *   caller, lockout, success forgets). A Map is correct on one process and
 *   wrong on two: a second process hands out a fresh budget, which for the
 *   gatekeeper means an attacker who spreads guesses across processes never
 *   meets the lockout. This helper gives those callers the M5 store -
 *   memory, Redis or Postgres, whichever the deployment resolved - with
 *   the same fixed-window shape the Gateway's own counters use, and keeps
 *   the budgets exactly as they were. Nothing here decides observe versus
 *   enforce: these two budgets were always enforced, and they stay so.
 *
 *   Fail-open like every store read (D-5): a store error counts nothing,
 *   lets the attempt through and is logged and counted by hitOrOpen.
 */
import { RequestError } from '../../lib/errors'
import { hitOrOpen, activeRateLimitStore, type RateLimitStore, type WindowState } from './store'

export interface AttemptBudget {
  /** Names the counter: `tangen:rl:<id>:<key>`. */
  id: string
  /** Window length in seconds. */
  window: number
  /** Attempts permitted per window. The next one is over. */
  limit: number
}

export interface AttemptState extends WindowState {
  /** Whether this attempt exceeded the budget. */
  over: boolean
}

export interface AttemptLimiter {
  /** Counts one attempt. Null when the store failed (allowed, uncounted). */
  hit(key: string): Promise<AttemptState | null>
  /** Counts one attempt and refuses with 429 RATE_LIMITED when over budget. */
  check(key: string, message?: string): Promise<void>
  /** Drops the key's counter: a success that ends a lockout, or a test. */
  forget(key: string): Promise<void>
}

/**
 * Builds a limiter for one budget.
 * @param budget - The id, window and limit.
 * @param store - Where to count; the process store by default, read per
 *                call so a store installed after the limiter is seen.
 * @returns The limiter.
 */
export function attemptLimiter(budget: AttemptBudget, store: () => RateLimitStore = activeRateLimitStore): AttemptLimiter {
  const keyFor = (key: string) => `tangen:rl:${budget.id}:${key}`
  return {
    async hit(key) {
      const state = await hitOrOpen(store(), keyFor(key), budget.window)
      if (!state) return null
      return { ...state, over: state.count > budget.limit }
    },
    async check(key, message = 'Too many attempts - try again later') {
      const state = await this.hit(key)
      if (!state?.over) return
      const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000))
      throw new RequestError('RATE_LIMITED', message, 429, undefined, { retryAfterSeconds, policy: budget.id })
    },
    async forget(key) {
      try { await store().forget(keyFor(key)) } catch { /* a failed forget is a longer lockout, not an outage */ }
    },
  }
}
