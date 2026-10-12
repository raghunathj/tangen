/**
 * File Name: collect.ts
 * Purpose: The toolbar's collectors - web vitals for the page (LCP/CLS/INP/
 *          TTFB/FCP + load time), console error/warn capture, and the SDK
 *          request feed via @tangen/sdk's observeRequests.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: All initializers are idempotent and SSR-safe; the
 *          wrapped console originals are ALWAYS called; capture starts when
 *          the toolbar mounts and keeps running for the page's lifetime
 *          (remounts must not double-register).
 */
import { onLCP, onCLS, onINP, onTTFB, onFCP, type Metric } from 'web-vitals'
import { observeRequests } from '@tangen/sdk'
import { setVital, setLoadMs, pushConsole, pushRequest, type CwvRating } from './state'

const MAX_TEXT = 500

let vitalsInit = false
let consoleInit = false
let requestsInit = false

/** Web vitals + document load time. Idempotent; no-op off-browser. */
export function initVitalsCollection(): void {
  if (vitalsInit || typeof window === 'undefined') return
  vitalsInit = true

  const record = (m: Metric) =>
    setVital(m.name as 'LCP' | 'CLS' | 'INP' | 'TTFB' | 'FCP', Math.round(m.value * 1000) / 1000, m.rating as CwvRating)
  onLCP(record)
  onCLS(record)
  onINP(record)
  onTTFB(record)
  onFCP(record)

  const captureLoad = () => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (n && n.loadEventEnd > 0) setLoadMs(Math.round(n.loadEventEnd))
  }
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav && nav.loadEventEnd > 0) captureLoad()
  else window.addEventListener('load', () => setTimeout(captureLoad, 0), { once: true })
}

function fmtArg(a: unknown): string {
  try {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
    return JSON.stringify(a)
  } catch {
    try { return String(a) } catch { return '[unprintable]' }
  }
}

function record(level: 'error' | 'warn', args: unknown[]): void {
  try {
    const text = args.map(fmtArg).join(' ').slice(0, MAX_TEXT)
    pushConsole({ level, text, at: Date.now() })
  } catch { /* capture must never break the console */ }
}

/** console.error/warn + uncaught errors + unhandled rejections. Idempotent. */
export function initConsoleCollection(): void {
  if (consoleInit) return
  consoleInit = true

  const origError = console.error
  const origWarn = console.warn
  console.error = (...args: unknown[]) => {
    record('error', args)
    origError.apply(console, args)
  }
  console.warn = (...args: unknown[]) => {
    record('warn', args)
    origWarn.apply(console, args)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      record('error', [e.message ?? 'Uncaught error', e.filename ? `(${e.filename}:${e.lineno})` : ''])
    })
    window.addEventListener('unhandledrejection', (e) => {
      record('error', ['Unhandled rejection:', (e as PromiseRejectionEvent).reason])
    })
  }
}

/** Feed every SDK request into the Requests tab. Idempotent. */
export function initRequestCollection(): void {
  if (requestsInit) return
  requestsInit = true
  observeRequests(pushRequest)
}

/** Test hook - reset init flags (console originals are NOT restored). */
export function _resetCollectorsForTests(): void {
  vitalsInit = false
  consoleInit = false
  requestsInit = false
}
