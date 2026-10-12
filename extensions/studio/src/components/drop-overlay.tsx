/**
 * File Name: drop-overlay.tsx
 * Purpose: The surface that makes dragging onto the canvas possible at all,
 *          plus the line showing where the block will land.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: An iframe swallows drag events, so the parent never
 *          sees a drag crossing it. This covers the iframe for the DURATION
 *          of a drag only - pointer-events go through the rest of the time,
 *          so ordinary clicking and scrolling of the preview is untouched.
 *
 *          The admin therefore gets the drag in its OWN coordinate space,
 *          which is the same space geometry reports rects in - so finding
 *          the drop target is arithmetic rather than hit-testing across a
 *          document boundary.
 */
import { clsx } from 'clsx'

export interface DropIndicator {
  /** Where to draw the line, in preview-viewport coordinates. */
  top: number
  left: number
  width: number
  /** A drop the slot refuses - shown, but as a refusal. */
  invalid?: boolean
}

interface DropOverlayProps {
  active: boolean
  indicator: DropIndicator | null
  onOver: (y: number) => void
  onDrop: () => void
  onLeave: () => void
}

export function DropOverlay({ active, indicator, onOver, onDrop, onLeave }: DropOverlayProps) {
  return (
    <div
      className={clsx('absolute inset-0 z-20', active ? 'pointer-events-auto' : 'pointer-events-none')}
      onDragOver={(e) => {
        if (!active) return
        e.preventDefault()
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        onOver(e.clientY - box.top)
      }}
      onDrop={(e) => { if (!active) return; e.preventDefault(); onDrop() }}
      onDragLeave={() => { if (active) onLeave() }}
    >
      {active && indicator && (
        <div
          aria-hidden
          className={clsx(
            'absolute h-0.5 rounded-full',
            indicator.invalid ? 'bg-red-500' : 'bg-accent',
          )}
          style={{ top: indicator.top, left: indicator.left, width: indicator.width }}
        >
          <span
            className={clsx(
              'absolute -left-1 -top-[3px] size-2 rounded-full',
              indicator.invalid ? 'bg-red-500' : 'bg-accent',
            )}
          />
        </div>
      )}
    </div>
  )
}
