/**
 * File Name: anchored-dropdown.tsx
 * Purpose: A body-portaled dropdown anchored to a trigger element - fixed
 *          positioning so overflow-auto ancestors (sheet bodies, side panes)
 *          can never clip it, flipping above the anchor when the viewport
 *          runs out below. Used by the schema builder's type picker and the
 *          label suggestions list.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Carries data-tangen-overlay + pointer-events-auto so
 *          Radix modal Sheets/Dialogs neither swallow its clicks (modal mode
 *          sets body pointer-events:none) nor dismiss themselves when a click
 *          lands here - the ui Dialog/Sheet guards know the attribute.
 */
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface Pos {
  left: number
  /** Distance from the viewport's right edge to the anchor's right edge. */
  right: number
  width: number
  top: number
  up: boolean
}

export function AnchoredDropdown({
  anchorRef, open, children, className, estHeight = 240, align = 'start', matchWidth = true,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  children: React.ReactNode
  className?: string
  /** Used only to decide whether to flip above the anchor. */
  estHeight?: number
  /** 'start' pins the dropdown's left edge to the anchor's left (default);
   *  'end' pins its right edge to the anchor's right. */
  align?: 'start' | 'end'
  /** Match the anchor's width (default). Pass false to let content size itself. */
  matchWidth?: boolean
}) {
  const [pos, setPos] = useState<Pos | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const up = r.bottom + estHeight > window.innerHeight && r.top > estHeight
      setPos({ left: r.left, right: window.innerWidth - r.right, width: r.width, top: up ? r.top - 4 : r.bottom + 4, up })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, estHeight])

  if (!open || !pos) return null
  return createPortal(
    <div
      data-tangen-overlay=""
      style={{
        position: 'fixed',
        ...(align === 'end' ? { right: pos.right } : { left: pos.left }),
        ...(matchWidth ? { width: pos.width } : {}),
        ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
        zIndex: 65,
      }}
      className={`pointer-events-auto ${className ?? ''}`}
    >
      {children}
    </div>,
    document.body,
  )
}
