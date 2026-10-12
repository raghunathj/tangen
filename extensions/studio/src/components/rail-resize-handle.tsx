/**
 * File Name: rail-resize-handle.tsx
 * Purpose: The grab edge of a rail - drag it to resize the left panel or
 *          the right inspector, arrow keys to nudge, double-click to reset.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The arithmetic (which way widens, the bounds) lives
 *          in lib/panels.ts and is tested there; this owns the pointer and
 *          keyboard mechanics only. Pointer capture keeps the drag alive
 *          when the cursor crosses the preview iframe, which would otherwise
 *          swallow the move events and leave the rail stuck mid-drag. The
 *          width is reported live on every move and COMMITTED on release,
 *          so the caller persists once, not sixty times a second.
 */
import { useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { dragWidth, nudgeWidth, type RailSide } from '../lib/panels'

interface RailResizeHandleProps {
  side: RailSide
  width: number
  label: string
  /** Live, during the drag or on a key press. */
  onResize: (width: number) => void
  /** Once, on release or after a key press - the moment to persist. */
  onCommit: (width: number) => void
  /** Double-click: back to the default width. */
  onReset: () => void
}

export function RailResizeHandle({ side, width, label, onResize, onCommit, onReset }: RailResizeHandleProps) {
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = { startX: e.clientX, startWidth: width, last: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const next = dragWidth({ side, startWidth: d.startWidth, startX: d.startX, x: e.clientX })
    if (next !== d.last) { d.last = next; onResize(next) }
  }, [side, onResize])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // A click with no movement commits nothing: nothing changed.
    if (d.last !== d.startWidth) onCommit(d.last)
  }, [onCommit])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nudgeWidth(side, width, e.key)
    if (next === null) return
    e.preventDefault()
    if (next !== width) { onResize(next); onCommit(next) }
  }, [side, width, onResize, onCommit])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      title={`Drag to resize. Double-click to reset.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className={clsx(
        // Wider than its visible line, so it is easy to catch; the line
        // itself only shows on hover, focus or while dragging.
        'absolute top-0 bottom-0 z-10 w-2 cursor-col-resize group/handle outline-none',
        side === 'left' ? '-right-1' : '-left-1',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute top-0 bottom-0 w-0.5 bg-accent opacity-0 transition-opacity',
          'group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100 group-active/handle:opacity-100',
          side === 'left' ? 'left-[3px]' : 'right-[3px]',
        )}
      />
    </div>
  )
}
