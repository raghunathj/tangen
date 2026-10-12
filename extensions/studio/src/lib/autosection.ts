/**
 * File Name: autosection.ts
 * Purpose: Every component lands in a section. A bare widget at the top of a
 *          page has no background, padding or width of its own, so Studio
 *          wraps what you insert in a `kit.section` that does.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is the structure Elementor and Shopify both
 *          assume, created FOR the marketer rather than demanded of them -
 *          and the section it makes is a real, visible block in the tree,
 *          not hidden magic, so it can be selected, restyled or deleted
 *          like any other.
 *
 *          Two refusals matter more than the wrapping. It never wraps when
 *          the blocks field does not allow `kit.section` - writing a block
 *          the schema forbids would be worse than leaving the widget bare -
 *          and it never double-wraps a section.
 */

/** Structural defaults, so a freshly wrapped section looks right at once. */
export const SECTION_DEFAULTS = { padding: 'lg', width: 'normal' } as const

type Block = Record<string, unknown>

export interface WrapOptions {
  /** Component names the blocks field allows at this position. */
  allowed: string[]
  mintKey: () => string
  /** Opt out of wrapping for this insert. Defaults to true (wrap). */
  wrap?: boolean
}

/**
 * The block to actually insert. Returns the input UNCHANGED (same reference)
 * whenever wrapping would be wrong, so callers can treat "not wrapped" as
 * the identity case.
 */
export function wrapForInsert(block: Block, opts: WrapOptions): Block {
  if (opts.wrap === false) return block
  if (!block || typeof block !== 'object' || typeof block._type !== 'string') return block
  if (block._type === 'kit.section') return block
  // The field decides what may live here; a section it does not allow is not
  // ours to create.
  if (!opts.allowed.includes('kit.section')) return block

  return {
    _key: opts.mintKey(),
    _type: 'kit.section',
    ...SECTION_DEFAULTS,
    children: [block],
  }
}
