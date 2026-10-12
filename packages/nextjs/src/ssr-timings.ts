/**
 * File Name: ssr-timings.ts
 * Purpose: Next.js App Router adapter for the toolbar's SSR timings relay -
 *          collects the SDK requests each server render makes (per-request
 *          isolation via React's cache()) and renders the JSON script tag
 *          the Tangen Toolbar reads on the client. ~50 lines over the
 *          framework-agnostic contract in @tangen/sdk (createSsrRequestCollector
 *          / renderSsrTimingsTag); other frameworks implement the same tag.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Render <TangenSsrTimings /> once, late in the root
 *          layout's <body>. The component waits for sibling Server Component
 *          fetches to settle - it tracks the SDK's in-flight count
 *          (observeInFlight) and exits once nothing is pending and the entry
 *          count is stable, capped at 1.5s so a stuck request can never
 *          stall streaming for long. Dev tool - gate it like the toolbar
 *          itself (render only outside production).
 */
import { createElement, type ReactElement } from 'react'
import * as React from 'react'
import { observeRequests, observeInFlight, type ObservedRequest, SSR_TIMINGS_TAG_ID } from '@tangen/sdk'

// React.cache gives per-request stores in RSC renders. Outside a request
// context it returns a FRESH value per call (no memoization), which would
// split the observer and the component onto different stores - detect that
// by calling the cached factory twice and fall back to a module singleton
// (no cross-request isolation there - dev-tool tolerable, and Next always
// has the request context).
type Store = { entries: ObservedRequest[]; pending: number }
const cacheFn: <T>(fn: () => T) => () => T =
  (React as { cache?: <T>(fn: () => T) => () => T }).cache ?? ((fn) => fn)
const cachedStore = cacheFn((): Store => ({ entries: [], pending: 0 }))
const fallbackStore: Store = { entries: [], pending: 0 }

function getStore(): Store {
  try {
    const a = cachedStore()
    return a === cachedStore() ? a : fallbackStore
  } catch {
    return fallbackStore
  }
}

let subscribed = false
function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  observeRequests((info) => {
    try { getStore().entries.push(info) } catch { /* outside a request render */ }
  })
  // Track in-flight fetches so the tag can wait for THIS render's requests
  // to settle instead of guessing with a fixed delay.
  observeInFlight((delta) => {
    try { getStore().pending = Math.max(0, getStore().pending + delta) } catch { /* ditto */ }
  })
}
// Subscribe at import time so fetches that happen before this component
// renders (sibling pages/layouts) are already being collected.
ensureSubscribed()

/**
 * Server Component: emits the SSR timings tag for the current request.
 * Place once in the root layout, after {children}.
 */
export async function TangenSsrTimings(): Promise<ReactElement | null> {
  const store = getStore()
  // Wait for concurrently-rendering siblings' SDK fetches: in-flight count
  // zero AND entry count stable for two ticks. Bounded so a stuck request
  // (network error mid-retry) can never stall streaming for long.
  const deadline = Date.now() + 1500
  let last = -1
  let stable = 0
  while (Date.now() < deadline && stable < 2) {
    if (store.pending === 0 && store.entries.length === last) stable++
    else stable = 0
    last = store.entries.length
    await new Promise((r) => setTimeout(r, 10))
  }
  if (store.entries.length === 0) return null
  const payload = JSON.stringify({ v: 1, requests: store.entries.slice(0, 50) })
    .replace(/</g, '\\u003c')
  return createElement('script', {
    type: 'application/json',
    id: SSR_TIMINGS_TAG_ID,
    dangerouslySetInnerHTML: { __html: payload },
  })
}
