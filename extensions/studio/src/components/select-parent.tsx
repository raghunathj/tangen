/**
 * File Name: select-parent.tsx
 * Purpose: The select-parent affordance on the selected block.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Reaching the parent is how anyone works in a nested
 *          tree - without it, selecting a section means hunting for it in
 *          Structure every time. Webflow offers the same through its element
 *          breadcrumb. The path walk lives in lib/canvas-resize.ts.
 *
 *          This used to share a file with on-canvas resize handles, which
 *          were removed: dragging an element's edges is a Framer and Figma
 *          convention, not a Webflow one, and a fixed pixel size is usually
 *          the wrong thing to set on responsive content - the handle made
 *          that too easy to do by accident. Width and height are typed in the
 *          Size section, as in Webflow.
 */
import { clsx } from 'clsx'
import { IconArrowUp } from '@tangen/icons'
import type { Box } from '../lib/canvas-resize'

interface SelectParentProps {
  rect: Box | null
  onSelect?: () => void
  label?: string
}

export function SelectParent({ rect, onSelect, label }: SelectParentProps) {
  if (!rect || !onSelect) return null
  return (
    <button
      type="button"
      onClick={onSelect}
      title={label ? `Select parent: ${label}` : 'Select parent'}
      style={{ top: rect.top - 26, left: rect.left - 1 }}
      className={clsx(
        'absolute z-30 flex items-center gap-1 h-5 px-1.5 rounded-t',
        'bg-accent text-fg-inverted text-[10px] font-medium',
        'opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-(--tg-motion-fast)',
      )}
    >
      <IconArrowUp className="size-3" />
      {label && <span className="max-w-24 truncate">{label}</span>}
    </button>
  )
}
