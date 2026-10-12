/**
 * File Name: detail.ts
 * Purpose: Request drill-down state for the Requests tab - which row is
 *          expanded and the fetched per-query detail (redacted statement
 *          shapes + timings) for each Performance Monitor entry id, loaded
 *          through the SDK's registered detail fetcher.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The toolbar holds NO API key - detail only loads when
 *          the site's SDK client opted in via createClient({ toolbarDetail:
 *          true }), which registers the process-wide fetcher in @tangen/sdk.
 *          No fetcher registered = no expansion affordance. Results are
 *          cached per entry id (entries are immutable once finalized).
 */
import { getQmDetailFetcher, type QmRequestDetail } from '@tangen/sdk'

export type QmDetailStatus = 'loading' | 'loaded' | 'unavailable'

export interface QmDetailSlot {
  status: QmDetailStatus
  detail?: QmRequestDetail
}

let expandedQmId: string | null = null
const cache = new Map<string, QmDetailSlot>()

/** Whether Requests rows should offer expansion at all (a fetcher opted in). */
export function canExpandRequests(): boolean {
  return getQmDetailFetcher() !== null
}

export function getExpandedQmId(): string | null {
  return expandedQmId
}

export function getDetailSlot(qmId: string): QmDetailSlot | undefined {
  return cache.get(qmId)
}

/**
 * Expands (or collapses) the row for a Performance Monitor entry and kicks
 * off the detail fetch on first expand. `onChange` fires on every state
 * transition so the renderer can repaint; fetch errors resolve to
 * 'unavailable' - the toolbar must never surface an exception.
 */
export function toggleRequestDetail(qmId: string, onChange: () => void): void {
  if (expandedQmId === qmId) {
    expandedQmId = null
    onChange()
    return
  }
  expandedQmId = qmId
  const fetcher = getQmDetailFetcher()
  if (fetcher && !cache.has(qmId)) {
    cache.set(qmId, { status: 'loading' })
    Promise.resolve()
      .then(() => fetcher(qmId))
      .then(
        (detail) => { cache.set(qmId, detail ? { status: 'loaded', detail } : { status: 'unavailable' }); onChange() },
        () => { cache.set(qmId, { status: 'unavailable' }); onChange() },
      )
  }
  onChange()
}

/** Collapse without toggling (panel close, unmount). */
export function collapseRequestDetail(): void {
  expandedQmId = null
}

/** Test hook - full reset of expansion state and the detail cache. */
export function _resetDetailForTests(): void {
  expandedQmId = null
  cache.clear()
}
