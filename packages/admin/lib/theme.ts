/**
 * File Name: theme.ts
 * Purpose: The Admin theme preference (UI V2 stage V2, spec §4): light, dark
 *          or system, persisted under one key, applied as the `.dark` scope
 *          class on the document element, following the OS while in
 *          `system`. The pre-paint script in index.html reads the same key so
 *          the first frame is already right; this store takes over from there.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zustand. The Studio skin (`.studio`) is applied alone by
 *          design (globals.css): while it is on the root this store never adds
 *          `.dark`, and it re-applies the preference when Studio leaves. Pure
 *          helpers (readStoredMode, resolveMode, applyResolved) are exported
 *          for the test, which runs without a DOM.
 */
import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'tangen-theme'
export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system']
const MEDIA = '(prefers-color-scheme: dark)'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function readStoredMode(storage: StorageLike | null | undefined): ThemeMode {
  try {
    const v = storage?.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

interface RootLike { classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean } }

/**
 * Puts the resolved theme on the root. Returns false when the Studio scope
 * is present: Studio is dark on its own terms and must not be stacked with
 * the admin's dark palette (see the `.studio` comment in globals.css).
 */
export function applyResolved(root: RootLike | null | undefined, resolved: ResolvedTheme): boolean {
  if (!root) return false
  const has = root.classList.contains('dark')
  if (root.classList.contains('studio')) {
    if (has) root.classList.remove('dark')
    return false
  }
  // Only touch the attribute when it must change: a class mutation observer
  // watches the root, and an idempotent add() still fires it.
  if (resolved === 'dark' && !has) root.classList.add('dark')
  else if (resolved === 'light' && has) root.classList.remove('dark')
  return true
}

interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

const prefersDark = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MEDIA).matches : false)
const storage = (): StorageLike | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export const useTheme = create<ThemeState>()((set, get) => {
  const mode = readStoredMode(storage())
  return {
    mode,
    resolved: resolveMode(mode, prefersDark()),
    setMode: (next) => {
      try { storage()?.setItem(THEME_KEY, next) } catch {}
      const resolved = resolveMode(next, prefersDark())
      set({ mode: next, resolved })
      if (typeof document !== 'undefined') applyResolved(document.documentElement, resolved)
      void get
    },
  }
})

/**
 * Applies the stored preference and follows the OS while in `system`.
 * Call once at boot; returns the unsubscribe.
 */
export function initTheme(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const apply = () => {
    const { mode } = useTheme.getState()
    const resolved = resolveMode(mode, prefersDark())
    useTheme.setState({ resolved })
    applyResolved(document.documentElement, resolved)
  }
  apply()
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(MEDIA) : null
  const onChange = () => { if (useTheme.getState().mode === 'system') apply() }
  mq?.addEventListener?.('change', onChange)
  // Studio applies and removes its scope itself; when it leaves, the
  // preference must come back without a reload.
  const observer = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => { if (!document.documentElement.classList.contains('studio')) apply() })
    : null
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => {
    mq?.removeEventListener?.('change', onChange)
    observer?.disconnect()
  }
}

/** The label a menu shows for a mode. */
export const THEME_LABELS: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }
