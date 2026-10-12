/**
 * File Name: preview.ts
 * Purpose: Live-preview helpers for a front-end site consuming Tangen.
 *   - Tier 1 (draft rendering): `fetchPreviewObject` reads a draft row behind a short-lived
 *     preview token (the admin's "Preview" button mints it and passes it in the URL).
 *   - Tier 2 (live editing): `onLivePreview` subscribes to the admin's postMessage stream so
 *     the page re-renders as the editor types — origin-verified.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Framework-agnostic. `fetchPreviewObject` runs anywhere with `fetch`;
 *   `onLivePreview`/`isLivePreview` are browser-only (guarded, safe to import server-side).
 */
import { resolveApiBase } from './api-base'

/** The postMessage envelope the admin's live-preview pane emits. Keep in sync with the admin. */
export const PREVIEW_MESSAGE_TYPE = 'tangen:preview:update'
/** Handshake the front-end sends to the admin when the live-preview SDK is wired, so the pane
 *  can show "connected" (and warn when it never arrives). */
export const PREVIEW_READY_TYPE = 'tangen:preview:ready'
/** A forwarded console entry from the front-end (opt-in via forwardConsole). */
export const PREVIEW_CONSOLE_TYPE = 'tangen:preview:console'
/** Site → admin: the user clicked through to a different object inside the preview
 *  pane, so the editor should follow (presentation-mode navigation). */
export const PREVIEW_NAVIGATE_TYPE = 'tangen:preview:navigate'
/** Admin → site: a browser-chrome command from the preview toolbar. Back/forward
 *  can't be driven cross-origin, so the admin asks and the site runs it. */
export const PREVIEW_COMMAND_TYPE = 'tangen:preview:command'

/** The live (unsaved) draft the admin streams while you edit. */
export interface LivePreviewObject {
  id: string
  type: string
  title?: string
  slug?: string
  status?: string
  /** Active locale (when localization is on) — `values`/`title` are already resolved to it. */
  locale?: string
  values: Record<string, unknown>
}

export interface LivePreviewMessage {
  type: typeof PREVIEW_MESSAGE_TYPE
  object: LivePreviewObject
}

/** Info the site passes to notifyPreviewNavigation when the previewed object changes. */
export interface PreviewNavigateInfo {
  /** The previewed object's id — preferred, resolves directly in the admin. */
  id?: string
  /** The object's content type slug (used with `slug` when `id` is absent). */
  type?: string
  /** The object's slug — fallback resolution when `id` is absent. */
  slug?: string
  /** The current in-pane path; defaults to the window's pathname + search. */
  path?: string
  /** False when this page has no editable content object (a listing, a static
   *  page, etc.) — the admin shows a "not editable" state instead of following. */
  editable?: boolean
}

/** Site → admin postMessage: follow the in-pane navigation to another object. */
export interface PreviewNavigateMessage {
  type: typeof PREVIEW_NAVIGATE_TYPE
  id?: string
  objectType?: string
  slug?: string
  path: string
  /** Explicitly false for non-content pages; omitted implies editable. */
  editable?: boolean
}

export interface FetchPreviewObjectOptions {
  /** The site's API origin, e.g. https://api.example.com - the SDK adds the API path.
   *  A base that already ends in /api/v1 is accepted too and not doubled. */
  apiUrl: string
  id: string
  type: string
  /** The short-lived token from the `preview_token` query param. */
  token: string
  /** Localized initial render — the `preview_locale` query param, when localization is on. */
  locale?: string
  fetch?: typeof fetch
}

/**
 * Fetch a single DRAFT object by id behind a preview token. Returns the raw row (draft values),
 * or null when the token is invalid/expired or the object isn't found. Use in a preview route
 * to render unpublished content (Tier 1).
 */
export async function fetchPreviewObject(opts: FetchPreviewObjectOptions): Promise<Record<string, unknown> | null> {
  const base = resolveApiBase(opts.apiUrl)
  const f = opts.fetch ?? (globalThis.fetch as typeof fetch)
  if (typeof f !== 'function') throw new Error('fetchPreviewObject: no fetch available - pass opts.fetch')
  const localeQ = opts.locale ? `&locale=${encodeURIComponent(opts.locale)}` : ''
  const url = `${base}/preview/object/${encodeURIComponent(opts.id)}?type=${encodeURIComponent(opts.type)}${localeQ}`
  const res = await f(url, { headers: { 'X-Tangen-Preview-Token': opts.token } })
  if (!res.ok) return null
  const json = await res.json().catch(() => null)
  return (json && typeof json === 'object' && 'data' in json ? (json as any).data : null) ?? null
}

