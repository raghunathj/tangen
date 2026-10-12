/**
 * File Name: canvas-toolbar.tsx
 * Purpose: The actions that follow the selected block ON the canvas -
 *          move up, move down, duplicate, delete - so composing a page does
 *          not mean travelling to the tree for every change.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Rendered by the ADMIN over the preview iframe, never
 *          injected into the customer's site - no DOM mutation of someone
 *          else's page, and no new version-skew surface.
 *
 *          Position comes from the geometry protocol (E-T2), whose rects are
 *          VIEWPORT-relative to the preview. This sits in a container that
 *          exactly overlays the iframe, so those numbers are used as-is with
 *          no offset arithmetic.
 */
import { clsx } from 'clsx'
import { selectionBox } from '../lib/rects'
import { IconArrowUp, IconArrowDown, IconCopy, IconPlus, IconTrash } from '@tangen/icons'

export interface CanvasRect { top: number; left: number; width: number; height: number }

interface CanvasToolbarProps {
  /** The selected block's box, in preview-viewport coordinates. */
  rect: CanvasRect | null
  label: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (delta: number) => void
  onDuplicate: () => void
  onDelete: () => void
  /** Insert a sibling after this block; absent hides the affordance. */
  onInsert?: () => void
}

const BAR_H = 28

export function CanvasToolbar({
  rect, label, canMoveUp, canMoveDown, onMove, onDuplicate, onDelete, onInsert,
}: CanvasToolbarProps) {
  if (!rect) return null

  // Above the block by default; inside it when the block is at the very top
  // of the viewport, so the bar never sits off-screen.
  const above = rect.top >= BAR_H + 4
  const top = above ? rect.top - BAR_H - 4 : Math.max(rect.top + 4, 4)

  const btn = 'grid place-items-center size-6 rounded text-white/80 hover:text-white hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <>
      {/* The selection outline, drawn by the admin rather than the site.
          Square and offset to match the site overlay's hover outline exactly:
          a rounded ring around a square box reads as misaligned, and a
          different inset makes the border step inwards on click. */}
      <div
        aria-hidden
        className="pointer-events-none absolute ring-2 ring-accent transition-all duration-(--tg-motion)"
        style={selectionBox(rect)}
      />
      <div
        className="absolute flex items-center gap-0.5 rounded-md bg-accent px-1 shadow-lg"
        style={{ top, left: rect.left, height: BAR_H }}
      >
        <span className="px-1.5 text-[11px] font-medium text-white/90 max-w-[160px] truncate">{label}</span>
        <span className="w-px h-4 bg-white/25" />
        <button type="button" title="Move up" className={btn} disabled={!canMoveUp} onClick={() => onMove(-1)}>
          <IconArrowUp className="size-3.5" />
        </button>
        <button type="button" title="Move down" className={btn} disabled={!canMoveDown} onClick={() => onMove(1)}>
          <IconArrowDown className="size-3.5" />
        </button>
        {onInsert && (
          <button type="button" title="Insert after this" className={btn} onClick={onInsert}>
            <IconPlus className="size-3.5" />
          </button>
        )}
        <button type="button" title="Duplicate" className={btn} onClick={onDuplicate}>
          <IconCopy className="size-3.5" />
        </button>
        <button
          type="button"
          title="Delete"
          className={clsx(btn, 'hover:bg-red-500/80')}
          onClick={onDelete}
        >
          <IconTrash className="size-3.5" />
        </button>
      </div>
    </>
  )
}
