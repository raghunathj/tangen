/**
 * File Name: binding.ts
 * Purpose: The data-binding descriptor and its resolution - how a loop's
 *          item template says "this prop comes from the record, not from a
 *          fixed value". One sentinel shape, `{ $bind: 'item.<path>',
 *          fallback? }`, resolved per row by kit.loop before the template
 *          renders.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Bind paths are EDITOR-SUPPLIED, therefore untrusted:
 *          `readPath` walks own properties only and refuses the prototype
 *          segments (__proto__/constructor/prototype), so a stored path can
 *          never climb out of the record it was handed. Paths are rooted at
 *          a literal `item.` - the only context a loop template has today -
 *          which keeps the surface closed until more roots are designed.
 *          Substitution is a pure deep COPY: templates are never mutated,
 *          so the same template renders every row independently.
 */
import type { BlockNode } from './types'

/** A prop that reads from the current loop record instead of a fixed value. */
export type BindingDescriptor = {
  /** Dotted path rooted at the loop record, e.g. `item.author.name`. */
  $bind: string
  /** Used when the path is missing or resolves to null/undefined. */
  fallback?: unknown
}

/** Segments that would climb the prototype chain - never traversed. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/** The only binding root a loop item template has today. */
const ROOT = 'item'

/** True when a stored prop value is a binding descriptor rather than a value. */
export function isBinding(value: unknown): value is BindingDescriptor {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as BindingDescriptor).$bind === 'string'
  )
}

/**
 * Walks a dotted path over own properties only. Returns undefined for any
 * missing segment, any non-object mid-path, and any forbidden segment.
 */
function readPath(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (FORBIDDEN.has(segment)) return undefined
    if (!current || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Resolves one prop value against the current record. Non-descriptors pass
 * through untouched, so a template mixes bound and static props freely.
 * Present-but-falsy values (0, false, '') are real data and are KEPT - only
 * missing/null resolves to the fallback.
 */
export function resolveBinding(value: unknown, item: unknown): unknown {
  if (!isBinding(value)) return value
  const segments = value.$bind.split('.')
  if (segments.length < 2 || segments[0] !== ROOT) return value.fallback
  const resolved = readPath(item, segments.slice(1))
  return resolved === undefined || resolved === null ? value.fallback : resolved
}

/** Deep-substitutes bindings through arrays, plain objects, and blocks. */
function bindValue(value: unknown, item: unknown): unknown {
  if (isBinding(value)) return resolveBinding(value, item)
  if (Array.isArray(value)) return value.map((entry) => bindValue(entry, item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = bindValue(inner, item)
    }
    return out
  }
  return value
}

/**
 * Returns a copy of one template block with every binding resolved against
 * `item` - top-level props, repeater rows, and nested child block arrays
 * alike. The input is never mutated; a binding-free template round-trips
 * structurally equal.
 */
export function bindBlock(block: BlockNode, item: unknown): BlockNode {
  return bindValue(block, item) as BlockNode
}
