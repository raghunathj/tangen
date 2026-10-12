/**
 * File Name: query.ts
 * Purpose: Query filter, sort, and result types for the Tangen object query API.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Imports ObjectStatus from object-types.
 */

import type { ObjectStatus } from './object-types'

/**
 * Filters the queried type to only rows that are referenced by at least one
 * object of `type` through the specified `field` (a relation many:true column).
 *
 * Generates: WHERE EXISTS (SELECT 1 FROM "source_type" WHERE ... AND col @> ARRAY[o.id])
 */
export interface ReferencedByFilter {
  /** The type that holds the relation field pointing back to the queried type. */
  type: string
  /** The relation field name on `type` (must be many:true). */
  field: string
  /** Optionally restrict to source objects of a specific status. "any" = no restriction. */
  status?: ObjectStatus | 'any'
}

/**
 * Comparison operators supported by the Tangen query filter DSL.
 */
export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'ncontains'
  | 'startsWith'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'nin'
  | 'exists'

/**
 * A single field's filter conditions — one or more operator-value pairs.
 */
export type FilterCondition = Partial<Record<FilterOperator, unknown>>

/**
 * Top-level query filter map: field names mapped to a FilterCondition or a raw value (eq shorthand).
 */
export type QueryFilter = Record<string, FilterCondition | unknown>

/**
 * Field-key-constrained filter map for a typed builder. Keys narrow to the
 * row's fields (incl. system fields, since generated rows extend
 * TangenSystemFields); values stay a FilterCondition or raw eq-shorthand
 * (kept loose — no deep per-field value typing, so this stays cheap). Degrades
 * to `QueryFilter` for a loose row.
 */
export type WhereFilter<T> = Partial<Record<keyof T & string, FilterCondition | unknown>>

/**
 * Hint that controls how a richtext or JSON field value is serialised in the response.
 */
export type SerializeHint = 'json' | 'html' | 'text'

/**
 * Full query parameters for fetching a list of objects from the Tangen API.
 */
export interface QueryObject {
  type: string
  status?: ObjectStatus | 'any'
  query?: QueryFilter
  cacheStrategy?: CacheStrategy
  sort?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
  offset?: number
  /** Keyset pagination cursor from meta.nextCursor. Mutually exclusive with offset. */
  after?: string
  depth?: number
  props?: string[]
  /** Per-relation-field column projection: only these columns (+id) are returned for the expanded records. */
  populate?: Record<string, string[]>
  serialize?: Record<string, SerializeHint>
  /** Locale for localized fields — omitted/default serves main-table values; 'all' (admin) returns the i18n map. */
  locale?: string
  /** Attach each row's operational labels as `_labels: string[]` (one batched query). */
  includeLabels?: boolean
  /**
   * Whether to compute the exact `meta.total`. Defaults to true. Exact counting
   * is linear in the number of qualifying rows and is the dominant database cost
   * of a list over a large type; a caller that paginates by cursor, or only
   * needs to know whether another page exists, can pass `false`: `meta.total`
   * is then `null` and `meta.hasMore` says whether a next page exists.
   */
  total?: boolean
}

export interface CacheStrategy {
  /** Seconds to serve cached data as fresh. */
  ttl: number
  /** Extra seconds to serve stale data while revalidating in the background. */
  swr?: number
}

/**
 * Standard paginated result envelope returned by all list queries.
 */
export interface QueryResult<T = Record<string, unknown>> {
  data: T[]
  meta: {
    /** Exact count of the full set (ignores cursor/offset); `null` only when the query asked for `total: false`. */
    total: number | null
    limit: number
    offset: number
    /** Whether a page follows this one. Always present; exact whether or not `total` was computed. */
    hasMore?: boolean
    /** Cursor for the next page (keyset pagination); null when this is the last page. */
    nextCursor?: string | null
    /** How the cache served this response: hit | stale | miss. Absent when caching was not engaged. */
    cache?: 'hit' | 'stale' | 'miss'
  }
}