/**
 * Type-guard: is this postMessage a live-preview update? Exposed so hosts can filter their own
 * message listeners.
 */
export function isLivePreviewMessage(data: unknown): data is LivePreviewMessage {
  return !!data && typeof data === 'object'
    && (data as any).type === PREVIEW_MESSAGE_TYPE
    && !!(data as any).object && typeof (data as any).object === 'object'
}

/**
 * Type-guard: is this postMessage a preview navigation request? Exposed so the
 * admin can filter its own message listener before acting on it.
 */
export function isPreviewNavigateMessage(data: unknown): data is PreviewNavigateMessage {
  return !!data && typeof data === 'object'
    && (data as any).type === PREVIEW_NAVIGATE_TYPE
    && typeof (data as any).path === 'string'
}

/** Best-effort admin origin from the framing referrer, for a scoped postMessage target. */
function originFromReferrer(w: any): string | undefined {
  try {
    const ref = w.document?.referrer
    return ref ? new URL(ref).origin : undefined
  } catch { return undefined }
}

/**
 * Tell the admin the previewed object changed, so its editor follows the
 * in-pane navigation (presentation mode). No-op unless the page is running
 * inside the admin's live-preview iframe, so it's safe to call on every route
 * change. The admin re-verifies the SENDER origin before acting, so this only
 * ever reaches a trusted parent; pass `adminOrigin` to scope the post tightly.
 * @param info - The now-previewed object (id preferred; type+slug as fallback).
 * @param opts - `adminOrigin` to target the post (defaults to the referrer origin).
 */
export function notifyPreviewNavigation(
  info: PreviewNavigateInfo = {},
  opts: { adminOrigin?: string } = {},
): void {
  if (!isLivePreview()) return
  const w = (globalThis as { window?: any }).window
  if (!w?.parent || w.parent === w) return
  const path = info.path
    ?? (w.location ? `${w.location.pathname ?? ''}${w.location.search ?? ''}` : '')
  const target = opts.adminOrigin ?? originFromReferrer(w) ?? '*'
  const msg: PreviewNavigateMessage = {
    type: PREVIEW_NAVIGATE_TYPE,
    ...(info.id ? { id: info.id } : {}),
    ...(info.type ? { objectType: info.type } : {}),
    ...(info.slug ? { slug: info.slug } : {}),
    ...(info.editable === false ? { editable: false } : {}),
    path,
  }
  try { w.parent.postMessage(msg, target) } catch { /* not framed - best effort */ }
}

/**
 * Tell the admin the previewed page has NO editable content object (a listing,
 * a static page, the home page, …), so the editor shows a "not editable" state
 * instead of staying on the previous object. No-op outside the preview iframe.
 * Call it from a layout on every route that isn't a content object.
 * @param opts - `adminOrigin` to scope the post; `path` to override the location.
 */
export function notifyPreviewNotEditable(opts: { adminOrigin?: string; path?: string } = {}): void {
  notifyPreviewNavigation({ editable: false, path: opts.path }, { adminOrigin: opts.adminOrigin })
}

/** Admin → site browser-chrome command (from the preview toolbar). */
export interface PreviewCommandMessage {
  type: typeof PREVIEW_COMMAND_TYPE
  action: 'back' | 'forward' | 'reload'
}

/**
 * Subscribe to the admin preview toolbar's browser commands (back / forward /
 * reload) and run them on this window's history/location — so the toolbar can
 * drive the framed site even though the admin can't touch its history directly
 * cross-origin. Origin-pinned to `allowedOrigin` (the admin origin). Returns an
 * unsubscribe function; a no-op on the server.
 */
