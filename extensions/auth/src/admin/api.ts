/**
 * File Name: api.ts
 * Purpose: The Site users admin's one view of the extension's admin routes
 *          (/api/v1/admin/ext/auth/...): typed calls the pages share and the
 *          shapes they read. Nothing here knows a component.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { adminFetch } from '@/kit'
import type { ProfileFieldDef, SignInMethods } from '../contract'

export const BASE = '/admin/ext/auth'

export interface UserRow {
  id: string
  email: string | null
  phone: string | null
  name: string | null
  role: string
  status: 'active' | 'blocked' | string
  isAnonymous: boolean
  createdAt: string | null
  lastLoginAt: string | null
  [profileField: string]: unknown
}

export interface UserDetail extends UserRow {
  providers: string[]
  profileMeta: Record<string, unknown>
  profileFields: ProfileFieldDef[]
}

export interface SessionRow {
  id: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  isActive: boolean
}

export interface ListResult {
  data: UserRow[]
  meta: { total: number; limit: number; offset: number }
  profileFields: ProfileFieldDef[]
  roles: string[]
}

export type Methods = SignInMethods & { callbackUrls: Record<string, string> }

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const authApi = {
  list: (query: Record<string, string>) => adminFetch<ListResult>(`${BASE}/users`, undefined, query),
  get: (id: string) => adminFetch<{ data: UserDetail; roles: string[] }>(`${BASE}/users/${id}`),
  create: (body: Record<string, unknown>) => adminFetch<{ data: UserRow }>(`${BASE}/users`, json(body)).then((r) => r.data),
  patch: (id: string, body: Record<string, unknown>) => adminFetch<{ data: UserDetail; roles: string[] }>(`${BASE}/users/${id}`, json(body, 'PATCH')),
  sessions: (id: string) => adminFetch<{ data: SessionRow[] }>(`${BASE}/users/${id}/sessions`).then((r) => r.data),
  revokeSession: (id: string, sessionId: string) => adminFetch(`${BASE}/users/${id}/sessions/${sessionId}`, { method: 'DELETE' }),
  signOutEverywhere: (id: string) => adminFetch(`${BASE}/users/${id}/sessions`, { method: 'DELETE' }),
  block: (id: string) => adminFetch<{ data: { status: string } }>(`${BASE}/users/${id}/block`, { method: 'POST' }),
  unblock: (id: string) => adminFetch<{ data: { status: string } }>(`${BASE}/users/${id}/unblock`, { method: 'POST' }),
  methods: () => adminFetch<{ data: Methods }>(`${BASE}/methods`).then((r) => r.data),
}

export function relativeTime(iso: string | Date | undefined | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function displayNameOf(u: Pick<UserRow, 'name' | 'email' | 'phone' | 'isAnonymous'>): string {
  return u.name || u.email || u.phone || (u.isAnonymous ? 'Guest' : 'Site user')
}

export const PROVIDER_LABELS: Record<string, string> = { password: 'Password', otp: 'One-time code', google: 'Google', github: 'GitHub' }
export const providerLabel = (id: string) => PROVIDER_LABELS[id] ?? id
