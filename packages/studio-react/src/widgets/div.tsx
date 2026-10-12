/**
 * File Name: div.tsx
 * Purpose: kit.div - the bare box: a content element holding child blocks
 *          and nothing of its own.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. Everything about a kit.div
 *          comes from the class it wears, so the box is the content element
 *          (it wears the derived `--content` and `--text` classes) and the
 *          kit CSS gives it no width, padding or gap to fight. A designer's
 *          `display:flex` on the class is the whole layout.
 */
import { contentClassNames, textClassNames } from '../render'
import type { BlockNode, RenderContext } from '../types'

export function renderDiv(block: BlockNode, ctx: RenderContext) {
  return (
    <div className={['tg-div', ...contentClassNames(block), ...textClassNames(block)].join(' ')}>
      {ctx.renderList(block.children)}
    </div>
  )
}
