/**
 * File Name: api.ts
 * Purpose: Core HTTP fetch utilities for the admin panel, handling auth headers, automatic token refresh on 401, and error normalization into ApiError.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on the Zustand auth store (./auth) for token access. Uses a relative /api/v1 base so Vite's dev proxy can forward requests to the Elysia backend.
 */
import { apiOrigin, apiUrl } from './api-origin'
import { recordQmResponse } from '@/lib/query-monitor-client'
import { perfFetchStart, perfFetchEnd } from '@/lib/perf-vitals'
import { currentOrigin, WRITE_ORIGIN_HEADER } from '@tangen/realtime'
import { useAuthStore } from './auth'
import { refreshRequest } from './auth'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly status?: number,
    /** Structured error code (e.g. NEEDS_CASCADE / CASCADE_BLOCKED). */
    public readonly code?: string,
    /** Structured payload (e.g. the publish cascade plan). */
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Vite proxies /api/* to the Elysia server — use a relative base so it works in any environment
const API_BASE = '/api/v1'

/**
 * Builds a fully-qualified admin API URL with optional extra query params.
 * @param path - API path relative to /api/v1 (e.g. "/objects/query")
 * @param params - optional additional query parameters
 * @returns absolute URL string
 */
export function buildApiUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${API_BASE}${path}`, apiOrigin() || window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  return url.toString()
}

/**
 * Parse a successful response body, tolerating empty / 204 responses. Many
 * mutations (DELETE especially) return no content; `res.json()` on an empty body
 * throws "Unexpected end of JSON input" — so a delete would succeed server-side
 * yet surface an error. Returns `undefined` for an empty body instead.
 */
export async function parseOkBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/**
 * The workspace every request carries in `X-Tangen-Workspace`. Anything that
 * CACHES a response must key by this too, or two workspaces on one
 * environment slug share the answer (closure plan Phase 8B, finding 8B-3).
 */
export function currentWorkspaceId(): string | null {
  return useAuthStore.getState().member?.workspaceId ?? null
}

function makeHeaders(accessToken: string | null, extra?: HeadersInit): HeadersInit {
  const { member } = useAuthStore.getState()
  const origin = currentOrigin()
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    // Enables workspace boundary enforcement on the API side even on localhost
    // (where there is no subdomain to infer the workspace from).
    ...(member?.workspaceId ? { 'X-Tangen-Workspace': member.workspaceId } : {}),
    // Which realtime connection issued this write. The events it causes come
    // back stamped with it, so this tab can tell its own echo from a
    // colleague's without comparing actors or clocks (docs/realtime.md,
    // "Was this my own write?"). Absent until something subscribes.
    ...(origin ? { [WRITE_ORIGIN_HEADER]: origin } : {}),
    ...(extra ?? {}),
  }
}

async function handleUnauthorized(): Promise<string | null> {
  const result = await refreshRequest()
  if (result) {
    useAuthStore.getState().setAuth(result.accessToken, result.member)
    return result.accessToken
  }
  useAuthStore.getState().setSessionExpired(true)
  return null
}

/**
 * Authenticated fetch for workspace-scoped API calls (no env param); automatically retries once with a refreshed token on 401.
 * @param path - API path relative to /api/v1
 * @param init - optional RequestInit options
 * @returns parsed response JSON as type T
 */
export async function workspaceFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let { accessToken } = useAuthStore.getState()
  const url = new URL(`${API_BASE}${path}`, apiOrigin() || window.location.origin)

  let res = await fetch(url.toString(), {
    ...init,
    headers: makeHeaders(accessToken, init?.headers),
  })

  if (res.status === 401) {
    const newToken = await handleUnauthorized()
    if (!newToken) throw new Error('Session expired')
    res = await fetch(url.toString(), {
      ...init,
      headers: makeHeaders(newToken, init?.headers),
    })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const errBody = (body as any)?.error
    throw new ApiError(errBody?.message ?? `Request failed: ${res.status}`, errBody?.fieldErrors, res.status, errBody?.code, errBody?.details)
  }
  const parsed = await parseOkBody<T>(res)
  // The object's concurrency token, when the response carried one (Phase 6B,
  // Unit 6). Kept beside the parsed body so a caller that saves can send it
  // back as If-Match without a second request; ignored by everyone else.
  const etag = res.headers.get('etag')
  if (etag && parsed && typeof parsed === 'object') lastEtags.set(parsed as object, etag)
  return parsed
}

/** The ETag of a parsed response, when the server sent one. */
const lastEtags = new WeakMap<object, string>()
export function etagOf(parsed: unknown): string | null {
  return parsed && typeof parsed === 'object' ? lastEtags.get(parsed as object) ?? null : null
}

// In-flight GET dedupe: on a cold mount many components (plus StrictMode's
// double-invoked effects) request the same resource in the same tick -
// /admin/ui-config, /types and /workspaces each fired 2-3x per page load.
// Identical concurrent GETs share one request; the entry clears on settle,
// so a deliberate refetch after a mutation always hits the server. Shared
// callers receive the SAME parsed object - treat responses as read-only.
const inflightGets = new Map<string, Promise<unknown>>()

/**
 * Authenticated fetch for admin API calls; automatically retries
 * once with a refreshed token on 401. Concurrent identical GETs are coalesced
 * into a single request (see inflightGets above).
 * @param path - API path relative to /api/v1
 * @param init - optional RequestInit options
 * @param extraParams - additional URL query parameters
 * @returns parsed response JSON as type T
 */
export function adminFetch<T>(
  path: string,
  init?: RequestInit,
  extraParams?: Record<string, string>,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method !== 'GET' || init?.signal) return adminFetchRaw<T>(path, init, extraParams)

  const key = buildApiUrl(path, extraParams)
  const existing = inflightGets.get(key)
  if (existing) return existing as Promise<T>
  const p = adminFetchRaw<T>(path, init, extraParams).finally(() => inflightGets.delete(key))
  inflightGets.set(key, p)
  return p
}

async function adminFetchRaw<T>(
  path: string,
  init?: RequestInit,
  extraParams?: Record<string, string>,
): Promise<T> {
  // Route-timing tap for the Performance Monitor (no-op before init).
  perfFetchStart()
  try {
    return await adminFetchInner<T>(path, init, extraParams)
  } finally {
    perfFetchEnd()
  }
}

/**
 * Authenticated fetch for STREAMING admin calls (Server-Sent
 * Events). Sends the SSE opt-in Accept header, retries once on 401, and
 * returns the raw Response so the caller can iterate the body (see
 * lib/sse-client readSSEStream). Non-OK and non-SSE responses are raised as
 * ApiError - a streaming caller never has to sniff content types.
 * @param path - API path relative to /api/v1
 * @param init - optional RequestInit (method/body/signal)
 */
export async function adminFetchStream(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let { accessToken } = useAuthStore.getState()
  const url = buildApiUrl(path)
  const headersFor = (token: string | null): HeadersInit => ({
    ...makeHeaders(token, init?.headers),
    'Accept': 'text/event-stream',
    'x-tangen-page': window.location.pathname,
  })

  let res = await fetch(url, { ...init, headers: headersFor(accessToken) })
  if (res.status === 401) {
    const newToken = await handleUnauthorized()
    if (!newToken) throw new Error('Session expired')
    res = await fetch(url, { ...init, headers: headersFor(newToken) })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const errBody = (body as any)?.error
    throw new ApiError(errBody?.message ?? `Request failed: ${res.status}`, errBody?.fieldErrors, res.status, errBody?.code, errBody?.details)
  }
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    throw new ApiError('Expected an event stream response')
  }
  return res
}

/**
 * Authenticated fetch for a DOWNLOAD (a CSV export, a bundle): the session
 * headers, one retry on 401, and the raw Response for the caller to read as
 * a blob or text. Nothing is assumed about the content type, which is the
 * difference from adminFetchStream. A non-OK answer is raised as ApiError
 * from the API's error envelope.
 * @param path - API path relative to /api/v1
 * @param init - optional RequestInit (method/body/signal)
 */
export async function adminFetchFile(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let { accessToken } = useAuthStore.getState()
  const url = buildApiUrl(path)
  const headersFor = (token: string | null): HeadersInit => ({
    ...makeHeaders(token, init?.headers),
    'x-tangen-page': window.location.pathname,
  })

  let res = await fetch(url, { ...init, headers: headersFor(accessToken) })
  if (res.status === 401) {
    const newToken = await handleUnauthorized()
    if (!newToken) throw new Error('Session expired')
    res = await fetch(url, { ...init, headers: headersFor(newToken) })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const errBody = (body as any)?.error
    throw new ApiError(errBody?.message ?? `Request failed: ${res.status}`, errBody?.fieldErrors, res.status, errBody?.code, errBody?.details)
  }
  return res
}

async function adminFetchInner<T>(
  path: string,
  init?: RequestInit,
  extraParams?: Record<string, string>,
): Promise<T> {
  let { accessToken } = useAuthStore.getState()
  const url = buildApiUrl(path, extraParams)

  // Page attribution for the Query Monitor - the SPA route that fired this
  // request (an explicit header beats Referer: normalized, always present).
  const qmHeaders = { ...makeHeaders(accessToken, init?.headers), 'x-tangen-page': window.location.pathname }
  let res = await fetch(url, {
    ...init,
    headers: qmHeaders,
  })
  recordQmResponse(path, init?.method ?? 'GET', res)

  if (res.status === 401) {
    const newToken = await handleUnauthorized()
    if (!newToken) throw new Error('Session expired')
    res = await fetch(url, {
      ...init,
      headers: { ...makeHeaders(newToken, init?.headers), 'x-tangen-page': window.location.pathname },
    })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const errBody = (body as any)?.error
    throw new ApiError(errBody?.message ?? `Request failed: ${res.status}`, errBody?.fieldErrors, res.status, errBody?.code, errBody?.details)
  }
  return parseOkBody<T>(res)
}
