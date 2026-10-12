/**
 * File Name: concurrency.ts
 * Purpose: Optimistic concurrency for content writes (closure plan Phase
 *          6B, Units 5-6): an editor that read an object at one version
 *          must not silently overwrite someone else's newer edit. The
 *          token is the row's own `updated_at`, at the database's full
 *          precision, carried as an HTTP `ETag`, and enforced by adding it
 *          to the UPDATE's WHERE - so the check is the database's, not the
 *          application's, and two writers racing cannot both win.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The token is read as TEXT (`updated_at::text`) for
 *          the same reason keyset cursors are: a JavaScript Date truncates
 *          the microseconds Postgres stores, and a token that lost them
 *          would never match its own row. The value is base64url so an
 *          ETag stays an opaque string to a client, and it decodes back to
 *          exactly the text Postgres produced, which is what the WHERE
 *          compares. No column is added and no history is kept: this reads
 *          state every content table already has.
 */
import { RequestError } from './errors'

/** The header a client sends to say which version it expects to overwrite. */
export const IF_MATCH_HEADER = 'if-match'

/** The stable code a stale write answers with. */
export const STALE_OBJECT_CODE = 'STALE_OBJECT'

/** Wraps the row's `updated_at` text as a weak ETag. */
export function etagFor(updatedAtText: string | null | undefined): string | null {
  if (typeof updatedAtText !== 'string' || updatedAtText === '') return null
  return `W/"${Buffer.from(updatedAtText, 'utf8').toString('base64url')}"`
}

/**
 * The `updated_at` text an ETag stands for, or null when the header is
 * absent, malformed, or `*` (which means "any version" - no condition).
 */
export function updatedAtFromEtag(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null
  const raw = header.trim()
  if (raw === '' || raw === '*') return null
  // A client may send several; the first that decodes is the one we honour.
  for (const candidate of raw.split(',')) {
    const m = /^\s*(?:W\/)?"([A-Za-z0-9_-]+)"\s*$/.exec(candidate)
    if (!m) continue
    try {
      const text = Buffer.from(m[1]!, 'base64url').toString('utf8')
      if (text.length > 0 && text.length < 64) return text
    } catch { /* not ours */ }
  }
  return null
}

/** True when the request carried an `If-Match` this write must honour. */
export function conditionalWrite(headers: { get?: (name: string) => string | null } | Record<string, unknown> | undefined): string | null {
  if (!headers) return null
  const get = (headers as { get?: (n: string) => string | null }).get
  const raw = typeof get === 'function'
    ? get.call(headers, IF_MATCH_HEADER)
    : (headers as Record<string, unknown>)[IF_MATCH_HEADER] ?? (headers as Record<string, unknown>)['If-Match']
  return updatedAtFromEtag(typeof raw === 'string' ? raw : null)
}

/**
 * The refusal a stale write gets: 409 with the code a client can switch on,
 * and enough to reread and retry - never the competing content.
 */
export function staleObjectError(typeName: string, id: string, current: string | null): RequestError {
  return new RequestError(
    STALE_OBJECT_CODE,
    `${typeName} "${id}" changed since you read it: reread it and apply your edit to the current version.`,
    409,
    undefined,
    { objectId: id, type: typeName, currentEtag: etagFor(current) },
  )
}
