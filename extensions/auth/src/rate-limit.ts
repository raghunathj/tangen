/**
 * File Name: rate-limit.ts
 * Purpose: A per-process sliding window for the credential routes (login
 *          attempts per email, codes per address), on top of whatever the
 *          Gateway's `auth` budget applies per IP. Per process by design: the
 *          extension owns no Redis, and a replica set multiplies the allowance
 *          by the replica count, never removes it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { RequestError } from './errors'

const windows = new Map<string, number[]>()

export function enforceRateLimit(workspaceId: string, key: string, max: number, windowSeconds: number, now = Date.now()): void {
  const k = `${workspaceId}:${key}`
  const since = now - windowSeconds * 1000
  const hits = (windows.get(k) ?? []).filter((t) => t > since)
  if (hits.length >= max) {
    throw new RequestError('RATE_LIMITED', 'Too many attempts, try again later', 429)
  }
  hits.push(now)
  windows.set(k, hits)
  if (windows.size > 10_000) {
    for (const [wk, ts] of windows) if (!ts.some((t) => t > since)) windows.delete(wk)
  }
}

/** Test seam: forget every window. */
export function resetRateLimitWindows(): void {
  windows.clear()
}
