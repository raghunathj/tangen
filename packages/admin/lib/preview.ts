/**
 * File Name: preview.ts
 * Purpose: Live-preview client helpers for the object editor — read the env's preview config,
 *   mint a short-lived object-scoped preview token, and build the front-end preview URL from
 *   the configured template. Powers the "Preview" button (Tier 1) and the split-pane (Tier 2).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { adminFetch } from '@/lib/api'

export interface PreviewConfig {
  enabled: boolean
  previewUrl: string | null
  frontendUrl: string | null
  breakpoints?: Array<{ name: string; width: number }>
}

/** Whether live preview is configured for this env + type, and the URL template to use.
 *  Passing `type` resolves a per-type `previewUrls` override when configured. */
export async function getPreviewConfig(type?: string): Promise<PreviewConfig> {
  try {
    const path = `/admin/preview/config${type ? `?type=${encodeURIComponent(type)}` : ''}`
    const res = await adminFetch<{ data?: PreviewConfig }>(path, { method: 'GET' })
    return res.data ?? { enabled: false, previewUrl: null, frontendUrl: null }
  } catch {
    return { enabled: false, previewUrl: null, frontendUrl: null }
  }
}

/** Mint a short-lived preview token scoped to one object (so the front-end can read its draft). */
export async function mintPreviewToken(objectId: string, expiresInSeconds = 3600): Promise<string | null> {
  try {
    const res = await adminFetch<{ data?: { token?: string } }>('/preview/token', {
      method: 'POST',
      body: JSON.stringify({ objectId, expiresInSeconds }),
    })
    return res.data?.token ?? null
  } catch {
    return null
  }
}

/**
 * Fill the preview URL template — `{id}`/`{type}` placeholders — and append the preview token.
 * Pure so it's unit-testable. When the template lacks `{id}`, the id/type ride as query params
 * so a bare `https://site/preview` template still works.
 */
export function buildPreviewUrl(template: string, opts: { id: string; type: string; slug?: string; locale?: string; token?: string; path?: string | null }): string {
  const hasIdPlaceholder = /\{id\}/.test(template)
  const hasSlugPlaceholder = /\{slug\}/.test(template)
  const hasPathPlaceholder = /\{path\}/.test(template)
  const hasLocalePlaceholder = /\{locale\}/.test(template)
  let url = template
    .replace(/\{id\}/g, encodeURIComponent(opts.id))
    .replace(/\{type\}/g, encodeURIComponent(opts.type))
    .replace(/\{slug\}/g, encodeURIComponent(opts.slug ?? ''))
    // The composed address, for a type that declares `path`: a nested page
    // lives at /about/company and a `{slug}` template could never reach it.
    // NOT encoded as a whole - it is a path, its separators are real, and the
    // composer already escaped each segment.
    .replace(/\{path\}/g, opts.path ?? '')
    .replace(/\{locale\}/g, encodeURIComponent(opts.locale ?? ''))
  const params: string[] = []
  // Ensure the frontend can identify the object even for a bare `/preview` template.
  // `{path}` identifies the object only when there WAS one: a template that
  // names it and gets nothing for a type with no declared path would
  // otherwise be a bare origin with nothing to resolve.
  const pathIdentifies = hasPathPlaceholder && !!opts.path
  if (!hasIdPlaceholder && !hasSlugPlaceholder && !pathIdentifies) { params.push(`id=${encodeURIComponent(opts.id)}`, `type=${encodeURIComponent(opts.type)}`) }
  if (opts.locale && !hasLocalePlaceholder) params.push(`preview_locale=${encodeURIComponent(opts.locale)}`)
  if (opts.token) params.push(`preview_token=${encodeURIComponent(opts.token)}`)
  for (const p of params) url += (url.includes('?') ? '&' : '?') + p
  return url
}

/**
 * Deep-link support: `/objects/:type/:id?preview=1` (the Tangen Toolbar's
 * "Edit this page") should land in the editor with the live-preview pane
 * open. Returns the href with the param stripped when present, else null.
 * Pure so it's unit-testable; the page effect replaces history state with it.
 */
export function stripPreviewParam(href: string): string | null {
  try {
    const u = new URL(href)
    if (u.searchParams.get('preview') !== '1') return null
    u.searchParams.delete('preview')
    return u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : '') + u.hash
  } catch {
    return null
  }
}
