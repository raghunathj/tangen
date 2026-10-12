/**
 * File Name: box-model-control.tsx
 * Purpose: Webflow's box-model diagram - margin outside, padding inside, each
 *          side draggable.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Eight number inputs in a column is a form. One diagram
 *          you drag is a design tool, and it is the interaction people name
 *          when they say a builder feels like Webflow - so the modifiers are
 *          Webflow's: Shift for coarse steps, Alt for the opposite side, Cmd
 *          for all four.
 *
 *          The drag previews LOCALLY and commits ONCE on release, with every
 *          affected side in a single batch. The first version committed per
 *          pointer frame, and each frame carried the class version it had
 *          read before the first frame landed - so the stale-write guard
 *          refused every frame after the first and the designer saw "someone
 *          else changed this class". Committing once is also what makes a
 *          drag cost one undo rather than fifty.
 *
 *          A side holding a design token shows the slot name and cannot be
 *          dragged: the panel cannot resolve a default token to a number, so
 *          a drag would have to start from a guess. Double-click still lets a
 *          value be typed over it.
 */
import { useCallback, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  BOX_SIDES, boxPropertyId, sidesToWrite, applyDrag, tokenSlot, sideLabel, tokenValue,
  type BoxSide, type BoxProperty,
} from '../lib/box-model'

interface BoxModelControlProps {
  /** Current value of a property id, at the active breakpoint and state. */
  read: (propertyId: string) => string | undefined
  /** All sides a drag or an edit changed, committed together as ONE write. */
  onCommit: (changes: Record<string, string>) => void
  /** Marks a side that is set on THIS class rather than inherited. */
  isSet?: (propertyId: string) => boolean
  /** The workspace's spacing tokens, offered as one-click values when
   *  editing a side - so a designer can set a VARIABLE, not only a number. */
  spaceTokens?: readonly string[]
  disabled?: boolean
}

interface Drag {
  property: BoxProperty
  side: BoxSide
  y: number
  from: string | undefined
  /** Live values while dragging, keyed by property id. */
  preview: Record<string, string>
}

