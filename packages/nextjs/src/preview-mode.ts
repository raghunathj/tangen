/**
 * File Name: preview-mode.ts
 * Purpose: The readers that let one page render published content normally and
 *          draft content while previewing. `createPreviewHandler` turned Next
 *          draft mode on and stored the token in a cookie, and nothing in the
 *          platform read either, so a page in draft mode still fetched the
 *          published web - draft mode was a flag with no consumer.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `next/headers` is imported dynamically, like the preview
 *          handler does, so this module stays importable outside a Next
 *          runtime (tests, scripts, another framework) and answers the
 *          published view there rather than throwing. Next 14 returns these
 *          accessors synchronously and 15+ returns promises; `settle` covers
 *          both. Reading a draft is the API key's authority, never this
 *          cookie's: see the README on which key to use.
 */

/** The cookie `createPreviewHandler` writes the validated preview token to. */
export const PREVIEW_COOKIE = 'tangen_preview_token'

/** What `.status()` on an SDK query takes for the two views this module picks between. */
export type ReadStatus = 'published' | 'draft'

/** The shape of a Next cookie store, narrowed to the one method used here. */
export interface CookieReader {
  get(name: string): { value?: string } | undefined
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Normalises a Next accessor that is synchronous on 14 and a promise on 15+.
 * @param value - The accessor's return value, awaited only when thenable
 * @returns The settled value
 */
export async function settle<T>(value: T | Promise<T>): Promise<T> {
  return value && typeof (value as { then?: unknown }).then === 'function'
    ? await (value as Promise<T>)
    : (value as T)
}

/**
 * Reads the preview token out of a cookie store, treating blank as absent.
 * @param store - A Next cookie store, or anything with the same `get`
 * @returns The token, or null when the cookie is missing or empty
 */
export function readPreviewCookie(store: CookieReader | null | undefined): string | null {
  return store?.get(PREVIEW_COOKIE)?.value?.trim() || null
}

/**
 * Picks the lifecycle status a read should run with.
 * @param draft - Whether this request is previewing
 * @returns 'draft' while previewing, 'published' otherwise
 */
export function statusFor(draft: boolean): ReadStatus {
  return draft ? 'draft' : 'published'
}

// ─── Next readers ─────────────────────────────────────────────────────────────

/**
 * Whether Next draft mode is on for this request, i.e. whether the preview
 * route accepted a token. False outside a Next request context, so a script or
 * a test renders the published view rather than crashing.
 * @returns True while previewing
 */
export async function isDraftMode(): Promise<boolean> {
  try {
    const { draftMode } = await import('next/headers')
    const dm = await settle(draftMode() as never)
    return (dm as { isEnabled?: boolean })?.isEnabled === true
  } catch {
    return false
  }
}

/**
 * The preview token `createPreviewHandler` stored for this browser, for the
 * one-object draft read `fetchPreviewObject` performs. Null outside a Next
 * request context, or when no preview is running.
 * @returns The token, or null
 */
export async function getPreviewToken(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    const store = await settle(cookies() as never)
    return readPreviewCookie(store as CookieReader)
  } catch {
    return null
  }
}

/**
 * The status to pass to an SDK query for this request: the one call a page
 * makes to serve both views.
 *
 * ```ts
 * const { data } = await tangen.objects('page')
 *   .where({ path }).status(await previewStatus()).limit(1).get()
 * ```
 *
 * A draft read needs a key holding the objects `read_draft` grant; without it
 * the API refuses the read rather than quietly serving published content, so a
 * misconfigured preview fails loudly.
 * @returns 'draft' while previewing, 'published' otherwise
 */
export async function previewStatus(): Promise<ReadStatus> {
  return statusFor(await isDraftMode())
}
