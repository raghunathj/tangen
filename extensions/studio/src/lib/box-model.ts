/**
 * File Name: box-model.ts
 * Purpose: The box-model control's behaviour - dragging a side to change
 *          spacing, which is the interaction that makes a style panel feel
 *          like a design tool rather than a form.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Typing "24px" into four inputs is what a form feels
 *          like. Dragging a side is the single interaction people name when
 *          they say a builder feels like Webflow, so the modifiers are
 *          Webflow's on purpose - muscle memory is most of the value:
 *          Shift for coarse steps, Alt for the opposite side too, Cmd for all
 *          four.
 *
 *          Nothing here mangles a value it cannot parse. `calc(100% - 2rem)`
 *          and `auto` survive a stray drag untouched, because silently
 *          rewriting them would lose work that cannot be typed back easily.
 */
import { parseLength } from './css-value'
import { parseTokenRef, legacyVarToRef, formatTokenRef } from '@tangen/studio-schema'

/** The four sides, in CSS order. */
export const BOX_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type BoxSide = (typeof BOX_SIDES)[number]

/** The two box properties this control edits. */
export type BoxProperty = 'padding' | 'margin'

/** The registry property id for one side. */
export function boxPropertyId(property: BoxProperty, side: BoxSide): string {
  return `${property}-${side}`
}

const OPPOSITE: Record<BoxSide, BoxSide> = {
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
}

export interface DragModifiers {
  shift?: boolean
  alt?: boolean
  meta?: boolean
  /** Margins may go negative; padding may not. */
  allowNegative?: boolean
}

/** Which sides one drag writes, given the modifiers held. */
export function sidesToWrite(side: BoxSide, mod: DragModifiers): BoxSide[] {
  // Cmd wins outright rather than combining with Alt - "all four" already
  // includes the opposite side, so layering them would only be confusing.
  if (mod.meta) return [...BOX_SIDES]
  if (mod.alt) return [side, OPPOSITE[side]]
  return [side]
}

/**
 * How much one pixel of drag is worth, in the value's own unit.
 *
 * A pixel per pixel tracks the cursor exactly, which is what makes the drag
 * feel direct. Relative units need a far finer step - 1rem per pixel would
 * cross a whole page in twenty pixels of movement.
 */
export function dragStep(unit: string, shift: boolean): number {
  const coarse = shift ? 10 : 1
  switch (unit) {
    case 'rem':
    case 'em':
      return 0.125 * coarse
    case '%':
    case 'vh':
    case 'vw':
      return 0.5 * coarse
    default:
      return 1 * coarse
  }
}

/**
 * Rounds to what a designer would actually type.
 *
 * Pixels are whole numbers, always - a drag that lands on 23.4px reads as a
 * glitch, and nobody means it. Relative units keep two decimals, because a
 * rem steps by an eighth and 1.125rem is a real value.
 */
function tidy(n: number, unit: string): number {
  if (unit === 'px' || unit === '') return Math.round(n)
  return Math.round(n * 100) / 100
}

/**
 * The value after dragging by `deltaPx`.
 *
 * Positive delta increases: the caller passes screen-inverted movement, so
 * dragging UP grows the value the way every design tool behaves.
 */
export function applyDrag(current: string | undefined | null, deltaPx: number, mod: DragModifiers): string {
  const text = String(current ?? '').trim()
  const parsed = parseLength(text)

  // A keyword or an expression is left exactly as it was: rewriting
  // `calc(100% - 2rem)` into a number would destroy something the drag
  // cannot express.
  if (parsed.value === undefined && text !== '') return text

  const unit = parsed.unit ?? 'px'
  const from = parsed.value ?? 0
  const next = from + deltaPx * dragStep(unit, !!mod.shift)
  const clamped = mod.allowNegative ? next : Math.max(0, next)
  return `${tidy(clamped, unit)}${unit}`
}

/**
 * The design-token slot a value refers to, or null for a plain length.
 *
 * Reads the canonical `{family.slot}` reference, and still reads the legacy
 * `var(--tg-...)` form the first migration wrote, so a class saved before
 * references existed shows its slot rather than a var string.
 */
export function tokenSlot(value: string | undefined | null): string | null {
  const ref = parseTokenRef(value) ?? legacyVarToRef(value)
  return ref ? ref.slot : null
}

/**
 * What a side shows in the diagram.
 *
 * A token value shows its SLOT ("lg"), not the var() string: the diagram is
 * tight, and `var(--tg-space-lg)` told the designer nothing they could act
 * on. Empty shows "-" rather than "0", which would be a lie about what the
 * class holds.
 */
export function sideLabel(value: string | undefined | null): string {
  const t = String(value ?? '').trim()
  if (!t) return '-'
  const slot = tokenSlot(t)
  if (slot) return slot
  return t.replace(/px$/, '')
}

/** The stored value for a token slot: the REFERENCE, never the var string. */
export function tokenValue(family: 'space' | 'radius' | 'width' | 'type', slot: string): string {
  return formatTokenRef(family, slot)
}
