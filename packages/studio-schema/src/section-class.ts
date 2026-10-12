/**
 * File Name: section-class.ts
 * Purpose: The generated class one block's own raw CSS is scoped by -
 *          `tg-s-<key>` - shared by the compiler that emits the rule and the
 *          runtime that stamps the wrapper.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Per-section CSS is the escape hatch for the tweak a
 *          campaign needs without a developer ticket. What makes it safe to
 *          offer is SCOPING: the designer writes declarations, never a
 *          selector, and the compiler wraps them in one single-class rule
 *          unique to the block. So the no-combinator invariant holds (a rule
 *          cannot reach inside a Block it does not name), and one bad
 *          declaration breaks one section, not the site.
 *
 *          The class is derived from the block KEY, which the platform mints
 *          and keeps stable across edits, so a section keeps its styling
 *          when it moves. The key arrives as data and data is not trusted:
 *          a key that could not be a class name yields null on both sides -
 *          the compiler refuses the CSS with a reason, the runtime stamps
 *          nothing - rather than one side inventing a name the other never
 *          emits.
 */

export const SECTION_CLASS_PREFIX = 'tg-s-'

/** A block key that can sit inside a class name. Minted keys are base-36. */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/

/** `k8f2a1` -> `tg-s-k8f2a1`; null when the key cannot be a class name. */
export function sectionClassName(key: unknown): string | null {
  if (typeof key !== 'string' || !SAFE_KEY.test(key)) return null
  return `${SECTION_CLASS_PREFIX}${key}`
}
