/**
 * File Name: instance.ts
 * Purpose: Gives every rendered row of a loop its own block identity.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A loop renders ONE stored template block once per
 *          record, so without this the page carries several elements all
 *          stamped with the same `data-tangen-block` key. Studio keys its
 *          geometry map by that attribute, so duplicates silently collapse:
 *          clicking the first row outlines the last one.
 *
 *          The rewrite is DEEP because a template may itself contain a
 *          section or row whose children are duplicated just the same. It
 *          runs on the already-bound COPY, so stored blocks are untouched
 *          and the template keeps its original keys - which is what the
 *          editor writes edits back to (see templateKeyOf).
 */
import { instanceKey } from '@tangen/studio'
import type { BlockNode } from './types'

/** Rewrites `_key` on every block in a subtree to name row `index`. */
function suffix(value: unknown, index: number): unknown {
  if (Array.isArray(value)) return value.map((entry) => suffix(entry, index))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = k === '_key' && typeof v === 'string' ? instanceKey(v, index) : suffix(v, index)
  }
  return out
}

/**
 * Returns a copy of one bound template block whose keys - its own and every
 * nested one - name the row rendering it.
 */
export function instanceBlock(block: BlockNode, index: number): BlockNode {
  return suffix(block, index) as BlockNode
}
