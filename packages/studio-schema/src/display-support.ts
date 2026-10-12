/**
 * File Name: display-support.ts
 * Purpose: Which `display` values a Block can honour - so the Style panel
 *          offers combinations with a predictable outcome rather than CSS
 *          that is accepted and cannot behave.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Every Builder Kit block renders a wrapper around a
 *          block-level element (a heading, a paragraph, a section with its
 *          content element). `display:inline` on that wrapper is valid CSS and
 *          computes as inline in every engine, and still does nothing a
 *          designer wants: a block-level child breaks an inline box into
 *          anonymous fragments, so two "inline" headings never share a line.
 *          The three-engine matrix showed this identically in Chromium,
 *          WebKit and Firefox. It is the structure, not a bug to fix.
 *
 *          `inline-block` and `inline-flex` DO work on that structure - the
 *          wrapper becomes an atomic inline box and its child lays out inside
 *          it - so they stay offered. A site's own component may render a
 *          span or a link, and for those inline is meaningful, so the rule is
 *          scoped to the kit rather than to every block.
 *
 *          The compiler still honours a stored `inline`: a class is workspace
 *          wide and may also sit on a block that can be inline. The panel is
 *          where the offer is made, and this module is what it asks.
 *
 *          kit.link is the exception inside the kit (WF-T12): its wrapper
 *          holds an ANCHOR, an inline element, so `display:inline` on the
 *          wrapper makes an inline box with inline content and two links do
 *          share a line. The rule is about structure, and the structure is
 *          different there, so it is listed rather than special-cased by
 *          name in the panel.
 */

/** Block types whose structure is known: a wrapper around a block element. */
const KIT_PREFIX = 'kit.'

/** Kit blocks whose wrapper holds an inline element, so inline is meaningful. */
const INLINE_CAPABLE_KIT = new Set(['kit.link'])

/** Display values a kit block cannot turn into anything useful. */
const UNFIT_FOR_KIT = new Set(['inline'])

/**
 * Why this display value is not offered on this block, or undefined when it
 * is. Worded for the panel: it explains, rather than merely dims.
 */
export function displayUnsupportedReason(blockType: string | undefined, value: string | undefined): string | undefined {
  if (!blockType || !value) return undefined
  if (!blockType.startsWith(KIT_PREFIX)) return undefined
  if (INLINE_CAPABLE_KIT.has(blockType)) return undefined
  if (!UNFIT_FOR_KIT.has(value.trim())) return undefined
  return 'inline is not offered on this Block: it wraps a block-level element, so inline cannot put two of them on one line. Use inline-block or inline-flex.'
}

/** The registry's display options, minus those this block cannot honour. */
export function displayOptionsFor(blockType: string | undefined, options: readonly string[]): string[] {
  return options.filter((o) => displayUnsupportedReason(blockType, o) === undefined)
}
