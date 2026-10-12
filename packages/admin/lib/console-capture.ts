/**
 * File Name: console-capture.ts
 * Purpose: Console half of the Performance Monitor - captures console.error/
 *          console.warn plus uncaught errors and unhandled rejections into a
 *          bounded ring with page attribution, so the floating pill can show
 *          an error badge and the panel a Console section without opening
 *          devtools.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The wrapped originals are ALWAYS called - capture must
 *          never change console behavior. Formatting is defensive (circular
 *          objects, throwing toString) and truncated; capture is initialized
 *          by the pill, i.e. only for Devspace-capable members.
 */
import { create } from 'zustand'

const RING = 50
const MAX_TEXT = 500

export interface ConsoleEntry {
  level: 'error' | 'warn'
  text: string
  at: number
  page?: string
}

interface ConsoleState {
  entries: ConsoleEntry[]
  errorCount: number
  warnCount: number
  push: (e: ConsoleEntry) => void
  reset: () => void
}

export const useConsoleStore = create<ConsoleState>()((set) => ({
  entries: [],
  errorCount: 0,
  warnCount: 0,
  push: (e) => set((s) => ({
    entries: [...s.entries.slice(-(RING - 1)), e],
    errorCount: s.errorCount + (e.level === 'error' ? 1 : 0),
    warnCount: s.warnCount + (e.level === 'warn' ? 1 : 0),
  })),
  reset: () => set({ entries: [], errorCount: 0, warnCount: 0 }),
}))

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
    const text = args.map(fmtArg).filter((s) => s !== undefined && s !== 'undefined').join(' ').slice(0, MAX_TEXT)
    const page = typeof window !== 'undefined' ? window.location?.pathname : undefined
    useConsoleStore.getState().push({ level, text, at: Date.now(), ...(page ? { page } : {}) })
  } catch { /* capture must never break the console */ }
}

let initialized = false

/** Test hook: allow re-init after restoring the real console. */
export function _resetConsoleCaptureForTests(): void {
  initialized = false
  useConsoleStore.getState().reset()
}

/** Wrap console.error/warn + global error events. Idempotent. */
export function initConsoleCapture(): void {
  if (initialized) return
  initialized = true

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
