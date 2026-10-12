/**
 * File Name: filter.ts
 * Purpose: Translates a generated GraphQL WhereInput value into the
 *          platform's QueryFilter DSL (the same one REST accepts) — field
 *          operator maps plus recursive _and/_or groups. Values only; no
 *          field is invented that the caller didn't supply.
 *
 * Author: Raghunath J
 * License: MIT
 */
import type { QueryFilter } from '@tangen/types'

const OPERATORS = new Set(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'contains', 'ncontains', 'startsWith', 'nin', 'exists'])

/** WhereInput → QueryFilter. Empty/undefined ⇒ {}. */
export function whereToFilter(where: Record<string, unknown> | null | undefined): QueryFilter {
  if (!where || typeof where !== 'object') return {}
  const out: QueryFilter = {}
  for (const [key, value] of Object.entries(where)) {
    if (value == null) continue
    if (key === '_and' || key === '_or') {
      const groups = (value as unknown[]).map((g) => whereToFilter(g as Record<string, unknown>))
      ;(out as Record<string, unknown>)[key] = groups
      continue
    }
    // A field filter object: keep only recognized operators
    if (typeof value === 'object' && !Array.isArray(value)) {
      const ops: Record<string, unknown> = {}
      for (const [op, v] of Object.entries(value as Record<string, unknown>)) {
        if (OPERATORS.has(op) && v !== undefined) ops[op] = v
      }
      if (Object.keys(ops).length > 0) out[key] = ops
    } else {
      // Scalar shorthand → eq
      out[key] = value
    }
  }
  return out
}
