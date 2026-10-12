/**
 * File Name: scrub.ts
 * Purpose: Drag-to-change on a number row - the gesture every design tool
 *          has and no admin form does.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The value is always computed from the drag's ORIGIN
 *          plus its total travel, never accumulated per pointer event.
 *          Accumulating drifts, so dragging out and back would not return to
 *          where it started - which is exactly the thing that makes a scrub
 *          feel broken.
 */

/** Pointer travel that moves the value by one step. */
export const SCRUB_PX_PER_STEP = 4

interface ScrubInput {
  /** The value when the drag began; null when the field was empty. */
  start: number | null
  /** Total horizontal travel since the drag began. */
  dx: number
  step?: number
  min?: number
  max?: number
}

/** Decimal places implied by a step, so 0.1 + 0.2 never shows its seams. */
function precisionOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

function clamp(value: number, min?: number, max?: number): number {
  if (typeof min === 'number' && value < min) return min
  if (typeof max === 'number' && value > max) return max
  return value
}

/** The value a drag of `dx` pixels from `start` produces. */
export function scrubValue({ start, dx, step = 1, min, max }: ScrubInput): number {
  const from = typeof start === 'number' && Number.isFinite(start) ? start : 0
  const steps = Math.trunc(dx / SCRUB_PX_PER_STEP)
  const raw = from + steps * step
  return clamp(Number(raw.toFixed(precisionOf(step))), min, max)
}

interface StepOptions { step?: number; min?: number; max?: number }

/** One nudge up or down, from a stepper button or an arrow key. */
export function stepValue(
  current: number | null,
  direction: 1 | -1,
  { step = 1, min, max }: StepOptions = {},
): number {
  const from = typeof current === 'number' && Number.isFinite(current) ? current : 0
  const raw = from + direction * step
  return clamp(Number(raw.toFixed(precisionOf(step))), min, max)
}
