/**
 * File Name: use-sidebar-width.ts
 * Purpose: The resizable sidebar's width (tasks/ui-v2-calibration.md,
 *          "Sidebar resize"): 250px by default, dragged between 160 and 280
 *          through an 8px handle, moved 8px per arrow key from the handle,
 *          persisted, and applied as one CSS custom property so the shell
 *          never relays out mid-drag.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure helpers (clamp, keyboard step, drag maths) are
 *          exported for the test; the hook binds them to pointer events and
 *          localStorage. Dragging sets `data-dragging` so the width
 *          transition is off while the pointer moves.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResizeBounds { key: string; min: number; max: number; default: number; step: number; /** Dragging the handle to the LEFT makes a right-side panel wider. */ edge: 'right' | 'left'; label: string }

export const SIDEBAR_WIDTH_KEY = 'tangen-sidebar-width'
export const SIDEBAR_WIDTH: ResizeBounds = { key: SIDEBAR_WIDTH_KEY, min: 160, max: 280, default: 250, step: 8, edge: 'right', label: 'Resize sidebar' }
/** The editor's inspector: a content inspector, narrower than the benchmark's record panel (480 to 800). */
export const INSPECTOR_WIDTH: ResizeBounds = { key: 'tangen-inspector-width', min: 280, max: 480, default: 300, step: 8, edge: 'left', label: 'Resize panel' }

export function clampWidth(px: number, b: ResizeBounds): number {
  if (!Number.isFinite(px)) return b.default
  return Math.min(b.max, Math.max(b.min, Math.round(px)))
}
export const clampSidebarWidth = (px: number) => clampWidth(px, SIDEBAR_WIDTH)

export function readStoredWidth(storage: Pick<Storage, 'getItem'> | null | undefined, b: ResizeBounds = SIDEBAR_WIDTH): number {
  try {
    const v = storage?.getItem(b.key)
    return v == null ? b.default : clampWidth(Number(v), b)
  } catch {
    return b.default
  }
}

/** The width a key press asks for from the handle (the separator role's contract). */
export function keyboardWidth(current: number, key: string, b: ResizeBounds = SIDEBAR_WIDTH): number | null {
  const grow = b.edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = b.edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
  switch (key) {
    case shrink: return clampWidth(current - b.step, b)
    case grow: return clampWidth(current + b.step, b)
    case 'Home': return b.min
    case 'End': return b.max
    default: return null
  }
}

/** The width a drag asks for: the width at pointer-down plus the pointer's travel. */
export function dragWidth(startWidth: number, startX: number, x: number, b: ResizeBounds = SIDEBAR_WIDTH): number {
  const travel = b.edge === 'right' ? x - startX : startX - x
  return clampWidth(startWidth + travel, b)
}

export function useSidebarWidth() { return useResizableWidth(SIDEBAR_WIDTH) }

export function useResizableWidth(b: ResizeBounds) {
  const [width, setWidthState] = useState<number>(() => (typeof window === 'undefined' ? b.default : readStoredWidth(window.localStorage, b)))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const setWidth = useCallback((px: number) => {
    const next = clampWidth(px, b)
    setWidthState(next)
    try { window.localStorage.setItem(b.key, String(next)) } catch {}
  }, [b])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = { startX: e.clientX, startWidth: width }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDragging(true)
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    setWidthState(dragWidth(drag.current.startWidth, drag.current.startX, e.clientX, b))
  }, [b])

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    const next = dragWidth(drag.current.startWidth, drag.current.startX, e.clientX, b)
    drag.current = null
    setDragging(false)
    setWidth(next)
  }, [setWidth])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const next = keyboardWidth(width, e.key, b)
    if (next === null) return
    e.preventDefault()
    setWidth(next)
  }, [width, setWidth, b])

  // A width chosen in another tab follows here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === b.key && e.newValue) setWidthState(clampWidth(Number(e.newValue), b)) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [b])

  return {
    width, dragging, setWidth,
    handleProps: {
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': width,
      'aria-valuemin': b.min,
      'aria-valuemax': b.max,
      'aria-label': b.label,
      tabIndex: 0,
      'data-dragging': dragging || undefined,
      onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onKeyDown,
    },
  }
}