export function onPreviewCommand(
  opts: { allowedOrigin?: string; onCommand?: (action: 'back' | 'forward' | 'reload') => void } = {},
): () => void {
  const w = (globalThis as { window?: any }).window
  if (!w || typeof w.addEventListener !== 'function') return () => {}
  const listener = (e: { origin?: string; data?: unknown }) => {
    if (!e.data || (e.data as any).type !== PREVIEW_COMMAND_TYPE) return
    if (opts.allowedOrigin && e.origin !== opts.allowedOrigin) return
    try {
      const action = (e.data as any).action as 'back' | 'forward' | 'reload'
      // Prefer the caller's handler (e.g. a framework router that re-renders on
      // history traversal); fall back to the raw history/location API.
      if (opts.onCommand) { opts.onCommand(action); return }
      if (action === 'back') w.history?.back?.()
      else if (action === 'forward') w.history?.forward?.()
      else if (action === 'reload') w.location?.reload?.()
    } catch { /* ignore */ }
  }
  w.addEventListener('message', listener)
  return () => w.removeEventListener?.('message', listener)
}

export interface OnLivePreviewOptions {
  /**
   * The admin origin allowed to drive this preview (e.g. https://admin.example.com). STRONGLY
   * recommended — without it any framing page could post fake content. Configure it on the site
   * (e.g. an env var) rather than trusting a URL param.
   */
  allowedOrigin?: string
  /**
   * Forward the page's console (log/info/warn/error) + uncaught errors to the admin's preview
   * pane, so you can debug front-end issues without leaving the editor. Off by default. Requires
   * `allowedOrigin` (console output can contain sensitive data, so it's only sent there).
   */
  forwardConsole?: boolean
}

/** Serialize a console argument to a string (Errors → stack, objects → JSON, else String). */
function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
  try { return JSON.stringify(a) } catch { return String(a) }
}

let consolePatched = false
/** Patch console + error handlers to forward entries to the admin (once). */
function forwardConsole(w: any, targetOrigin: string) {
  if (consolePatched || !w?.console || !w.parent || w.parent === w) return
  consolePatched = true
  const post = (level: string, args: unknown[]) => {
    try { w.parent.postMessage({ type: PREVIEW_CONSOLE_TYPE, level, text: args.map(stringifyArg).join(' '), at: Date.now() }, targetOrigin) } catch { /* dropped */ }
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = w.console[level]?.bind(w.console)
    w.console[level] = (...args: unknown[]) => { post(level, args); orig?.(...args) }
  }
  w.addEventListener?.('error', (e: any) => post('error', [e?.message ?? 'Error', e?.filename && `(${e.filename}:${e.lineno})`].filter(Boolean)))
  w.addEventListener?.('unhandledrejection', (e: any) => post('error', ['Unhandled rejection:', stringifyArg(e?.reason)]))
}

/**
 * Subscribe to the admin's live edits (Tier 2). Calls `handler(object)` with the in-flight draft
 * whenever the editor changes a field. Returns an unsubscribe function. No-op on the server.
 */
export function onLivePreview(
  handler: (object: LivePreviewObject) => void,
  opts: OnLivePreviewOptions = {},
): () => void {
  // Reference the browser globals via globalThis so this module needs no DOM lib and stays
  // importable on the server (Next server components, Nuxt/SvelteKit SSR, etc.).
  const w = (globalThis as { window?: any }).window
  if (!w || typeof w.addEventListener !== 'function') return () => {}
  const listener = (e: { origin?: string; data?: unknown }) => {
    if (opts.allowedOrigin && e.origin !== opts.allowedOrigin) return
    if (!isLivePreviewMessage(e.data)) return
    handler(e.data.object)
  }
  w.addEventListener('message', listener)
  // Tell the admin the SDK is wired, so its preview pane can show "connected" (and warn when
  // this handshake never arrives). The ready ping carries no data, so it targets '*' for
  // robustness — the admin verifies the SENDER origin, so this is safe.
  try {
    if (w.parent && w.parent !== w) w.parent.postMessage({ type: PREVIEW_READY_TYPE }, '*')
  } catch { /* not framed - the handshake is best-effort */ }
  // Console forwarding is opt-in and only ever sent to the trusted admin origin.
  if (opts.forwardConsole && opts.allowedOrigin) forwardConsole(w, opts.allowedOrigin)
  return () => w.removeEventListener?.('message', listener)
}

/** True when the page is running inside the admin's live-preview iframe (vs a normal tab). */
export function isLivePreview(): boolean {
  const w = (globalThis as { window?: any }).window
  if (!w) return false
  try { return w.self !== w.top } catch { return true }
}
