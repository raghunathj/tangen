/**
 * File Name: use-can.ts
 * Purpose: The admin UI's RBAC source of truth — fetches the server-resolved
 *          permission bundle (GET /me/permissions) once per environment and
 *          exposes can()/hasCapability() so chrome matches enforcement.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mirror-of-server checks live in pure helpers
 *          (canWithBundle) so they're unit-testable; no client-side role
 *          compilation — the server resolves custom roles.
 */
import { create } from 'zustand'
import { useEffect, useMemo } from 'react'
import { checkBundle } from '@tangen/types'
import type { Capability, ExtensionId, MemberPermissions } from '@tangen/types'
import { adminFetch } from './api'

export type ContentAction = 'read' | 'read_draft' | 'write' | 'publish' | 'delete'

export interface MePermissions {
  memberId: string
  role: string
  effectiveRole: string
  status: 'active' | 'suspended'
  permissions: (MemberPermissions & { admin?: boolean }) | { admin: true }
  capabilities: Capability[] | 'all'
}

/**
 * Pure permission check — delegates to the shared checkBundle so the admin
 * UI and server (RouteContext.can) can never drift.
 */
export function canWithBundle(
  me: MePermissions | null,
  action: string,
  resource: 'objects' | 'media' | 'search' | 'schema' = 'objects',
  item?: string,
): boolean {
  if (!me) return false
  return checkBundle(me.permissions as MemberPermissions & { admin?: boolean }, action, resource, item)
}

/** Whether the member may open an extension's pages ('all' when absent). */
export function canUseExtensionWithBundle(me: MePermissions | null, extId: ExtensionId): boolean {
  if (!me) return false
  const p = me.permissions as MemberPermissions & { admin?: boolean }
  if (p.admin === true) return true
  const ext = p.extensions
  if (ext === undefined || ext === 'all') return true
  return ext.includes(extId)
}

/** Locales the member may write: 'all' or an allow-list ('all' when unknown). */
export function allowedLocalesWithBundle(me: MePermissions | null): 'all' | string[] {
  if (!me) return 'all'
  const p = me.permissions as MemberPermissions & { admin?: boolean }
  if (p.admin === true) return 'all'
  return p.locales ?? 'all'
}

/** Whether the member may write a locale (null = base/default language). */
export function canWriteLocaleWithBundle(
  me: MePermissions | null,
  locale: string | null,
  defaultLocale: string | undefined,
): boolean {
  const allowed = allowedLocalesWithBundle(me)
  if (allowed === 'all') return true
  const target = locale ?? defaultLocale ?? null
  return target !== null && allowed.includes(target)
}

export function hasCapabilityWithBundle(me: MePermissions | null, cap: Capability): boolean {
  if (!me) return false
  if (me.capabilities === 'all') return true
  return me.capabilities.includes(cap)
}

interface CanState {
  /** undefined = not loaded yet; null = the read failed (fail open in the UI). */
  me: MePermissions | null | undefined
  loading: boolean
  load: () => Promise<void>
  invalidate: () => void
}

export const useCanStore = create<CanState>((set, get) => ({
  me: undefined,
  loading: false,
  async load() {
    if (get().me !== undefined || get().loading) return
    set({ loading: true })
    try {
      const res = await adminFetch<{ data: MePermissions }>('/me/permissions')
      set({ me: res.data, loading: false })
    } catch {
      // Fail open in the UI (the server still enforces) so a blip doesn't blank the admin
      set({ me: null, loading: false })
    }
  },
  invalidate() {
    set({ me: undefined, loading: false })
  },
}))

/**
 * RBAC hook. `can`/`hasCapability` return true while loading or on fetch
 * failure for admin-looking sessions is NOT assumed — callers get false until
 * the bundle arrives, except when nothing loaded (null) where we fail open to
 * avoid blanking the admin on transient errors; the server always enforces.
 */
export function useCan() {
  const me = useCanStore((s) => s.me)
  const load = useCanStore((s) => s.load)
  // Fetch in an effect, not during render (render must stay pure), and hand
  // back a MEMOIZED object: the shell calls this hook in several always-
  // mounted components, and fresh closures every render defeated every
  // downstream memo keyed on it.
  useEffect(() => { void load() }, [load])

  return useMemo(() => {
    // Unknown (loading) or failed → keep chrome visible; the server enforces.
    // Once the bundle arrives, the UI matches enforcement exactly.
    const failOpen = me == null
    return {
      me: me ?? null,
      ready: me !== undefined,
      can: (action: string, resource: 'objects' | 'media' | 'search' | 'schema' = 'objects', item?: string) =>
        failOpen ? true : canWithBundle(me ?? null, action, resource, item),
      hasCapability: (cap: Capability) => failOpen ? true : hasCapabilityWithBundle(me ?? null, cap),
      canUseExtension: (extId: ExtensionId) => failOpen ? true : canUseExtensionWithBundle(me ?? null, extId),
      allowedLocales: failOpen ? ('all' as const) : allowedLocalesWithBundle(me ?? null),
      canWriteLocale: (locale: string | null, defaultLocale?: string) =>
        failOpen ? true : canWriteLocaleWithBundle(me ?? null, locale, defaultLocale),
      isAdmin: failOpen ? true : (me?.capabilities === 'all'),
    }
  }, [me])
}
