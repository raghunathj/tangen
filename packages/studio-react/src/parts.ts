/**
 * File Name: parts.ts
 * Purpose: The classes a block wears, and the scoped class each of its
 *          declared Style Parts wears because of them.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The compiler emits a class aimed at a Style Part under
 *          `internalPartClass(blockType, part, className)` - a single scoped
 *          class that names nothing a workspace selector could guess. That
 *          rule styles nothing until an element wears the class, and the
 *          only code that can put it on the right element is the widget
 *          rendering the part, because the part is an internal the widget
 *          owns. So each kit widget stamps `partClassNames(block, part)` on
 *          the element its declaration names, and nowhere else.
 *
 *          The runtime does not consult the declaration. A widget knows its
 *          own parts statically (an image has an `image`, a loop has an
 *          `item`), and stamping a class nothing targets is inert: the
 *          compiler only emits a part rule the Block's declaration exposes,
 *          so a part the site's def never declared gets a class with no
 *          rule behind it. The boundary stays with the compiler, which is
 *          where a boundary has to be.
 *
 *          Keyed by the WORN class, one per class: `.card` aimed at the
 *          button reaches the buttons of blocks wearing `.card` and no
 *          others. Names are validated here as they are on the wrapper -
 *          a block arrives as data, and data is not trusted.
 */
import { internalPartClass } from '@tangen/studio-schema'
import type { BlockNode } from './types'

/** A class name safe to put on an element - the same rule the class store applies. */
export const SAFE_CLASS = /^[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * The Studio classes a block wears, validated. Chrome lives under the
 * reserved `_studio` key; the flat fallback keeps content written before
 * that move rendering, with no migration.
 */
export function wornClasses(block: BlockNode): string[] {
  const bag = block._studio
  const fromBag = bag && typeof bag === 'object' && !Array.isArray(bag)
    ? (bag as Record<string, unknown>).classes
    : undefined
  const named = fromBag !== undefined ? fromBag : block.classes
  if (!Array.isArray(named)) return []
  return named.filter((n): n is string => typeof n === 'string' && SAFE_CLASS.test(n))
}

/**
 * The scoped classes one Style Part of this block wears - one per class the
 * block wears, so a block wearing nothing gets nothing.
 */
export function partClassNames(block: BlockNode, part: string): string[] {
  return wornClasses(block).map((cls) => internalPartClass(block._type, part, cls))
}

/** Joins a widget's own classes with a part's, skipping blanks. */
export function withPartClasses(own: string, block: BlockNode, part: string): string {
  const parts = partClassNames(block, part)
  return parts.length === 0 ? own : `${own} ${parts.join(' ')}`
}
