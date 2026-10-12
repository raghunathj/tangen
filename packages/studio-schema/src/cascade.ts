/**
 * File Name: cascade.ts
 * Purpose: Which class wins - the one rule the emitter, the Style panel and
 *          provenance all read.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: A Studio stylesheet is GLOBAL and each class appears in
 *          it exactly once. There is therefore no such thing as the order a
 *          class was "applied" to an element: two elements can wear `.card`
 *          and `.featured` in opposite orders and read the same stylesheet.
 *          Webflow can honour application order only because it emits
 *          compound selectors (`.card.featured`), which multiply
 *          combinatorially and which Studio's protection model does not
 *          write.
 *
 *          So the cascade is decided by EMISSION ORDER, and emission order is
 *          the class name. The panel used to edit the last-applied class
 *          while the stylesheet let the alphabetically-last one win: with
 *          `['featured', 'card']` a designer edited `.card` and `.featured`
 *          overrode it, which reads as a control that does nothing. Both
 *          sides now read this module.
 *
 *          The comparison is by CODE POINT, not `localeCompare`. Locale
 *          collation depends on the ICU data the runtime happens to ship, so
 *          the same classes could order differently on two machines - and the
 *          served ETag is a hash of the emitted string, so a shifting order
 *          would churn every cached stylesheet.
 */

/** Codepoint order. Deterministic everywhere, unlike locale collation. */
export function compareClassNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The applied class names in the order the stylesheet emits them, so the LAST
 * entry is the one whose declarations win.
 *
 * The input is copied: callers hold the element's own list and must not have
 * it reordered underneath them.
 */
export function cascadeOrder(names: readonly string[]): string[] {
  return [...names].sort(compareClassNames)
}

/** The class whose value an element actually shows, or null when it wears none. */
export function winningClass(names: readonly string[]): string | null {
  const ordered = cascadeOrder(names)
  return ordered.length > 0 ? ordered[ordered.length - 1] : null
}
