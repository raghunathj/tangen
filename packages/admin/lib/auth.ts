/**
 * File Name: auth.ts
 * Purpose: Zustand store for client-side auth state (access token + member info), persisted
 *          to sessionStorage. Also provides login, token-refresh, and logout HTTP helpers.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Zustand with persist middleware; sessionStorage is tab-scoped and cleared on tab close.
 */

import { apiUrl } from './api-origin'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  member: { memberId: string; workspaceId: string; role: string; email: string; name?: string | null; avatar?: string | null } | null
  sessionExpired: boolean
  setAuth: (token: string, member: AuthState['member']) => void
  /** Merge profile fields (name/avatar/email) into the current member — used after
   *  a self-profile save and the top-bar's initial /me/profile fetch. */
  updateMember: (patch: Partial<NonNullable<AuthState['member']>>) => void
  clearAuth: () => void
  setSessionExpired: (v: boolean) => void
}

/**
 * Global auth store — holds the active access token, member profile, and session-expired flag.
 * Persisted to sessionStorage so the session survives page refreshes but is cleared when the tab closes.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      member: null,
      sessionExpired: false,
      setAuth: (accessToken, member) => set({ accessToken, member, sessionExpired: false }),
      updateMember: (patch) => set((s) => (s.member ? { member: { ...s.member, ...patch } } : {})),
      clearAuth: () => set({ accessToken: null, member: null }),
      setSessionExpired: (v) => set({ sessionExpired: v }),
    }),
    {
      name: 'tangen-auth',
      storage: createJSONStorage(() => sessionStorage), // tab-scoped: cleared on close
      partialize: (s) => ({ accessToken: s.accessToken, member: s.member }),
    },
  ),
)

/**
 * POSTs credentials to /api/auth/login and returns the access token and member profile on success.
 * @param email - The user's email address
 * @param password - The user's password
 * @returns The access token and member info
 */
export async function loginRequest(email: string, password: string) {
  const res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any)?.error?.message ?? 'Login failed')
  }
  return res.json() as Promise<{ accessToken: string; member: AuthState['member'] }>
}

/**
 * Attempts a silent token refresh via /api/auth/refresh using the httpOnly refresh cookie.
 * @returns The new access token and member info, or null when the refresh token is missing or expired.
 */
export async function refreshRequest(): Promise<{ accessToken: string; member: AuthState['member'] } | null> {
  const res = await fetch(apiUrl('/api/auth/refresh'), { method: 'POST', credentials: 'include' })
  if (!res.ok) return null
  return res.json() as Promise<{ accessToken: string; member: AuthState['member'] }>
}

/**
 * Calls /api/auth/logout to revoke the server-side refresh token; swallows network errors.
 */
export async function logoutRequest(): Promise<void> {
  await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {})
}
