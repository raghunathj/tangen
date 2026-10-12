/**
 * File Name: data.ts
 * Purpose: The kit's data-source contract — one shape (`DataSource<T>`)
 *          renders anything in a ListPage/DataList: Tangen objects and custom
 *          tables, custom admin routes, EXTERNAL APIs, or in-memory arrays
 *          (files/static data). `useKitQuery` owns the page/search/sort state
 *          every list screen otherwise hand-rolls.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface. Adapters are pure
 *          factories — testable without React; useKitQuery is the only hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch } from '@/lib/api'
import type { AdminClient } from '@/lib/admin-client'

// ─── The contract ─────────────────────────────────────────────────────────────

export interface KitQuery {
  /** 1-based page. */
  page: number
  pageSize: number
  search?: string
  sort?: { field: string; direction: 'asc' | 'desc' }
  /** Adapter-specific filter values (e.g. QueryFilter for objects). */
  filters?: Record<string, unknown>
}

export interface KitQueryResult<T> {
  rows: T[]
  total: number
}

/** Anything that answers a KitQuery with rows + total. */
export type DataSource<T> = (query: KitQuery) => Promise<KitQueryResult<T>>

// ─── Adapters ─────────────────────────────────────────────────────────────────

/** Tangen content objects via the admin client's fluent builder. */
export function fromObjects<T = Record<string, unknown>>(
  client: AdminClient,
  typeName: string,
  opts: { searchField?: string; baseFilters?: Record<string, unknown> } = {},
): DataSource<T> {
  return async (q) => {
    let builder = client.objects<T>(typeName)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
    const filters: Record<string, unknown> = { ...(opts.baseFilters ?? {}), ...(q.filters ?? {}) }
    if (q.search && opts.searchField) {
      filters[opts.searchField] = { $regex: q.search }
    }
    if (Object.keys(filters).length > 0) builder = builder.where(filters as never)
    if (q.sort) builder = builder.sort(q.sort.field, q.sort.direction)
    const res = await builder.find()
    return { rows: res.data, total: res.meta?.total ?? res.data.length }
  }
}

/** Custom tables (customTables key) via the admin client. */
export function fromTable<T = Record<string, unknown>>(
  client: AdminClient,
  tableName: string,
  opts: { baseFilters?: Record<string, unknown> } = {},
): DataSource<T> {
  return async (q) => {
    let builder = client.table(tableName)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
    const filters: Record<string, unknown> = { ...(opts.baseFilters ?? {}), ...(q.filters ?? {}) }
    if (Object.keys(filters).length > 0) builder = builder.where(filters as never)
    if (q.sort) builder = builder.sort(q.sort.field, q.sort.direction)
    const res = await builder.find()
    return { rows: res.data as T[], total: res.meta?.total ?? res.data.length }
  }
}

/**
 * A custom admin/API route (auth handled by adminFetch). The route receives
 * page/pageSize/search/sort as query params; `map` reshapes non-standard
 * responses into { rows, total } (default expects { data, meta.total }).
 */
export function fromAdminRoute<T = Record<string, unknown>>(
  path: string,
  map?: (response: unknown) => KitQueryResult<T>,
): DataSource<T> {
  return async (q) => {
    const params: Record<string, string> = {
      page: String(q.page),
      pageSize: String(q.pageSize),
      limit: String(q.pageSize),
      offset: String((q.page - 1) * q.pageSize),
    }
    if (q.search) params.q = q.search
    if (q.sort) params.sort = `${q.sort.direction === 'desc' ? '-' : ''}${q.sort.field}`
    for (const [k, v] of Object.entries(q.filters ?? {})) {
      if (v != null) params[k] = String(v)
    }
    const res = await adminFetch<unknown>(path, undefined, params)
    if (map) return map(res)
    const shaped = res as { data?: T[]; meta?: { total?: number } }
    const rows = shaped.data ?? (Array.isArray(res) ? (res as T[]) : [])
    return { rows, total: shaped.meta?.total ?? rows.length }
  }
}

