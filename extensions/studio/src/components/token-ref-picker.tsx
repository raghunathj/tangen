/**
 * File Name: token-ref-picker.tsx
 * Purpose: The scoped token picker beside a style control.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One consistent affordance for every property whose
 *          value is reusable: the literal control stays, a small token button
 *          sits beside it, and picking a token replaces the control with a
 *          chip naming the slot plus a clear. Spacing keeps its faster inline
 *          chips in the box model; everything else uses this.
 *
 *          Only compatible tokens are offered - lib/token-pick.ts decides
 *          which, typed by family - and what is stored is the reference,
 *          never a var() string.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { IconX } from '@tangen/icons'
import { pickedSlot } from '../lib/token-pick'

interface TokenRefPickerProps {
  /** Compatible slots. Null means this property takes literals only. */
  slots: string[] | null
  value: string
  /** Stores a reference, or '' to clear back to a literal. */
  onPick: (slot: string | null) => void
  /** The literal control. */
  children: ReactNode
}

export function TokenRefPicker({ slots, value, onPick, children }: TokenRefPickerProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const slot = pickedSlot(value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!slots) return <>{children}</>

  // A picked token shows as a chip: the slot is what the designer chose, and
  // the literal control would only invite editing a value that is not there.
  if (slot) {
    return (
      <div className="flex items-center gap-1">
        <span
          title={value}
          className="flex-1 min-w-0 flex items-center h-(--tg-control-h) px-2 rounded-md bg-accent-muted text-accent-fg text-(length:--tg-text-control) font-medium truncate"
        >
          <span className="opacity-60 mr-1">{'{'}</span>{slot}<span className="opacity-60 ml-1">{'}'}</span>
        </span>
        <button
          type="button"
          title="Clear the token and type a value"
          onClick={() => onPick(null)}
          className="grid place-items-center size-6 shrink-0 rounded text-fg-subtle hover:text-fg hover:bg-surface-raised transition-colors duration-(--tg-motion-fast)"
        >
          <IconX className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <div ref={root} className="relative flex items-center gap-1">
      <div className="flex-1 min-w-0">{children}</div>
      <button
        type="button"
        title="Use a token"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'grid place-items-center size-6 shrink-0 rounded text-[11px] font-semibold transition-colors duration-(--tg-motion-fast)',
          open ? 'bg-accent text-fg-inverted' : 'text-fg-subtle hover:text-fg hover:bg-surface-raised',
        )}
      >
        {'{}'}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 z-30 min-w-28 max-h-48 overflow-y-auto py-1 rounded-md border border-border bg-surface shadow-lg"
        >
          {slots.map((s) => (
            <li
              key={s}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onPick(s) }}
              className="px-2 h-6 flex items-center text-xs text-fg-muted hover:bg-surface-raised hover:text-fg cursor-pointer"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
