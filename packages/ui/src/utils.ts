/**
 * File Name: utils.ts
 * Purpose: Tailwind utility helpers for the @tangen/ui package — cx (clsx + tailwind-merge),
 *   and reusable focus-ring and error-input Tailwind class arrays.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Requires clsx and tailwind-merge.
 */

export { cx, tv, twMergeConfig } from './tw'

/**
 * Focus treatment for text inputs and other typed controls (UI V2 spec §10):
 * the border takes the focus colour and a soft 3px ring in the focus token
 * surrounds it. `focus-visible` only - a mouse click shows no ring.
 */
export const focusInput = [
  'focus-visible:border-focus-border',
  'focus-visible:ring-[3px]',
  'focus-visible:ring-focus/25',
]

/**
 * Keyboard focus ring for buttons, links and every other interactive
 * element (spec §11): 2px in the focus token, 1px outside the element,
 * only when focus is visible.
 */
export const focusRing = [
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-1',
  'focus-visible:outline-focus',
]

/**
 * The invalid state of a typed control: the danger colour on the border and
 * a soft ring, driven by the `hasError` variant or `aria-invalid`.
 */
export const hasErrorInput = [
  'border-danger',
  'ring-[3px]',
  'ring-danger/20',
]
