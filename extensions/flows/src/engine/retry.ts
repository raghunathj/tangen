/**
 * File Name: retry.ts
 * Purpose: The retry policy (closure plan Phase 9B, Unit 8). Four fields, two
 *          strategies, a small ceiling and a bounded delay - not a retry DSL,
 *          and not a default that quietly repeats work nobody classified as
 *          safe to repeat.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure, and deterministic: jitter takes an injected random
 *          source so a test asserts the same number the scheduler will use.
 */
import { isRetryable, type FlowFailure } from './failure'

export interface RetryPolicy {
  /** TOTAL attempts including the first. 1 means "do not retry". */
  maxAttempts: number
  backoff: 'fixed' | 'exponential'
  baseDelaySeconds: number
  /** Shorten the delay by up to its own length, to spread a thundering herd. */
  jitter?: boolean
}

/** Small on purpose: a node that needs six tries needs a different design. */
export const MAX_ATTEMPTS_CEILING = 5
/** One hour. A retry further out than this is a schedule, not a retry. */
export const MAX_DELAY_SECONDS = 3_600
export const MIN_DELAY_SECONDS = 1

/**
 * No retry. A flow author asks for retries deliberately, because the system
 * cannot know whether the action they wired up is safe to repeat.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoff: 'exponential',
  baseDelaySeconds: 30,
}

export interface ParsedRetryPolicy {
  policy: RetryPolicy
  /** Empty when the declaration was honoured; otherwise why it was not. */
  issues: string[]
}

/**
 * Reads a node's retry declaration.
 *
 * Accepts the legacy `retries: n` (which meant n EXTRA attempts) so existing
 * flows keep the behaviour they were authored with. An unusable declaration
 * returns the DEFAULT with the reason, never a silently repaired policy: a
 * flow author who typed `maxAttempts: 99` should be told, not given 5.
 */
export function parseRetryPolicy(raw: unknown): ParsedRetryPolicy {
  const issues: string[] = []
  if (raw === null || typeof raw !== 'object') return { policy: DEFAULT_RETRY_POLICY, issues }
  const src = raw as Record<string, unknown>

  const legacy = src.retries
  const declaredAttempts = src.maxAttempts !== undefined
    ? Number(src.maxAttempts)
    : legacy !== undefined ? 1 + Number(legacy) : undefined

  if (declaredAttempts === undefined) return { policy: DEFAULT_RETRY_POLICY, issues }
  if (!Number.isInteger(declaredAttempts) || declaredAttempts < 1 || declaredAttempts > MAX_ATTEMPTS_CEILING) {
    issues.push(`maxAttempts must be between 1 and ${MAX_ATTEMPTS_CEILING}`)
  }

  const backoff = src.backoff === undefined ? DEFAULT_RETRY_POLICY.backoff : src.backoff
  if (backoff !== 'fixed' && backoff !== 'exponential') issues.push("backoff must be 'fixed' or 'exponential'")

  const base = src.baseDelaySeconds === undefined ? DEFAULT_RETRY_POLICY.baseDelaySeconds : Number(src.baseDelaySeconds)
  if (!Number.isFinite(base) || base < MIN_DELAY_SECONDS || base > MAX_DELAY_SECONDS) {
    issues.push(`baseDelaySeconds must be between ${MIN_DELAY_SECONDS} and ${MAX_DELAY_SECONDS}`)
  }

  if (issues.length) return { policy: DEFAULT_RETRY_POLICY, issues }
  return {
    policy: {
      maxAttempts: declaredAttempts,
      backoff: backoff as RetryPolicy['backoff'],
      baseDelaySeconds: base,
      ...(src.jitter === true ? { jitter: true } : {}),
    },
    issues,
  }
}

/**
 * How long before attempt `attempt + 1`. Bounded at both ends, so no policy
 * can schedule a retry in a second or in a year.
 */
export function nextDelaySeconds(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  const raw = policy.backoff === 'fixed'
    ? policy.baseDelaySeconds
    : policy.baseDelaySeconds * 2 ** Math.max(0, attempt - 1)
  let delay = Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, Math.round(raw)))
  if (policy.jitter) {
    // Full jitter, downwards only: a retry never lands LATER than the policy
    // says, so a bound stays a bound.
    delay = Math.max(MIN_DELAY_SECONDS, Math.round(delay * (1 - random() * 0.5)))
  }
  return delay
}

/**
 * Whether attempt `attempt` should be followed by another.
 *
 * Only a DECLARED retryable failure is retried. `unknown` is not a maybe: an
 * action nobody classified may not be idempotent, and repeating it is the one
 * decision this system must not make on its own.
 */
export function shouldRetry(policy: RetryPolicy, failure: FlowFailure, attempt: number): boolean {
  if (!isRetryable(failure)) return false
  return attempt < policy.maxAttempts
}
