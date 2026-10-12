/**
 * File Name: locale.ts
 * Purpose: Ambient locale state for the admin — the TopBar language dropdown
 *          sets it once and every localization-aware surface (lists, editor,
 *          globals, media) reads it. Persisted per workspace+env so the choice
 *          survives reloads; validated against the workspace config on hydrate.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zustand (same pattern as lib/auth); hydrated from
 *          GET /admin/i18n/locales by the env layout.
 */
import { create } from 'zustand'
import { adminFetch } from '@/lib/api'

export interface LocaleDef { code: string; label: string }
export interface LocaleEngines { google: boolean; ai: boolean; /** Every engine with its availability (K8.3), contributed ones included. */ providers?: Array<{ id: string; label: string; available: boolean; languages?: string[] }> }

export interface LocaleState {
  /** Localization enabled for this workspace with >1 locale. */
  enabled: boolean
  defaultLocale: string
  locales: LocaleDef[]
  engines: LocaleEngines
  /** null = default locale (today's behavior everywhere). */
  activeLocale: string | null
  /** Persistence scope of the current hydration (the workspace). */
  scope: string | null
  setLocale: (code: string | null) => void
  hydrate: (workspaceId: string) => Promise<void>
}

/** localStorage key for the persisted choice in one workspace. */
export function localeStorageKey(workspaceId: string): string {
  return `tangen-locale:${workspaceId}`
}

/**
 * Resolves a stored locale against the config: default and unknown codes
 * collapse to null (default locale).
 */
export function resolveStoredLocale(
  stored: string | null,
  defaultLocale: string,
  locales: LocaleDef[],
): string | null {
  if (!stored || stored === defaultLocale) return null
  return locales.some((l) => l.code === stored) ? stored : null
}

export const useLocaleStore = create<LocaleState>()((set, get) => ({
  enabled: false,
  defaultLocale: 'en',
  locales: [],
  engines: { google: false, ai: false },
  activeLocale: null,
  scope: null,

  setLocale(code) {
    const { scope, defaultLocale, locales } = get()
    const next = resolveStoredLocale(code, defaultLocale, locales)
    set({ activeLocale: next })
    if (scope) {
      try {
        if (next) localStorage.setItem(`tangen-locale:${scope}`, next)
        else localStorage.removeItem(`tangen-locale:${scope}`)
      } catch { /* storage unavailable - choice is session-only */ }
    }
  },

  async hydrate(workspaceId) {
    const scope = workspaceId
    try {
      const r = await adminFetch<{ data: { enabled: boolean; defaultLocale: string; locales: LocaleDef[]; engines: LocaleEngines } }>(
        '/admin/i18n/locales')
      const enabled = r.data.enabled && r.data.locales.length > 1
      let stored: string | null = null
      try { stored = localStorage.getItem(localeStorageKey(workspaceId)) } catch { /* ignore */ }
      set({
        enabled,
        defaultLocale: r.data.defaultLocale,
        locales: enabled ? r.data.locales : [],
        engines: r.data.engines ?? { google: false, ai: false },
        activeLocale: enabled ? resolveStoredLocale(stored, r.data.defaultLocale, r.data.locales) : null,
        scope,
      })
    } catch {
      set({ enabled: false, locales: [], activeLocale: null, scope })
    }
  },
}))
