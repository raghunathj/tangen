/**
 * File Name: resizer.tsx
 * Purpose: Draggable divider for the playground's panes — vertical (column
 *          widths) and horizontal (pane heights) variants sharing one
 *          pointer-tracking implementation.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useRef } from 'react'
import { clsx } from 'clsx'

/**
 * A thin drag divider. `onResize` receives the pointer delta since drag start
 * (px, positive = right/down) plus the value captured at drag start via
 * `startValue` — the parent clamps and applies.
 */
export function Resizer({ direction, startValue, onResize, className }: {
  direction: 'col' | 'row'
  startValue: () => number
  onResize: (startValue: number, delta: number) => void
  className?: string
}) {
  const drag = useRef<{ start: number; value: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { start: direction === 'col' ? e.clientX : e.clientY, value: startValue() }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const pos = direction === 'col' ? ev.clientX : ev.clientY
      onResize(d.value, pos - d.start)
    }
    const up = () => {
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      title="Drag to resize"
      className={clsx(
        'shrink-0 touch-none transition-colors hover:bg-accent-muted/60 active:bg-accent-muted',
        direction === 'col' ? 'w-1.5 cursor-col-resize border-l border-border' : 'h-1.5 cursor-row-resize border-t border-border',
        className,
      )}
    />
  )
}
