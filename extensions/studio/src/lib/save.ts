/**
 * File Name: save.ts
 * Purpose: Studio's draft save path - a thin, testable wrapper over the SAME
 *   endpoint the object editor autosaves through: PATCH /objects/:type/:id,
 *   autosaves flagged noRevision=1. The fetcher is injected (the page passes
 *   the admin's adminFetch) so the wire contract is unit-testable.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The body is built by the page with the editor's own
 *   buildUpdateBody ('@/lib/editor') - zero forked normalization.
 */

/** The shape of '@/lib/api' adminFetch that this module relies on. */
export type AdminFetchLike = (
  path: string,
  init?: { method?: string; body?: string },
  extraQuery?: Record<string, string>,
) => Promise<unknown>

export interface PatchDraftOptions {
  type: string
  id: string
  /** The full update body (title + normalized field values). */
  body: Record<string, unknown>
  /** Autosave - skips a revision entry, exactly like the editor's autosave. */
  auto?: boolean
}

/** PATCH the object's draft - the object editor's save endpoint, unchanged. */
export function patchDraft(fetcher: AdminFetchLike, opts: PatchDraftOptions): Promise<unknown> {
  return fetcher(
    `/objects/${opts.type}/${opts.id}`,
    { method: 'PATCH', body: JSON.stringify(opts.body) },
    opts.auto ? { noRevision: '1' } : undefined,
  )
}

export interface PatchLocaleOptions {
  type: string
  id: string
  /** The locale being translated - never the default. */
  locale: string
  /** The overlay payload from the editor's own buildLocaleSavePayload. */
  body: Record<string, unknown>
}

/**
 * PATCH one locale's translations - the object editor's locale route, by
 * object id with the type and locale as query. A separate wire from
 * patchDraft on purpose: the server writes this to the <type>_i18n side
 * row and refuses any field that is not localized, so a translation can
 * never reach the shared record by accident.
 */
export function patchLocaleDraft(fetcher: AdminFetchLike, opts: PatchLocaleOptions): Promise<unknown> {
  return fetcher(
    `/objects/${opts.id}`,
    { method: 'PATCH', body: JSON.stringify(opts.body) },
    { type: opts.type, locale: opts.locale },
  )
}

/**
 * The field values Studio sends on save.
 *
 * Mirrors the object editor's untouched-slug rule. The slug is re-sent ONLY
 * when the person editing actually changed it: the server runs its
 * uniqueness check on any slug it receives, so re-sending an untouched one
 * on every autosave would let a plain content edit 409 against a slug the
 * page has held for years. An edited slug is sent trimmed; an edit that left
 * it empty is not sent at all, because the server ignores an empty slug and
 * there is nothing to check.
 */
export function studioSaveValues(
  fieldValues: Record<string, unknown>,
  opts?: { slug?: string },
): Record<string, unknown> {
  const edited = typeof opts?.slug === 'string' ? opts.slug.trim() : ''
  return { ...fieldValues, slug: edited ? edited : undefined }
}
