/**
 * File Name: canvas-frame.ts
 * Purpose: Lining the admin's canvas overlays up with the preview iframe.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Geometry (E-T2) reports rects in the IFRAME's
 *          viewport. The admin draws in its own container - and the preview
 *          canvas puts the iframe inside padding, centres it, and wraps the
 *          whole thing in a SCROLLING box. So the two coordinate spaces are
 *          related by an offset that changes as the canvas scrolls, as the
 *          preview width changes, and as the window resizes.
 *
 *          Drawing ADDS the offset; hit-testing SUBTRACTS it. Getting only
 *          one of those right is worse than neither, because the insertion
 *          line would then point somewhere the drop does not land.
 *
 *          Zoom (V-T7) is a CSS transform on the frame, but geometry keeps
 *          reporting rects in the frame's OWN pixels - so the same rule
 *          applies one layer up: drawing multiplies by the scale, hit-
 *          testing divides by it.
 */

export interface Box { top: number; left: number; width: number; height: number }
export interface Offset { top: number; left: number }

/** Used when either box is unmeasured - draw unshifted rather than NaN. */
export const NO_OFFSET: Offset = { top: 0, left: 0 }

/** Where the frame sits inside the container the overlays are drawn in. */
export function frameOffsetOf(container: Box | null | undefined, frame: Box | null | undefined): Offset {
  if (!container || !frame) return NO_OFFSET
  return { top: frame.top - container.top, left: frame.left - container.left }
}

/** A zoom that would collapse or invert the canvas is treated as 100%. */
function safeZoom(zoom: number | undefined): number {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

/** Frame coordinates -> container coordinates, for drawing. */
export function toCanvasRect(rect: Box, offset: Offset, zoom?: number): Box {
  const z = safeZoom(zoom)
  return {
    top: rect.top * z + offset.top,
    left: rect.left * z + offset.left,
    width: rect.width * z,
    height: rect.height * z,
  }
}

/** Container coordinates -> frame coordinates, for hit-testing a pointer. */
export function toFrameY(y: number, offset: Offset, zoom?: number): number {
  return (y - offset.top) / safeZoom(zoom)
}
