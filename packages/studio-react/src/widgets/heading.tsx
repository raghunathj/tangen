/**
 * File Name: heading.tsx
 * Purpose: kit.heading - one heading element (h1-h4), sized from the type
 *          token ramp, aligned left/center/right.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The semantic level and the
 *          visual size are independent on purpose: a marketer can keep the
 *          page's single h1 while matching a smaller visual scale.
 */
import { textClassNames } from '../render'
import type { BlockNode } from '../types'
import { oneOf, slot, str } from '../util'

export function renderHeading(block: BlockNode) {
  const H = oneOf(block.level, ['h1', 'h2', 'h3', 'h4'] as const, 'h2')
  const size = slot(block.size, '2xl')
  const align = oneOf(block.align, ['left', 'center', 'right'] as const, 'left')
  return (
    <H
      className={[`tg-heading tg-text-${size} tg-align-${align}`, ...textClassNames(block)].join(' ')}
    >
      {str(block.text)}
    </H>
  )
}
