/**
 * File Name: ssr.ts
 * Purpose: The server side of the toolbar's SSR timings relay - collect the
 *          SDK requests a server render makes and serialize them into a JSON
 *          script tag the Tangen Toolbar reads on the client. This is the
 *          WIRE CONTRACT: any backend that can print HTML (Next.js, Nuxt,
 *          PHP, a hand-rolled template) can emit the tag; framework adapters
 *          like @tangen/nextjs are conveniences over these helpers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Create ONE collector per incoming request (entries from
 *          concurrent requests must not mix) and pass its onResponse to the
 *          client config, or push into it from an observeRequests callback
 *          scoped by your framework's per-request context.
 */
import type { ObservedRequest, RequestObserver } from './observe'

/** The DOM id the toolbar looks for. Also the contract's anchor - do not change. */
export const SSR_TIMINGS_TAG_ID = '__tangen-ssr-timings'

/** Versioned payload inside the script tag. */
export interface SsrTimingsPayload {
  v: 1
  requests: ObservedRequest[]
}

export interface SsrRequestCollector {
  /** Feed this to ClientConfig.onResponse (or call it from an observer). */
  onResponse: RequestObserver
  /** The requests collected so far, in arrival order. */
  readonly entries: ObservedRequest[]
  /** The full script tag to print into the page's HTML. */
  toScriptTag(): string
}

/**
 * Per-request collector for server-side SDK timings. Bounded so a pathological
 * render cannot bloat the HTML.
 */
export function createSsrRequestCollector(max = 50): SsrRequestCollector {
  const entries: ObservedRequest[] = []
  return {
    entries,
    onResponse(info: ObservedRequest): void {
      if (entries.length < max) entries.push(info)
    },
    toScriptTag(): string {
      return renderSsrTimingsTag(entries)
    },
  }
}

/**
 * Serializes collected requests as the toolbar's SSR timings tag. `<` is
 * escaped so `</script>` inside values can never terminate the tag early.
 */
export function renderSsrTimingsTag(requests: ObservedRequest[]): string {
  const payload: SsrTimingsPayload = { v: 1, requests }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  return `<script type="application/json" id="${SSR_TIMINGS_TAG_ID}">${json}</script>`
}