/**
 * ANY external API — plain fetch, no Tangen auth. Provide the request for a
 * query and a mapper from the JSON response to { rows, total }.
 *
 *   fromFetch(
 *     (q) => `https://api.github.com/search/issues?q=repo:o/r&page=${q.page}&per_page=${q.pageSize}`,
 *     (json) => ({ rows: json.items, total: json.total_count }),
 *   )
 */
export function fromFetch<T>(
  request: string | ((q: KitQuery) => string | Request),
  map: (json: unknown, q: KitQuery) => KitQueryResult<T>,
  fetchImpl: typeof fetch = fetch,
): DataSource<T> {
  return async (q) => {
    const req = typeof request === 'function' ? request(q) : request
    const res = await fetchImpl(req)
    if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`)
    return map(await res.json(), q)
  }
}

/**
 * In-memory data — static arrays, parsed files, computed rows. Paging,
 * search, and sort happen client-side. Accepts the rows directly or an async
 * loader (fetched once, then served from memory).
 */
export function fromArray<T extends Record<string, unknown>>(
  rows: T[] | (() => Promise<T[]>),
  opts: { searchFields?: (keyof T & string)[] } = {},
): DataSource<T> {
  let cache: T[] | null = Array.isArray(rows) ? rows : null
  const load = async (): Promise<T[]> => {
    if (!cache) cache = await (rows as () => Promise<T[]>)()
    return cache
  }

  return async (q) => {
    let data = [...(await load())]

    if (q.search) {
      const needle = q.search.toLowerCase()
      const fields = opts.searchFields
      data = data.filter((row) => {
        const haystack = fields
          ? fields.map((f) => row[f])
          : Object.values(row)
        return haystack.some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
      })
    }

    for (const [key, value] of Object.entries(q.filters ?? {})) {
      if (value == null || value === '') continue
      data = data.filter((row) => row[key] === value)
    }

    if (q.sort) {
      const { field, direction } = q.sort
      data.sort((a, b) => {
        const av = a[field], bv = b[field]
        if (av === bv) return 0
        const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1
        return direction === 'desc' ? -cmp : cmp
      })
    }

    const total = data.length
    const start = (q.page - 1) * q.pageSize
    return { rows: data.slice(start, start + q.pageSize), total }
  }
}

// ─── The hook ─────────────────────────────────────────────────────────────────

export interface UseKitQueryResult<T> {
  rows: T[]
  total: number
  loading: boolean
  error: string | null
  query: KitQuery
  setPage: (page: number) => void
  setSearch: (search: string) => void
  setSort: (sort: KitQuery['sort']) => void
  setFilters: (filters: Record<string, unknown>) => void
  refetch: () => void
}

/**
 * Owns the list-screen state machine: query state, debounced search,
 * loading/error, and refetch. Search/filter changes reset to page 1.
 */
export function useKitQuery<T>(
  source: DataSource<T>,
  opts: { initialPageSize?: number; debounceMs?: number } = {},
): UseKitQueryResult<T> {
  const { initialPageSize = 25, debounceMs = 300 } = opts
  const [query, setQuery] = useState<KitQuery>({ page: 1, pageSize: initialPageSize })
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const sourceRef = useRef(source)
  sourceRef.current = source
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    sourceRef.current(query)
      .then((res) => {
        if (cancelled) return
        setRows(res.rows)
        setTotal(res.total)
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message ?? 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, tick])

  const setPage = useCallback((page: number) => setQuery((q) => ({ ...q, page })), [])
  const setSort = useCallback((sort: KitQuery['sort']) => setQuery((q) => ({ ...q, sort, page: 1 })), [])
  const setFilters = useCallback(
    // Shallow-equal filters bail without a state change - consumers that call
    // setFilters from a mount effect (e.g. jobs Runs) would otherwise refire
    // the fetch effect with an identical query on every mount.
    (filters: Record<string, unknown>) => setQuery((q) => {
      const prev = q.filters ?? {}
      const keys = Object.keys(filters)
      const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === filters[k])
      return same ? q : { ...q, filters, page: 1 }
    }),
    [],
  )
  const setSearch = useCallback((search: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setQuery((q) => ({ ...q, search: search || undefined, page: 1 }))
    }, debounceMs)
  }, [debounceMs])
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { rows, total, loading, error, query, setPage, setSearch, setSort, setFilters, refetch }
}
