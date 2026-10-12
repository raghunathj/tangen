/**
 * File Name: lookup.ts
 * Purpose: Resolves the `:formId` segment of the public form routes as either
 *   a form UUID or a form SLUG, so a public site can reach a form by the one
 *   name it actually knows.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Ids are UUIDs and globally unique; slugs are unique per
 *   workspace. A slug lookup can therefore collide across workspaces sharing a
 *   database - that collision is a 409 naming the way out, never a silent
 *   first-row pick (the exact shape finding #1 was about).
 *
 *   Before this, the only slug-aware route required a member session, which a
 *   public website must never hold - so sites hard-coded per-environment UUIDs
 *   into env vars (finding #13).
 */
import { RequestError } from './errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The two queries a backing store must answer. */
export interface FormLookupQuerier {
  byId(id: string): Promise<Record<string, unknown> | null>
  /** Every form matching the slug, across workspaces. */
  bySlug(slug: string): Promise<Record<string, unknown>[]>
}

/**
 * Resolves a `:formId` path segment to a form row.
 * @param param - The raw path segment: a UUID or a slug.
 */
export async function resolveFormRef(
  param: string,
  q: FormLookupQuerier,
): Promise<Record<string, unknown>> {
  if (UUID_RE.test(param)) {
    const row = await q.byId(param)
    if (!row) throw new RequestError('NOT_FOUND', 'Form not found', 404)
    return row
  }

  const rows = await q.bySlug(param)
  if (rows.length === 0) throw new RequestError('NOT_FOUND', `Form "${param}" not found`, 404)
  if (rows.length > 1) {
    // Two workspaces in one database own a form with this slug. Guessing the
    // first would hand one workspace's form to the other's visitors.
    throw new RequestError(
      'CONFLICT',
      `Form slug "${param}" exists in ${rows.length} workspaces - address this form by its id instead`,
      409,
    )
  }
  return rows[0]
}
