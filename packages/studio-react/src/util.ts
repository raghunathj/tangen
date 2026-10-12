/**
 * File Name: util.ts
 * Purpose: Small shared helpers - token slot sanitising, safe hrefs, enum
 *          coercion and media URL resolution - used by every widget.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Token slot values come from editor-stored JSON, so
 *          they are UNTRUSTED: `slot()` whitelists the characters that may
 *          reach a class name or an inline `var(--tg-*)` reference, which is
 *          what keeps CSS injection out. Slots are NOT validated against the
 *          default lists on purpose - the contract lets sites EXTEND token
 *          slot lists, and an extended slot must still emit its class + var.
 */

/** Matches slot names we are willing to interpolate into classes and vars. */
const SLOT_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Coerces an editor-supplied token slot to something safe for a class name
 * and a `var(--tg-*)` reference; falls back when missing or malformed.
 */
export function slot(value: unknown, fallback: string): string {
  return typeof value === 'string' && SLOT_RE.test(value) ? value : fallback
}

/** Coerces a value to one of a closed set of options, else the fallback. */
export function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** String prop, or empty string. */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Repeater prop, or empty array. */
export function items<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Returns the href if its scheme is safe to render, else undefined.
 * Blocks javascript:/data:/vbscript:/file: while allowing http(s), mailto,
 * tel, and every relative form (/, #, ?, ./, bare paths).
 */
export function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (href === '') return undefined
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase()
  if (!scheme) return href
  return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? href : undefined
}

/** A bare platform asset id: what a media field STORES, never a URL. */
const ASSET_ID_RE = /^med_[A-Za-z0-9_-]+$/

/**
 * Resolves an image prop to a URL. Supports a plain string and a resolved
 * media object carrying `url` (the shapes the SDK hands a site). A bare
 * asset id is refused: the platform expands media at every depth before a
 * renderer sees it, so an id here means an unexpanded read, and a widget
 * should lose its image rather than emit <img src="med_...">.
 */
export function mediaUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value && !ASSET_ID_RE.test(value) ? value : undefined
  if (value && typeof value === 'object') {
    const url = (value as { url?: unknown }).url
    if (typeof url === 'string' && url !== '') return url
  }
  return undefined
}
