/**
 * File Name: query-monitor-client.ts
 * Purpose: Client side of the floating Query Monitor - adminFetch taps the
 *   X-Tangen-Qm response header (emitted by the API's capture plugin when
 *   monitoring is on) into a small store; the floating widget renders the
 *   current page's accumulated query cost from it.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { create } from 'zustand'

export interface QmPing {
  id: string
  method: string
  path: string
  queries: number
  /** Real execution time; connection-queue wait is reported separately. */
  dbMs: number
  /** Time queries spent waiting for a pooled connection (burst/cold loads). */
  waitMs: number
  dup: number
  ts: number
}

interface QmClientState {
  pings: QmPing[]
  push: (p: QmPing) => void
  reset: () => void
}

const MAX_PINGS = 50

export const useQmClientStore = create<QmClientState>()((set) => ({
  pings: [],
  push: (p) => set((s) => ({ pings: [...s.pings.slice(-(MAX_PINGS - 1)), p] })),
  reset: () => set({ pings: [] }),
}))

/** Parses `<id>;q=N;db=X;dup=D[;wait=W]` - returns null on anything unexpected. */
export function parseQmHeader(value: string | null): Omit<QmPing, 'method' | 'path' | 'ts'> | null {
  if (!value) return null
  const [id, ...parts] = value.split(';')
  if (!id) return null
  const kv: Record<string, number> = {}
  for (const part of parts) {
    const [k, v] = part.split('=')
    const n = Number(v)
    if (k && Number.isFinite(n)) kv[k] = n
  }
  if (kv.q == null) return null
  return { id, queries: kv.q, dbMs: kv.db ?? 0, waitMs: kv.wait ?? 0, dup: kv.dup ?? 0 }
}

/** Called by adminFetch after every response - no-op unless the header is present. */
export function recordQmResponse(path: string, method: string, res: Response): void {
  try {
    const parsed = parseQmHeader(res.headers.get('x-tangen-qm'))
    if (!parsed) return
    useQmClientStore.getState().push({ ...parsed, method: method.toUpperCase(), path, ts: Date.now() })
  } catch { /* observability must never break a fetch */ }
}

// ── Floating pill visibility preference ──────────────────────────────────────
// Hidden via the pill's own Hide button; re-enabled from the Devspace
// Performance Monitor page. Per-browser (localStorage), same-tab updates via
// a window event so both surfaces stay in sync without a store.

const FAB_HIDDEN_KEY = 'tangen.qm.fab.hidden'
export const FAB_VISIBILITY_EVENT = 'tangen:qm-fab-visibility'

export function isFabHidden(): boolean {
  try { return localStorage.getItem(FAB_HIDDEN_KEY) === '1' } catch { return false }
}

export function setFabHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(FAB_HIDDEN_KEY, '1')
    else localStorage.removeItem(FAB_HIDDEN_KEY)
  } catch { /* private mode */ }
  try {
    window.dispatchEvent(new CustomEvent(FAB_VISIBILITY_EVENT, { detail: { hidden } }))
  } catch { /* non-browser */ }
}
