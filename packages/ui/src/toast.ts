/**
 * File Name: toast.ts
 * Purpose: The toast store and the imperative `toast.*` API of Lightfield,
 *   the Tangen design system. A toast is a transient acknowledgement:
 *   "{Noun} {past participle}" - Post published, Key revoked - optionally
 *   with ONE action (Undo, Retry, View) or a link, and it goes away by
 *   itself unless it is asked to stay.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zustand store; the Toaster in toaster.tsx draws it.
 *   Rules (2026-09-12, after Geist): one toast per async flow - `toast.promise`
 *   shows a loading toast and REPLACES it with the terminal success or error;
 *   never narrate the steps in between. An action toast lives longer (8s)
 *   than a plain one (4s); `persist` keeps a toast until it is dismissed.
 *   The two-string signature `toast.success(title, description)` is kept.
 */

'use client'
import { create } from 'zustand'

/** Visual style of a toast. `loading` is the in-flight state of toast.promise. */
export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading'

/** ONE thing the reader can do about it: Undo, Retry, View. */
export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

/** Somewhere to go: the created record, the run, the docs. */
export interface ToastLink {
  label: string
  href: string
  /** Opens in a new tab. */
  external?: boolean
}

export interface ToastOptions {
  description?: string
  action?: ToastAction
  link?: ToastLink
  /** Stays until dismissed (an error the reader must see; a loading state). */
  persist?: boolean
  /** Milliseconds on screen. Default 4000; 8000 when there is an action. */
  duration?: number
  /** Update the toast with this id in place instead of adding one. */
  id?: string
}

/** A toast as the store holds it. */
export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  description?: string
  action?: ToastAction
  link?: ToastLink
  /** Milliseconds, or Infinity for a toast that persists. */
  duration: number
}

/** How many toasts stay on screen; older ones are dropped, newest last. */
export const MAX_TOASTS = 5
export const DEFAULT_DURATION = 4000
export const ACTION_DURATION = 8000

interface ToastStore {
  toasts: ToastItem[]
  add: (item: ToastItem) => void
  update: (id: string, patch: Partial<Omit<ToastItem, 'id'>>) => void
  remove: (id: string) => void
  clear: () => void
}

/**
 * Zustand store that holds the active toast queue; use toast.* helpers to enqueue notifications.
 */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (item) =>
    set((s) => {
      const rest = s.toasts.filter((t) => t.id !== item.id)
      return { toasts: [...rest, item].slice(-MAX_TOASTS) }
    }),
  update: (id, patch) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  remove: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

/** The second argument is either the description (the old signature) or the options. */
function normalize(descriptionOrOptions?: string | ToastOptions, options?: ToastOptions): ToastOptions {
  if (typeof descriptionOrOptions === 'string') return { ...options, description: descriptionOrOptions }
  return { ...descriptionOrOptions, ...options }
}

/** The duration a toast gets: what was asked for, else longer when there is something to do. */
export function durationFor(variant: ToastVariant, opts: ToastOptions): number {
  if (opts.persist || variant === 'loading') return Infinity
  if (typeof opts.duration === 'number') return opts.duration
  return opts.action ? ACTION_DURATION : DEFAULT_DURATION
}

function show(variant: ToastVariant, title: string, descriptionOrOptions?: string | ToastOptions, options?: ToastOptions): string {
  const opts = normalize(descriptionOrOptions, options)
  const id = opts.id ?? newId()
  const item: ToastItem = {
    id,
    variant,
    title,
    description: opts.description,
    action: opts.action,
    link: opts.link,
    duration: durationFor(variant, opts),
  }
  const store = useToastStore.getState()
  if (opts.id && store.toasts.some((t) => t.id === opts.id)) store.update(opts.id, item)
  else store.add(item)
  return id
}

export interface ToastPromiseMessages<T> {
  loading: string
  success: string | ((value: T) => string | { title: string; description?: string; action?: ToastAction; link?: ToastLink })
  error: string | ((error: unknown) => string | { title: string; description?: string; action?: ToastAction; link?: ToastLink })
}

function resolveMessage<V>(m: string | ((v: V) => string | { title: string; description?: string; action?: ToastAction; link?: ToastLink }), v: V) {
  const out = typeof m === 'function' ? m(v) : m
  return typeof out === 'string' ? { title: out } : out
}

/**
 * Imperative toast helpers - call toast.success / error / warning / info anywhere.
 * Each returns the toast's id, for `toast.dismiss(id)` or an in-place update.
 */
export const toast = {
  success: (title: string, d?: string | ToastOptions, o?: ToastOptions) => show('success', title, d, o),
  error:   (title: string, d?: string | ToastOptions, o?: ToastOptions) => show('error', title, d, o),
  warning: (title: string, d?: string | ToastOptions, o?: ToastOptions) => show('warning', title, d, o),
  info:    (title: string, d?: string | ToastOptions, o?: ToastOptions) => show('info', title, d, o),
  /** An in-flight state that stays until it is updated or dismissed. */
  loading: (title: string, d?: string | ToastOptions, o?: ToastOptions) => show('loading', title, d, o),
  /** Removes one toast, or every toast. */
  dismiss: (id?: string) => { const s = useToastStore.getState(); if (id) s.remove(id); else s.clear() },
  /**
   * One toast for one async flow: loading while it runs, then the terminal
   * success or error in its place. Returns the promise's own result.
   */
  promise: async <T>(promise: Promise<T>, messages: ToastPromiseMessages<T>): Promise<T> => {
    const id = show('loading', messages.loading)
    try {
      const value = await promise
      const m = resolveMessage(messages.success, value)
      show('success', m.title, { id, description: m.description, action: m.action, link: m.link })
      return value
    } catch (err) {
      const m = resolveMessage(messages.error, err)
      show('error', m.title, { id, description: m.description, action: m.action, link: m.link })
      throw err
    }
  },
}
