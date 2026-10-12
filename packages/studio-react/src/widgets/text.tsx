/**
 * File Name: text.tsx
 * Purpose: kit.text - a richtext body sized from the type token ramp and
 *          aligned left/center/right.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The body renders through the
 *          package's safe richtext renderer - never raw HTML.
 */
import { textClassNames } from '../render'
import type { BlockNode } from '../types'
import { RichText } from '../richtext'
import { oneOf, slot } from '../util'

export function renderText(block: BlockNode) {
  const size = slot(block.size, 'base')
  const align = oneOf(block.align, ['left', 'center', 'right'] as const, 'left')
  return (
    <div
      className={[`tg-text tg-text-${size} tg-align-${align}`, ...textClassNames(block)].join(' ')}
    >
      <RichText value={block.body} />
    </div>
  )
}
