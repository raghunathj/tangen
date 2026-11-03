/**
 * File Name: pickable-objects.ts
 * Purpose: The two decisions an object picker makes, as pure functions: what
 *   it asks the server for, and which rows it may offer as a parent.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Both used to be done in the browser over "every row",
 *          which was never every row. A picker asked for 500 and the gateway
 *          clamped it to `maxQueryLimit` (100 by default) WITHOUT failing, so
 *          a type with 1,000 entries offered the first 100, searched only
 *          those 100, and showed a raw id wherever the selected entry was not
 *          among them. Nothing on screen said so.
 *
 *          So the search is the server's now, and a row's eligibility is read
 *          off its own ancestor chain rather than off a tree assembled from
 *          one page. Both answers are then correct on page 7 of a search,
 *          which a tree built from a partial list can never be.
 */
import type { AncestorRef } from '@/components/object-list/ancestor-prefix'

/**
 * Rows per request. Comfortably under the 100 the gateway allows by default,
 * because a request that is clamped is a request whose paging silently lies.
 */
export const PICKER_PAGE_SIZE = 50

/** A row as a picker reads it. */
export interface PickableRow {
  id: string
  title: string | null
  status?: string
  /** Root first, present only when the read asked for it. */
  _ancestors?: AncestorRef[]
  [key: string]: unknown
}

export interface PickerQuery {
  /** The typed search, raw. Trimmed here; empty means "the first page". */
  search?: string
  offset?: number
  limit?: number
  /** Ask for the chain each row sits under. Hierarchical types only. */
  includeAncestors?: boolean
  /** Resolve exactly one row - what the closed trigger needs to show a title. */
  id?: string
  /**
   * Resolve these rows - what a chip list needs to show its labels. At most
   * `PICKER_PAGE_SIZE` per call, because the gateway clamps a longer read and
   * the chips that fell off the end would go missing without a word. Callers
   * with more selected than that read in chunks (`useResolvedPickableRows`).
   */
  ids?: readonly string[]
  /** `'any'` unless a filter narrows it. The server applies it, not the list. */
  status?: string
  /**
   * How the server orders the page. Defaults to title ascending, which is what
   * a list someone reads down wants.
   *
   * The caller chooses, because the right answer depends on the filter: newest
   * first is `published_at` descending while the filter IS published, and
   * `updated_at` descending otherwise, since a draft has no published date and
   * Postgres sorts those NULLs to the TOP of a descending order - so asking
   * for "latest published" across drafts and published together puts every
   * draft above every published entry.
   */
  sort?: { field: string; direction: 'asc' | 'desc' }
  /**
   * A relation field's `config.filter`, which restricts which entries may be
   * chosen at all. Merged UNDER the search, so narrowing by title narrows
   * within the allowed set rather than escaping it. The server re-validates
   * the choice on write either way; this is what keeps a refusal off the save
   * button.
   */
  filter?: Record<string, unknown>
}

/**
 * The body for `POST /objects/:type/query`.
 *
 * `total` is the route's default and is kept on purpose, not for paging -
 * `hasMore` is exact either way, because a read without a count fetches one
 * extra row instead. It is kept because the count is the sentence that makes
 * a first page legible: "showing 50 of 1,000, search to narrow it down". A
 * picker opening is worth one COUNT; a by-id read is not, so that one says no.
 */
