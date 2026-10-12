/**
 * File Name: inline-editor.tsx
 * Purpose: Typing copy directly on the page - an input the ADMIN renders
 *          over the block, wearing that block's own typography.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Not `contentEditable` inside the customer's site. That
 *          would mean mutating someone else's DOM and then serialising
 *          browser-generated markup back into a typed field - a class of bug
 *          with no clean bottom. An admin-owned input over the block keeps
 *          the value a plain string all the way to the draft.
 *
 *          The typography comes from the measure round-trip (E-T4 protocol)
 *          so the words do not visibly jump when editing starts.
 */
import { useEffect, useRef, useState } from 'react'
import type { StudioTextStyle } from '@tangen/studio'

export interface InlineEditTarget {
  key: string
  prop: string
  rect: { top: number; left: number; width: number; height: number }
  style: StudioTextStyle
  initial: string
}

interface InlineEditorProps {
  target: InlineEditTarget
  onCommit: (value: string) => void
  onCancel: () => void
}

export function InlineEditor({ target, onCommit, onCancel }: InlineEditorProps) {
  const [value, setValue] = useState(target.initial)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Re-seed when the target changes, or double-clicking a second block would
  // show the first block's words.
  useEffect(() => { setValue(target.initial) }, [target.key, target.prop, target.initial])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [target.key, target.prop])

  const s = target.style
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue((e.target as HTMLTextAreaElement).value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        // Enter commits: this is single-line copy, so a newline would be a
        // value the field cannot hold anyway.
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit(value) }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      /* White on purpose: this overlays the PREVIEW page, not Studio's
         chrome, so it must match the site being edited - not the dark rail. */
      className="absolute z-10 resize-none overflow-hidden rounded-sm bg-white/95 text-black outline-none ring-2 ring-accent shadow-lg"
      style={{
        top: target.rect.top,
        left: target.rect.left,
        width: target.rect.width,
        minHeight: target.rect.height,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight as never,
        color: s.color,
        textAlign: s.textAlign as never,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        padding: 0,
      }}
    />
  )
}
