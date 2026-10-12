/**
 * File Name: node-ssr.ts
 * Purpose: Generic Node-side scope for the toolbar's SSR timings relay -
 *          wrap ANY server render (Vite SSR, Express, a custom framework)
 *          in collectSsrTimings() and every SDK request made inside it is
 *          captured per-request via AsyncLocalStorage, ready to inject as
 *          the contract script tag. Framework adapters (@tangen/astro,
 *          @tangen/nextjs) are conveniences over this same idea.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Node-only (node:async_hooks) - import from
 *          '@tangen/sdk/node', never from browser code. Concurrent requests
 *          are isolated: each collectSsrTimings call gets its own store.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { observeRequests, type ObservedRequest } from './observe'
import { renderSsrTimingsTag } from './ssr'

interface Store { entries: ObservedRequest[] }

const als = new AsyncLocalStorage<Store>()

let subscribed = false
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  observeRequests((info) => {
    als.getStore()?.entries.push(info)
  })
}

export interface SsrTimingsResult<T> {
  /** Whatever the render function returned. */
  result: T
  /** The SDK requests the render made, in arrival order. */
  entries: ObservedRequest[]
  /** The contract script tag - inject before </body>. Empty string when no requests. */
  scriptTag: string
}

/**
 * Runs a server render and collects every SDK request it makes (across all
 * clients, through awaits, isolated from concurrent requests).
 */
export async function collectSsrTimings<T>(render: () => Promise<T> | T): Promise<SsrTimingsResult<T>> {
  ensureSubscribed()
  const store: Store = { entries: [] }
  const result = await als.run(store, async () => render())
  return {
    result,
    entries: store.entries,
    scriptTag: store.entries.length > 0 ? renderSsrTimingsTag(store.entries) : '',
  }
}

/**
 * Injects the timings tag into an HTML string, just before </body> (appended
 * at the end when no </body> exists). No-op for empty entries.
 */
export function injectSsrTimings(html: string, entries: ObservedRequest[]): string {
  if (entries.length === 0) return html
  const tag = renderSsrTimingsTag(entries)
  const idx = html.lastIndexOf('</body>')
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx)
}
