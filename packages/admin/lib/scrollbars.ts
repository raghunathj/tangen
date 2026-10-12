/**
 * File Name: scrollbars.ts
 * Purpose: The scrollbar preference (tasks/ui-v2-calibration.md,
 *          "Scrollbars"): scrollbars are hidden by default, the way the
 *          benchmark hides them, and a member who wants to see them turns on
 *          `classic`, which puts `classic-scrollbar` on the root so
 *          globals.css draws thin 35% thumbs everywhere. Persisted, applied
 *          before first paint by index.html, and taken over here.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Mirrors lib/theme.ts (pure helpers + one store). Wheel,
 *          keyboard and trackpad scrolling are never affected: only the
 *          scrollbar's paint is.
 */
import { create } from 'zustand'

export type ScrollbarMode = 'hidden' | 'classic'
export const SCROLLBAR_KEY = 'tangen-scrollbars'
export const SCROLLBAR_CLASS = 'classic-scrollbar'
export const SCROLLBAR_LABELS: Record<ScrollbarMode, string> = { hidden: 'Hidden scrollbars', classic: 'Classic scrollbars' }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type RootLike = { classList: Pick<DOMTokenList, 'add' | 'remove' | 'contains'> }

export function readStoredScrollbars(storage: StorageLike | null | undefined): ScrollbarMode {
  try {
    return storage?.getItem(SCROLLBAR_KEY) === 'classic' ? 'classic' : 'hidden'
  } catch {
    return 'hidden'
  }
}

/** Puts the root in the asked-for state; returns whether anything changed. */
export function applyScrollbars(root: RootLike | null | undefined, mode: ScrollbarMode): boolean {
  if (!root) return false
  const has = root.classList.contains(SCROLLBAR_CLASS)
  if (mode === 'classic' && !has) { root.classList.add(SCROLLBAR_CLASS); return true }
  if (mode === 'hidden' && has) { root.classList.remove(SCROLLBAR_CLASS); return true }
  return false
}

interface ScrollbarState { mode: ScrollbarMode; setMode: (mode: ScrollbarMode) => void }

const storage = (): StorageLike | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export const useScrollbars = create<ScrollbarState>()((set) => ({
  mode: readStoredScrollbars(storage()),
  setMode: (next) => {
    try { storage()?.setItem(SCROLLBAR_KEY, next) } catch {}
    set({ mode: next })
    if (typeof document !== 'undefined') applyScrollbars(document.documentElement, next)
  },
}))

/** Applies the stored preference once at boot (index.html did it pre-paint). */
export function initScrollbars(): void {
  if (typeof document === 'undefined') return
  applyScrollbars(document.documentElement, useScrollbars.getState().mode)
}
