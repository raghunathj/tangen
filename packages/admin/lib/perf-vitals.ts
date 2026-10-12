/**
 * File Name: perf-vitals.ts
 * Purpose: Page-timing half of the Performance Monitor - web vitals for the
 *          initial app load (LCP/CLS/INP/TTFB/FCP + load time) and a
 *          route-change timer for SPA navigations (route change -> last
 *          in-flight adminFetch settled), feeding the floating pill's Page
 *          section.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: web-vitals (ratings come from the library's own CWV
 *          thresholds - we never hand-roll bands). Route changes are detected
 *          by patching history.pushState/replaceState so the timer starts
 *          BEFORE the new page's mount effects fire their fetches (React
 *          effect ordering would start it after). Search-param-only changes
 *          (filter sync uses replaceState) never restart the timer.
 */
import { create } from 'zustand'
import { onLCP, onCLS, onINP, onTTFB, onFCP, type Metric } from 'web-vitals'

export type CwvRating = 'good' | 'needs-improvement' | 'poor'
export type VitalName = 'LCP' | 'CLS' | 'INP' | 'TTFB' | 'FCP'

interface Vital { value: number; rating: CwvRating }

interface PerfState {
  vitals: Partial<Record<VitalName, Vital>>
  /** Initial document load time (Navigation Timing loadEventEnd), ms. */
  loadMs: number | null
  /** Last settled SPA route navigation: path + network-settle duration. */
  routePath: string | null
  routeMs: number | null
  setVital: (name: VitalName, value: number, rating: CwvRating) => void
  setLoadMs: (ms: number) => void
  setRouteMs: (path: string, ms: number) => void
  reset: () => void
}

export const usePerfStore = create<PerfState>()((set) => ({
  vitals: {},
  loadMs: null,
  routePath: null,
  routeMs: null,
  setVital: (name, value, rating) => set((s) => ({ vitals: { ...s.vitals, [name]: { value, rating } } })),
  setLoadMs: (ms) => set({ loadMs: ms }),
  setRouteMs: (path, ms) => set({ routePath: path, routeMs: ms }),
  reset: () => set({ vitals: {}, loadMs: null, routePath: null, routeMs: null }),
}))

/** Maps a CWV rating to the pill's semantic tone. */
export function ratingTone(r?: CwvRating): 'good' | 'warn' | 'bad' | 'muted' {
  if (r === 'good') return 'good'
  if (r === 'needs-improvement') return 'warn'
  if (r === 'poor') return 'bad'
  return 'muted'
}

// ── Route-change timer (pure state machine - tested with a fake clock) ───────

export interface RouteTimerOpts {
  now: () => number
  /** Silence after the last fetch settles before we call the route done. */
  quietMs?: number
  /** How long a route with NO fetches waits before settling at 0ms. */
  noFetchGraceMs?: number
  onSettle: (path: string, ms: number) => void
}

export interface RouteTimer {
  begin: (path: string) => void
  fetchStart: () => void
  fetchEnd: () => void
  /** Drive from an interval (or fake clock in tests); settles when due. */
  tick: () => void
}

export function createRouteTimer(opts: RouteTimerOpts): RouteTimer {
  const { now, onSettle } = opts
  const quietMs = opts.quietMs ?? 150
  const noFetchGraceMs = opts.noFetchGraceMs ?? quietMs
  let path: string | null = null
  let beginAt = 0
  let inflight = 0
  let lastEnd = 0
  let sawFetch = false
  let done = true

  return {
    begin(p: string) {
      path = p
      beginAt = now()
      inflight = 0
      lastEnd = 0
      sawFetch = false
      done = false
    },
    fetchStart() {
      if (path === null) return
      sawFetch = true
      inflight++
    },
    fetchEnd() {
      // Guarded so fetches begun under an abandoned route can't underflow.
      if (inflight > 0) {
        inflight--
        if (inflight === 0) lastEnd = now()
      }
    },
    tick() {
      if (done || path === null) return
      const t = now()
      if (!sawFetch) {
        if (t - beginAt >= noFetchGraceMs) {
          done = true
          onSettle(path, 0)
        }
        return
      }
      if (inflight === 0 && lastEnd > 0 && t - lastEnd >= quietMs) {
        done = true
        onSettle(path, Math.round(lastEnd - beginAt))
      }
    },
  }
}

// ── Browser wiring (idempotent) ──────────────────────────────────────────────

let initialized = false
let timer: RouteTimer | null = null
let tickHandle: ReturnType<typeof setInterval> | null = null

function ensureTicking(): void {
  if (tickHandle) return
  tickHandle = setInterval(() => timer?.tick(), 120)
}

/** adminFetch taps - safe no-ops before init. */
export function perfFetchStart(): void { timer?.fetchStart(); ensureTicking() }
export function perfFetchEnd(): void { timer?.fetchEnd() }

/**
 * Starts vitals collection + route timing. Idempotent; call from the pill
 * once the member is known to have Devspace access.
 */
export function initPerfMonitor(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const record = (m: Metric) =>
    usePerfStore.getState().setVital(m.name as VitalName, Math.round(m.value * 1000) / 1000, m.rating)
  onLCP(record)
  onCLS(record)
  onINP(record)
  onTTFB(record)
  onFCP(record)

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const captureLoad = () => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (n && n.loadEventEnd > 0) usePerfStore.getState().setLoadMs(Math.round(n.loadEventEnd))
  }
  if (nav && nav.loadEventEnd > 0) captureLoad()
  else window.addEventListener('load', () => setTimeout(captureLoad, 0), { once: true })

  timer = createRouteTimer({
    now: () => performance.now(),
    onSettle: (path, ms) => usePerfStore.getState().setRouteMs(path, ms),
  })
  ensureTicking()

  // Route detection: patch history so the timer starts BEFORE the new page's
  // mount effects fire. Pathname changes only - the admin syncs filters into
  // the URL via replaceState and that must never restart the timer.
  let currentPath = window.location.pathname
  const maybeBegin = () => {
    const p = window.location.pathname
    if (p !== currentPath) {
      currentPath = p
      timer?.begin(p)
      ensureTicking()
    }
  }
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = (...args: Parameters<History['pushState']>) => { origPush(...args); maybeBegin() }
  history.replaceState = (...args: Parameters<History['replaceState']>) => { origReplace(...args); maybeBegin() }
  window.addEventListener('popstate', maybeBegin)

  // The initial route's data load counts too.
  timer.begin(currentPath)
}
