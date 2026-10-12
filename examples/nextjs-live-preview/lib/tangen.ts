/**
 * Tangen client + read helpers. Published reads use the typed SDK with a server-only API key;
 * draft/preview reads use a short-lived preview TOKEN (no key). The preview contract is plain
 * REST — nothing here is Next-specific, so the same helpers work in any framework.
 */
import { createClient, fetchPreviewObject } from '@tangen/sdk'

export const API_URL = process.env.NEXT_PUBLIC_TANGEN_API_URL ?? 'http://localhost:3000'
/** The admin origin allowed to drive live preview (postMessage). Security-critical. */
export const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_TANGEN_ADMIN_ORIGIN ?? ''

export type Entry = Record<string, unknown>

/** Server-side client for PUBLISHED reads (uses the API key). */
export function client() {
  return createClient({ apiUrl: API_URL, apiKey: process.env.TANGEN_API_KEY ?? '' })
}

/**
 * Published entries of a type, newest first.
 *
 * An empty list on failure keeps the page rendering, but the reason is logged:
 * swallowing it silently once turned a misconfigured API base into what looked
 * like an empty CMS.
 */
export async function listPublished(type: string, limit = 20): Promise<Entry[]> {
  try {
    const res = await client().objects(type).status('published').sort('publishedAt', 'desc').limit(limit).get()
    return (res?.data ?? []) as Entry[]
  } catch (err) {
    console.error(`[tangen] listPublished(${type}) failed:`, (err as Error)?.message ?? err)
    return []
  }
}

/**
 * One published entry by slug (null when genuinely missing).
 *
 * A null here becomes a 404 page, so a request that FAILED must not look the
 * same as one that found nothing - that is exactly the confusion this logging
 * exists to prevent.
 */
export async function getPublishedBySlug(type: string, slug: string): Promise<Entry | null> {
  try {
    const res = await client().objects(type).status('published').findBySlug(slug)
    return (res?.data ?? null) as Entry | null
  } catch (err) {
    console.error(`[tangen] getPublishedBySlug(${type}, ${slug}) failed:`, (err as Error)?.message ?? err)
    return null
  }
}

/** One DRAFT entry by id, behind a preview token (Tier 1). Localized when `locale` is given. */
export async function getDraftByToken(id: string, type: string, token: string, locale?: string): Promise<Entry | null> {
  return fetchPreviewObject({ apiUrl: API_URL, id, type, token, locale })
}
