/**
 * File Name: use-pickable-objects.ts
 * Purpose: Searching and paging for an object picker, on the server, so a
 *   picker over 1,000 entries offers all 1,000.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Three things a "fetch everything once" picker got wrong
 *          and this does not:
 *
 *          - the fetch was capped. 500 was asked for, `maxQueryLimit` (100)
 *            was served, and nothing said which. Here a page is 50 and the
 *            count beside it says how many there are in all.
 *          - the search only ever filtered what had arrived. Here it goes to
 *            the server, debounced, and a stale answer is dropped by request
 *            number rather than by arrival order.
 *          - the chosen entry had to be ON the page or the trigger showed a
 *            raw id. Here it is resolved by id, once, in its own read.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch } from '@/lib/api'
import { PICKER_PAGE_SIZE, pickerQueryBody, type PickableRow } from '@/lib/pickable-objects'

const SEARCH_DEBOUNCE_MS = 200

interface QueryResponse {
  data?: PickableRow[]
  meta?: { total?: number | null; hasMore?: boolean }
}

export interface PickableObjects {
  rows: PickableRow[]
  /** The first page is loading - the list has nothing to show yet. */
  loading: boolean
  /** A further page is loading - the list is showing what it has. */
  loadingMore: boolean
  /** How many match in all, or null where the server did not count. */
  total: number | null
  hasMore: boolean
  loadMore: () => void
  /** Re-read the first page - for a picker offering "Reload". */
  refresh: () => void
  error: string | null
}

export interface UsePickableObjectsOptions {
  typeName: string
  /** The typed search, raw. Debounced here. */
  search: string
  /** False while the picker is closed, so nothing is fetched behind it. */
  enabled: boolean
  includeAncestors?: boolean
  pageSize?: number
  /** A status filter, applied by the server so it narrows the whole set. */
  status?: string
  /** The server's ordering. See `PickerQuery.sort`; title ascending by default. */
  sort?: { field: string; direction: 'asc' | 'desc' }
  /** A relation field's `config.filter`. See `PickerQuery.filter`. */
  filter?: Record<string, unknown>
}

/**
 * The rows a picker should show for the current search, a page at a time.
 */
export function usePickableObjects({
  typeName, search, enabled, includeAncestors = false, pageSize = PICKER_PAGE_SIZE, status, sort, filter,
}: UsePickableObjectsOptions): PickableObjects {
  const [rows, setRows] = useState<PickableRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every read carries the number it was issued as. A first keystroke that
  // answers after a third would otherwise replace the list with the wrong
  // search, which is the one bug a debounce alone does not fix.
  const issued = useRef(0)
  const termRef = useRef('')
  const filterKey = JSON.stringify(filter ?? null)

  const read = useCallback(async (term: string, offset: number) => {
    const seq = ++issued.current
    if (offset === 0) { setLoading(true); setRows([]) } else { setLoadingMore(true) }
    setError(null)
    try {
      const res = await adminFetch<QueryResponse>(
        `/objects/${typeName}/query`,
        { method: 'POST', body: JSON.stringify(pickerQueryBody({ search: term, offset, limit: pageSize, includeAncestors, status, sort, filter })) },
      )
      if (seq !== issued.current) return
      const page = res.data ?? []
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]))
      setTotal(typeof res.meta?.total === 'number' ? res.meta.total : null)
      setHasMore(res.meta?.hasMore === true)
    } catch (e) {
      if (seq !== issued.current) return
      setRows((prev) => (offset === 0 ? [] : prev))
      setHasMore(false)
      setError(e instanceof Error && e.message ? e.message : 'Could not load the list. Please try again.')
    } finally {
      if (seq === issued.current) { setLoading(false); setLoadingMore(false) }
    }
    // `filterKey` and not `filter`: a field's config is a fresh object on every
    // render, so depending on the object itself re-reads the first page forever.
  }, [typeName, pageSize, includeAncestors, status, sort?.field, sort?.direction, filterKey])

  useEffect(() => {
    if (!enabled) return
    const term = search.trim()
    termRef.current = term
    // The first page is wanted immediately; a search waits for the typing to
    // stop so one query runs instead of one per keystroke.
    const delay = term ? SEARCH_DEBOUNCE_MS : 0
    const timer = setTimeout(() => { void read(term, 0) }, delay)
    return () => clearTimeout(timer)
  }, [enabled, search, read])

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    void read(termRef.current, rows.length)
  }, [loading, loadingMore, hasMore, rows.length, read])

  const refresh = useCallback(() => { void read(termRef.current, 0) }, [read])

  return { rows, loading, loadingMore, total, hasMore, loadMore, refresh, error }
}

/**
 * The one row an id names, for a closed picker's label. Null until it answers,
 * so the trigger can say "Loading" rather than show the id.
 */
export function useResolvedPickableRow(
  typeName: string, id: string | null, includeAncestors = false,
): { row: PickableRow | null; loading: boolean } {
  const [row, setRow] = useState<PickableRow | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) { setRow(null); return }
    let live = true
    setLoading(true)
    adminFetch<QueryResponse>(
      `/objects/${typeName}/query`,
      { method: 'POST', body: JSON.stringify(pickerQueryBody({ id, includeAncestors })) },
    )
      .then((res) => { if (live) setRow(res.data?.[0] ?? null) })
      .catch(() => { if (live) setRow(null) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [typeName, id, includeAncestors])

  return { row, loading }
}

/**
 * The rows a set of ids names, for a chip list.
 *
 * Read in chunks, because the gateway clamps a read longer than its ceiling
 * and the selections past the cut would vanish from the chips without a word -
 * which is what the previous picker did at 100 terms: `allTerms` held the
 * first page, the chips were `ids.map(byId).filter(Boolean)`, and a term that
 * was not on that page rendered NOTHING. The entry was still selected and
 * still saved; it simply could not be seen or removed.
 */
export function useResolvedPickableRows(
  typeName: string, ids: readonly string[], includeAncestors = false,
): { rows: PickableRow[]; loading: boolean } {
  const [rows, setRows] = useState<PickableRow[]>([])
  const [loading, setLoading] = useState(false)
  const key = ids.join(',')

  useEffect(() => {
    const wanted = key ? key.split(',') : []
    if (wanted.length === 0) { setRows([]); return }
    let live = true
    setLoading(true)
    const chunks: string[][] = []
    for (let i = 0; i < wanted.length; i += PICKER_PAGE_SIZE) chunks.push(wanted.slice(i, i + PICKER_PAGE_SIZE))
    Promise.all(chunks.map((chunk) => adminFetch<QueryResponse>(
      `/objects/${typeName}/query`,
      { method: 'POST', body: JSON.stringify(pickerQueryBody({ ids: chunk, includeAncestors })) },
    ).then((res) => res.data ?? []).catch(() => [])))
      .then((pages) => {
        if (!live) return
        const byId = new Map(pages.flat().map((r) => [r.id, r]))
        // The caller's order is the one the editor stored; keep it.
        setRows(wanted.map((id) => byId.get(id)).filter(Boolean) as PickableRow[])
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [typeName, key, includeAncestors])

  return { rows, loading }
}
