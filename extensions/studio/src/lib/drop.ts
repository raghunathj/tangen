/**
 * File Name: drop.ts
 * Purpose: Where a drop lands on the canvas, and whether it may land there.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The interaction gets freer; the schema keeps every
 *          guarantee. A drop resolves to a TYPED SLOT - a container path
 *          and an index - and that slot's OWN `components` list decides
 *          what may land in it. So `hero` can be legal at the top of a page
 *          and illegal inside a section, and the drop knows the difference.
 *
 *          Positions come from the geometry protocol (E-T2), whose rects
 *          share a coordinate space with the admin's drag overlay - which is
 *          what lets this be arithmetic rather than hit-testing across an
 *          iframe boundary.
 */
import type { BlockRow } from './model'
import { rectFor } from './rects'
import type { BlockPath } from './ops'

export interface DropPoint {
  /** The array a block would be inserted into. Empty means the page itself. */
  containerPath: BlockPath
  index: number
  /** The block type owning that array; null at top level. */
  containerType: string | null
}

type Rect = { top: number; left: number; width: number; height: number }

/** The page itself, before everything or after everything. */
const atPage = (index: number): DropPoint => ({ containerPath: [], index, containerType: null })

/**
 * Resolves a pointer position to an insertion point. The DEEPEST measured
 * block under the pointer wins - otherwise a section would always swallow
 * the drop and nothing could ever land between two widgets inside it.
 */
export function resolveDropPoint(
  y: number,
  rows: BlockRow[],
  rects: Map<string, Rect>,
): DropPoint {
  let best: { row: BlockRow; rect: Rect } | null = null
  for (const row of rows) {
    // rectFor, not a plain get: a row inside a loop's item template is
    // rendered under per-row keys, so a direct lookup would skip it and the
    // drop would silently resolve to its parent.
    const rect = rectFor(rects, row.key)
    if (!rect) continue
    if (y < rect.top || y > rect.top + rect.height) continue
    if (!best || row.depth > best.row.depth) best = { row, rect }
  }

  if (!best) {
    // Above everything measured, or below it.
    let lowest = -Infinity
    let any = false
    for (const row of rows) {
      const rect = rects.get(row.key)
      if (!rect || row.depth !== 0) continue
      any = true
      lowest = Math.max(lowest, rect.top + rect.height)
    }
    if (!any) return atPage(0)
    const topLevel = rows.filter((r) => r.depth === 0 && rects.has(r.key))
    return y > lowest ? atPage(topLevel.length) : atPage(0)
  }

  // Top half inserts before, bottom half after.
  const after = y > best.rect.top + best.rect.height / 2
  const index = best.row.index + (after ? 1 : 0)
  const containerPath = best.row.path.slice(0, -1)
  const containerType = containerPath.length === 0
    ? null
    : parentTypeOf(best.row, rows)

  return { containerPath, index, containerType }
}

/** The type of the block owning this row's container array. */
function parentTypeOf(row: BlockRow, rows: BlockRow[]): string | null {
  const parentPath = row.path.slice(0, -2)   // drop [.., 'prop', i]
  const parent = rows.find((r) =>
    r.path.length === parentPath.length && r.path.every((v, i) => v === parentPath[i]))
  return parent?.type ?? null
}

interface DefLike {
  name: string
  fields?: Array<{ name: string; fieldType: string; config?: { components?: Array<{ name?: string } | string> } }>
}

/**
 * What a container will accept. At top level that is the blocks FIELD's own
 * list (what the site declared); inside a block it is that block's first
 * child slot.
 */
export function allowedChildTypes(
  containerType: string | null,
  defs: DefLike[],
  fieldComponents: string[],
): string[] {
  if (containerType === null) return fieldComponents
  const def = defs.find((d) => d.name === containerType)
  const slot = def?.fields?.find((f) => f.fieldType === 'component')
  const comps = slot?.config?.components ?? []
  return comps.map((c) => (typeof c === 'string' ? c : c.name ?? '')).filter(Boolean)
}

/** Whether this type may land here. The slot decides, never the gesture. */
export function canDrop(
  type: string,
  target: DropPoint | null,
  defs: DefLike[],
  fieldComponents: string[],
): boolean {
  if (!target) return false
  return allowedChildTypes(target.containerType, defs, fieldComponents).includes(type)
}