export function pickerQueryBody(q: PickerQuery = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: q.status ?? 'any',
    limit: q.limit ?? PICKER_PAGE_SIZE,
    offset: q.offset ?? 0,
    total: true,
    sort: q.sort ?? { field: 'title', direction: 'asc' },
  }
  if (q.id) {
    body.query = { id: { eq: q.id } }
    body.limit = 1
    body.offset = 0
    body.total = false
    body.status = 'any'
  } else if (q.ids) {
    body.query = { id: { in: [...q.ids] } }
    body.limit = Math.max(1, Math.min(q.ids.length, PICKER_PAGE_SIZE))
    body.offset = 0
    body.total = false
    // A chip must render whatever its entry's status is, or removing the one
    // draft among ten published terms becomes impossible. The field's filter
    // is skipped here for the same reason: an entry chosen before the filter
    // changed must still render its own name, or the author is asked to remove
    // a raw id they cannot identify.
    body.status = 'any'
  } else {
    const term = (q.search ?? '').trim()
    const query: Record<string, unknown> = { ...(q.filter ?? {}) }
    if (term) query.title = { contains: term }
    if (Object.keys(query).length > 0) body.query = query
  }
  if (q.includeAncestors) body.includeAncestors = true
  return body
}

/** A row a parent picker may offer, and whether choosing it is refused. */
export interface ParentChoice {
  row: PickableRow
  /** True for an entry already inside the one being edited. */
  blocked: boolean
}

/**
 * The rows a parent picker should show for the entry being edited.
 *
 * SELF is omitted. Telling someone editing About that About cannot be its own
 * parent answers a question nobody asked.
 *
 * A DESCENDANT is kept and refused, because "why can't I put About under
 * Team?" has a real answer - Team is already inside About - and hiding the row
 * replaces that answer with "Team is not in this list", which reads as a
 * deleted entry or a broken picker.
 *
 * Which rows those are is read off `_ancestors`: an entry is inside the one
 * being edited exactly when the chain it sits under names it. That holds on
 * any page of any search. The earlier version needed the WHOLE tree in the
 * browser to work out the same thing, and a parent missing from the page was
 * read as "no parent", which put a child at the root and left a descendant
 * looking choosable. The server refuses a cycle either way
 * (`assertNoParentCycle`); this is what keeps the refusal off the save button.
 */
export function parentChoicesFromRows(
  rows: ReadonlyArray<PickableRow>,
  currentObjectId: string | null | undefined,
): ParentChoice[] {
  const out: ParentChoice[] = []
  for (const row of rows) {
    if (currentObjectId && row.id === currentObjectId) continue
    const chain = Array.isArray(row._ancestors) ? row._ancestors : []
    out.push({
      row,
      blocked: Boolean(currentObjectId) && chain.some((a) => a.id === currentObjectId),
    })
  }
  return out
}

// ── What an object picker offers, and in what order ──────────────────────────

/**
 * The types a picker may offer.
 *
 * An empty `include` means "any readable type" on both the `object` field and a
 * `link` field with no `allowedTargets`. The picker used to render that as
 * NOTHING: its type list was empty, every fetch returned early, and the author
 * got "No objects found" with no way to choose a type. The workspace's own
 * types are that list.
 *
 * A disabled type is left out: its content APIs 404, so an entry picked from
 * it would be a reference to something nothing can read.
 */
export function pickableTypeNames(
  include: readonly string[],
  allTypes: ReadonlyArray<{ name: string; disabled?: boolean }>,
): string[] {
  if (include.length > 0) return [...include]
  return allTypes.filter((t) => !t.disabled).map((t) => t.name)
}

/**
 * How a picker orders its page, chosen from the status filter.
 *
 * "Newest first" is `published_at` descending only while every row HAS one.
 * Postgres sorts NULLs to the TOP of a descending order and the query route
 * offers no NULLS LAST, so asking for it across drafts and published together
 * puts every unpublished entry above every published one - the opposite of
 * what the sort was picked for. `updated_at` is always set, so it is the
 * honest reading of "newest" for any filter that admits a draft.
 */
export function pickerSortFor(status: string): { field: string; direction: 'asc' | 'desc' } {
  // Both names are in the route's SYSTEM_SORT_COLUMNS, which the test gates
  // against: an unknown sort field is a 422, not a different order.
  return status === 'published'
    ? { field: 'published_at', direction: 'desc' }
    : { field: 'updated_at', direction: 'desc' }
}
