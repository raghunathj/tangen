/**
 * File Name: rects.ts
 * Purpose: Reading a block's box out of the geometry report, and the box the
 *          selection outline is drawn at.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A loop renders one stored block once per record, so
 *          the page reports a rect per ROW while the tree only ever knows
 *          the template key. Every geometry read therefore goes through
 *          `rectFor`, which bridges the two identities.
 */
import { templateKeyOf, isInstanceKey } from '@tangen/studio'

/**
 * A TYPE alias, not an interface, on purpose: the admin augments React's
 * CSSProperties with a `--radix-*` index signature, and TypeScript grants
 * implicit index signatures to type aliases but not to named interfaces. As
 * an interface this could not be passed to `style` at all.
 */
export type Rect = { top: number; left: number; width: number; height: number }

/** Matches the site overlay's `outline-offset` so hover and selection agree. */
export const HOVER_OFFSET = 2

/** The row index encoded in an instance key, or null for a plain key. */
function rowIndex(key: string): number | null {
  const m = /~(\d+)$/.exec(key)
  return m ? Number(m[1]) : null
}

/**
 * The box for `key`, which may be a template key the page rendered many
 * times. `instance` is the occurrence the user actually clicked; it wins when
 * it is still on the page AND belongs to this block, so the outline stays on
 * the row they picked rather than jumping to the first one. Otherwise the
 * LOWEST row index answers - deterministic regardless of report order.
 */
export function rectFor(
  geometry: Map<string, Rect>,
  key: string,
  instance?: string | null,
): Rect | null {
  if (instance && templateKeyOf(instance) === key) {
    const hit = geometry.get(instance)
    if (hit) return hit
  }
  const exact = geometry.get(key)
  if (exact) return exact

  let best: Rect | null = null
  let bestIndex = Infinity
  for (const [k, rect] of geometry) {
    if (!isInstanceKey(k) || templateKeyOf(k) !== key) continue
    const i = rowIndex(k) ?? Infinity
    if (i < bestIndex) { bestIndex = i; best = rect }
  }
  return best
}

/**
 * Grows a block's box by the hover inset. The site draws its hover outline
 * with `outline-offset: 2px`; the admin draws the SELECTED outline itself, so
 * without this the border visibly steps inwards the moment you click.
 */
export function selectionBox(rect: Rect): Rect {
  return {
    top: rect.top - HOVER_OFFSET,
    left: rect.left - HOVER_OFFSET,
    width: Math.max(0, rect.width + HOVER_OFFSET * 2),
    height: Math.max(0, rect.height + HOVER_OFFSET * 2),
  }
}
