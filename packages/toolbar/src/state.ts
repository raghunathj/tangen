/**
 * File Name: state.ts
 * Purpose: The toolbar's tiny observable store - request feed, page vitals,
 *          console entries and the current page's content identity, with a
 *          subscribe/notify surface the shadow-DOM renderer hangs off.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Dependency-free on purpose (no zustand - the toolbar
 *          ships to arbitrary sites and stays light). Rings are bounded.
 */
import type { ObservedRequest } from '@tangen/sdk'

export type CwvRating = 'good' | 'needs-improvement' | 'poor'

export interface VitalSample { value: number; rating: CwvRating }

export interface ConsoleEntry {
  level: 'error' | 'warn'
  text: string
  at: number
}

export interface PageIdentity {
  id: string
  type: string
  slug?: string
  title?: string
}

/** A request row - browser-observed by default, 'server' when relayed via the SSR timings tag. */
export interface ToolbarRequest extends ObservedRequest {
  source?: 'server'
}

export interface ToolbarState {
  requests: ToolbarRequest[]
  vitals: Partial<Record<'LCP' | 'CLS' | 'INP' | 'TTFB' | 'FCP', VitalSample>>
  loadMs: number | null
  console: ConsoleEntry[]
  page: PageIdentity | null
}

const REQUEST_RING = 50
const CONSOLE_RING = 50

type Listener = () => void

const state: ToolbarState = {
  requests: [],
  vitals: {},
  loadMs: null,
  console: [],
  page: null,
}

const listeners = new Set<Listener>()

function notify(): void {
  for (const l of listeners) {
    try { l() } catch { /* renderer errors never propagate */ }
  }
}

export function getState(): ToolbarState {
  return state
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function pushRequest(r: ToolbarRequest): void {
  state.requests = [...state.requests.slice(-(REQUEST_RING - 1)), r]
  notify()
}

export function setVital(name: keyof ToolbarState['vitals'], value: number, rating: CwvRating): void {
  state.vitals = { ...state.vitals, [name]: { value, rating } }
  notify()
}

export function setLoadMs(ms: number): void {
  state.loadMs = ms
  notify()
}

export function pushConsole(e: ConsoleEntry): void {
  state.console = [...state.console.slice(-(CONSOLE_RING - 1)), e]
  notify()
}

export function setPage(p: PageIdentity | null): void {
  state.page = p
  notify()
}

/** Test hook - full reset. */
export function _resetStateForTests(): void {
  state.requests = []
  state.vitals = {}
  state.loadMs = null
  state.console = []
  state.page = null
  listeners.clear()
}
