/**
 * File Name: api-origin.ts
 * Purpose: The Admin's runtime configuration contract (plan-environment-
 *          architecture section 5; Stage 4 C): `tangen:config`. One built
 *          Admin serves any host - the arrangement it runs in is read at
 *          RUNTIME from a page-level object, never baked in at build time.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Resolution order: `window.__TANGEN_CONFIG__` (a hosting
 *          page sets it before the bundle loads), then the `tangen:config`
 *          meta tag (JSON, rewritten by the serving process; no rebuild),
 *          then the page's own origin - which is right whenever the API is
 *          behind the same proxy. The object never carries a secret or a
 *          server-only value: it is public by construction.
 */

export const CONFIG_META = 'tangen:config'

/** What a hosting page may tell the Admin. Every field optional; every field public. */
export interface AdminRuntimeConfig {
  /** The API's origin (no path, no trailing slash). Absent: the Admin's own origin. */
  apiUrl?: string
}

declare global {
  // eslint-disable-next-line no-var
  var __TANGEN_CONFIG__: AdminRuntimeConfig | undefined
}

const cleanUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\/+$/, '')
  // An unreplaced placeholder is not a value: a serving process that templates
  // index.html leaves `__…__` or `%…%` behind when it has nothing to substitute.
  if (!t || t.startsWith('%') || t.startsWith('__')) return null
  return t
}

const parse = (raw: unknown): AdminRuntimeConfig | null => {
  if (raw && typeof raw === 'object') return raw as AdminRuntimeConfig
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t.startsWith('%') || t.startsWith('__')) return null
  try { const o = JSON.parse(t); return o && typeof o === 'object' ? (o as AdminRuntimeConfig) : null } catch { return null }
}

/** The runtime configuration this page carries: the global, else the meta tag, else nothing. */
export function adminRuntimeConfig(
  doc: Pick<Document, 'querySelector'> | undefined = typeof document === 'undefined' ? undefined : document,
): AdminRuntimeConfig {
  const fromGlobal = parse(typeof globalThis === 'undefined' ? undefined : globalThis.__TANGEN_CONFIG__)
  if (fromGlobal) return fromGlobal
  const meta = doc?.querySelector(`meta[name="${CONFIG_META}"]`)
  return parse(meta?.getAttribute('content')) ?? {}
}

/**
 * The origin every absolute API URL is built on. Same-origin deployments
 * configure nothing; a split-domain deployment names the API in `tangen:config`.
 */
export function apiOrigin(
  doc: Pick<Document, 'querySelector'> | undefined = typeof document === 'undefined' ? undefined : document,
  loc: { origin?: string } | undefined = typeof window === 'undefined' ? undefined : window.location,
): string {
  const configured = cleanUrl(adminRuntimeConfig(doc).apiUrl)
  if (configured) return configured
  return cleanUrl(loc?.origin) ?? ''
}

/**
 * An API URL for a path such as `/api/v1/objects`: relative when the API is
 * the Admin's own origin (the same-origin arrangement, and the dev proxy),
 * absolute on the configured origin otherwise. Every fetch in the Admin
 * goes through this, so tangen:config is the one place a deployment differs.
 */
export function apiUrl(path: string): string {
  const own = typeof window === 'undefined' ? '' : (window.location?.origin ?? '')
  const target = apiOrigin()
  return !target || target === own ? path : `${target}${path}`
}