function SideCell({
  property, side, read, isSet, disabled, spaceTokens, drag, onDragStart, onDragMove, onDragEnd, onType,
}: {
  property: BoxProperty
  side: BoxSide
  read: BoxModelControlProps['read']
  isSet?: BoxModelControlProps['isSet']
  spaceTokens?: readonly string[]
  disabled?: boolean
  drag: Drag | null
  onDragStart: (property: BoxProperty, side: BoxSide, y: number, from: string | undefined) => void
  onDragMove: (y: number, mod: { shift: boolean; alt: boolean; meta: boolean }) => void
  onDragEnd: () => void
  onType: (propertyId: string, value: string) => void
}) {
  const id = boxPropertyId(property, side)
  const stored = read(id)
  const value = drag?.preview[id] ?? stored
  const slot = tokenSlot(stored)
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="relative w-full">
        <input
          autoFocus
          defaultValue={slot ? '' : (stored ?? '')}
          placeholder={slot ?? ''}
          onBlur={(e) => {
            // A click on a token chip fires blur first; the chip's mousedown
            // has already committed, so an empty blur must not clear it.
            const v = e.target.value.trim()
            setEditing(false)
            if (v || !slot) onType(id, v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full h-5 min-w-0 px-1 text-center text-[10px] rounded-sm bg-surface border border-accent text-fg focus:outline-none"
        />
        {spaceTokens && spaceTokens.length > 0 && (
          /* Variables, one click each. Writes the var() the stylesheet
             understands, so the side follows the token from then on. */
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 flex flex-wrap gap-0.5 p-1 rounded-md border border-border bg-surface shadow-lg max-w-40">
            {spaceTokens.map((t) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setEditing(false); onType(id, tokenValue('space', t)) }}
                className={clsx(
                  'px-1.5 h-5 rounded text-[10px] font-medium transition-colors duration-(--tg-motion-fast)',
                  t === slot ? 'bg-accent text-fg-inverted' : 'bg-surface-sunken text-fg-muted hover:text-fg',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const draggable = !disabled && !slot
  const title = slot
    ? `${property} ${side} uses the "${slot}" token - double-click to type an exact value`
    : `${property} ${side}${stored ? `: ${stored}` : ''} - drag to change, Shift x10, Alt both sides, Cmd all four`

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onPointerDown={(e) => {
        if (!draggable) return
        e.currentTarget.setPointerCapture(e.pointerId)
        onDragStart(property, side, e.clientY, stored)
      }}
      onPointerMove={(e) => {
        if (!drag) return
        onDragMove(e.clientY, { shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey })
      }}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      onDoubleClick={() => setEditing(true)}
      className={clsx(
        'w-full h-5 px-1 text-[10px] leading-none rounded-sm select-none touch-none',
        'transition-colors duration-(--tg-motion-fast)',
        draggable ? 'cursor-ns-resize' : 'cursor-default',
        isSet?.(id) ? 'text-fg font-medium' : 'text-fg-subtle',
        slot && 'text-accent-fg',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-raised hover:text-fg',
      )}
    >
      {sideLabel(value)}
    </button>
  )
}

/**
 * Margin as the outer ring, padding as the inner one - the arrangement every
 * browser devtool and design tool uses, so it needs no explaining.
 */
export function BoxModelControl({ read, onCommit, isSet, spaceTokens, disabled }: BoxModelControlProps) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef<Drag | null>(null)

  const onDragStart = useCallback((property: BoxProperty, side: BoxSide, y: number, from: string | undefined) => {
    const d: Drag = { property, side, y, from, preview: {} }
    latest.current = d
    setDrag(d)
  }, [])

  const onDragMove = useCallback((y: number, mod: { shift: boolean; alt: boolean; meta: boolean }) => {
    const d = latest.current
    if (!d) return
    // Screen y grows downwards; dragging UP must increase the value.
    const next = applyDrag(d.from, d.y - y, { ...mod, allowNegative: d.property === 'margin' })
    const preview: Record<string, string> = {}
    for (const s of sidesToWrite(d.side, mod)) preview[boxPropertyId(d.property, s)] = next
    const updated = { ...d, preview }
    latest.current = updated
    setDrag(updated)
  }, [])

  const onDragEnd = useCallback(() => {
    const d = latest.current
    latest.current = null
    setDrag(null)
    // ONE commit for the whole drag, every side together.
    if (d && Object.keys(d.preview).length > 0) onCommit(d.preview)
  }, [onCommit])

  const onType = useCallback((id: string, value: string) => onCommit({ [id]: value }), [onCommit])

  const cell = (property: BoxProperty, side: BoxSide) => (
    <SideCell
      property={property} side={side} read={read} isSet={isSet} disabled={disabled} spaceTokens={spaceTokens}
      drag={drag} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onType={onType}
    />
  )

  return (
    <div className="px-1 py-1">
      <div className="rounded-md border border-border bg-surface-sunken p-1">
        <div className="flex items-center justify-between px-1 pb-0.5">
          <span className="text-[9px] uppercase tracking-wide text-fg-subtle">Margin</span>
        </div>
        <div className="grid grid-cols-[2.25rem_1fr_2.25rem] gap-0.5 items-center">
          <div />{cell('margin', 'top')}<div />
          {cell('margin', 'left')}
          <div className="rounded border border-border bg-surface p-1">
            <div className="flex items-center justify-between px-0.5 pb-0.5">
              <span className="text-[9px] uppercase tracking-wide text-fg-subtle">Padding</span>
            </div>
            <div className="grid grid-cols-[2rem_1fr_2rem] gap-0.5 items-center">
              <div />{cell('padding', 'top')}<div />
              {cell('padding', 'left')}
              <div className="h-6 rounded-sm bg-surface-sunken" />
              {cell('padding', 'right')}
              <div />{cell('padding', 'bottom')}<div />
            </div>
          </div>
          {cell('margin', 'right')}
          <div />{cell('margin', 'bottom')}<div />
        </div>
      </div>
      <p className="px-1 pt-1 text-[9px] leading-tight text-fg-subtle">
        Drag a side. Shift for 10, Alt for both sides, Cmd for all four. Double-click to type or pick a variable.
      </p>
    </div>
  )
}
