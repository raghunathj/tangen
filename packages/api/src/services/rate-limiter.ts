/**
 * File Name: rate-limiter.ts
 * Purpose: Implements a Redis-backed sliding-window rate limiter using atomic INCR/EXPIRE,
 *   with fail-open semantics so Redis unavailability never blocks legitimate requests.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: ioredis (injected as any), @tangen/logging, @tangen/types (RateLimitResult).
 */
import { getLogger } from '@tangen/logging'
import type { RateLimitResult } from '@tangen/types'
import { RequestError } from '../lib/errors'
import { redisDisabled } from '../plugins/redis'
import { memoryStore } from '../gateway/rate-limit/store'

/** The window store for a process without Redis. Not shared across processes, which is the honest limit of a Redis-less install. */
let memory = memoryStore()
/** Test seam: forget every per-process window (a suite that logs in twenty times is not an attacker). */
export function resetRateLimitWindows(): void { memory = memoryStore() }

const logger = getLogger(['tangen', 'rate-limit'])

/**
 * Constructs the namespaced Redis key for a rate-limit counter.
 * @param workspaceId - Workspace scope for isolation.
 * @param key - Caller-supplied identifier (e.g. 'form-submit' or an IP address).
 * @returns A fully-qualified Redis key string.
 */
export function buildRateLimitKey(workspaceId: string, key: string): string {
  return `tangen:rl:${workspaceId}:${key}`
}

/**
 * Checks and increments a Redis-backed rate-limit counter for the given key.
 * Uses INCR + EXPIRE to implement a fixed window; on Redis failure the request is allowed
 * so a cache outage never becomes a service outage.
 * @param redis - ioredis client instance.
 * @param workspaceId - Workspace scope for the counter key.
 * @param key - Logical rate-limit identifier (combined with workspace/env to form the Redis key).
 * @param max - Maximum number of requests allowed within the window.
 * @param windowSec - Window duration in seconds; resets when the Redis TTL expires.
 * @returns RateLimitResult with allowed flag, remaining count, and window reset timestamp.
 */
export async function checkRateLimit(
  redis: any,
  workspaceId: string,
  key: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const fullKey = buildRateLimitKey(workspaceId, key)

  // No Redis (unset or disabled): a per-process fixed window keeps the limit
  // real instead of a client for a dummy URL failing and "allowing" - which
  // logged a warning on every login of a Redis-less install and limited nothing.
  if (!redis || redisDisabled()) {
    const w = await memory.hit(fullKey, windowSec)
    return { allowed: w.count <= max, remaining: Math.max(0, max - w.count), resetAt: new Date(w.resetAt) }
  }

  try {
    const count = await redis.incr(fullKey)
    if (count === 1) await redis.expire(fullKey, windowSec)
    const ttl = await redis.ttl(fullKey)
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt: new Date(Date.now() + Math.max(0, ttl) * 1000),
    }
  } catch (err) {
    // Redis down — allow the request so a cache failure never becomes an outage
    logger.warn('Redis rate-limit check failed - allowing request', err instanceof Error ? err : new Error(String(err)))
    return {
      allowed: true,
      remaining: max,
      resetAt: new Date(Date.now() + windowSec * 1000),
    }
  }
}

/**
 * Throws RATE_LIMITED (429) when the counter for the given key exceeds max.
 * Skips silently when redis is null/undefined (development without Redis) and
 * fails open on Redis errors, matching checkRateLimit semantics.
 * @param redis - ioredis client instance, or null to skip enforcement.
 * @param workspaceId - Workspace scope for the counter key.
 * @param key - Logical rate-limit identifier (e.g. 'login:user@site.com').
 * @param max - Maximum number of requests allowed within the window.
 * @param windowSec - Window duration in seconds.
 */
export async function enforceRateLimit(
  redis: any,
  workspaceId: string,
  key: string,
  max: number,
  windowSec: number,
): Promise<void> {
  const result = await checkRateLimit(redis, workspaceId, key, max, windowSec)
  if (!result.allowed) {
    throw new RequestError('RATE_LIMITED', 'Too many attempts - try again later', 429)
  }
}
