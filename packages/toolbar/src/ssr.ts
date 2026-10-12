/**
 * File Name: ssr.ts
 * Purpose: Client side of the SSR timings relay - find the JSON script tag a
 *          server render printed (any backend implementing the contract, or
 *          an adapter like @tangen/nextjs) and feed its requests into the
 *          toolbar's Requests tab marked as server-side.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The tag id + payload shape are defined by
 *          @tangen/sdk/ssr (v:1). Entries are validated defensively - a
 *          malformed tag is ignored, never thrown on. Idempotent + SSR-safe.
 */
import { pushRequest } from './state'

export const SSR_TIMINGS_TAG_ID = '__tangen-ssr-timings'

interface RawEntry {
  path?: unknown
  method?: unknown
  status?: unknown
  wallMs?: unknown
  serverTiming?: unknown
}

/** Parses + validates the tag's payload. Returns [] for anything malformed. */
export function readSsrTimings(root: Pick<Document, 'getElementById'> | undefined =
  typeof document !== 'undefined' ? document : undefined): Array<{
  path: string; method: string; status: number; wallMs: number
  serverTiming?: { dbMs: number; queueMs: number; queries?: number; dup?: number }
}> {
  if (!root) return []
  try {
    const el = root.getElementById(SSR_TIMINGS_TAG_ID)
    if (!el?.textContent) return []
    const payload = JSON.parse(el.textContent)
    if (payload?.v !== 1 || !Array.isArray(payload.requests)) return []
    const out = []
    for (const r of payload.requests as RawEntry[]) {
      if (typeof r?.path !== 'string' || typeof r?.method !== 'string') continue
      if (typeof r.status !== 'number' || typeof r.wallMs !== 'number') continue
      const st = r.serverTiming as Record<string, unknown> | undefined
      out.push({
        path: r.path,
        method: r.method,
        status: r.status,
        wallMs: r.wallMs,
        ...(st && typeof st.dbMs === 'number' && typeof st.queueMs === 'number'
          ? { serverTiming: {
              dbMs: st.dbMs,
              queueMs: st.queueMs,
              ...(typeof st.queries === 'number' ? { queries: st.queries } : {}),
              ...(typeof st.dup === 'number' ? { dup: st.dup } : {}),
            } }
          : {}),
      })
    }
    return out
  } catch {
    return []
  }
}

let ssrInit = false

/** Reads the tag once and feeds the Requests tab. Idempotent; no-op off-browser. */
export function initSsrTimingsCollection(): void {
  if (ssrInit || typeof document === 'undefined') return
  ssrInit = true
  for (const r of readSsrTimings()) pushRequest({ ...r, source: 'server' })
}

/** Test hook - reset the init flag. */
export function _resetSsrForTests(): void {
  ssrInit = false
}
