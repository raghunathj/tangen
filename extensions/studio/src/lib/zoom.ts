/**
 * File Name: zoom.ts
 * Purpose: The canvas zoom ladder.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Fixed steps rather than free scaling. A design tool's
 *          zoom is a ladder people learn the rungs of, and arbitrary values
 *          make "back to where I was" impossible - 100% has to be somewhere
 *          you can always land, which is also why it is a rung.
 */

/** The rungs, ascending. 1 is always present so Reset is reachable. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** The next rung up, or the current one at the ceiling. */
export function zoomIn(current: number): number {
  return ZOOM_STEPS.find((z) => z > current) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
}

/** The next rung down, or the current one at the floor. */
export function zoomOut(current: number): number {
  const below = ZOOM_STEPS.filter((z) => z < current)
  return below.length > 0 ? below[below.length - 1] : ZOOM_STEPS[0]
}
