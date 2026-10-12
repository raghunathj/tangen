/**
 * File Name: container.tsx
 * Purpose: kit.container - a centred, width-constrained box on the width
 *          token scale, holding child blocks.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The box IS the content element:
 *          it wears the derived `--content` and `--text` classes, so a
 *          class's container-layout rules reach the children and its
 *          typography is inherited by them, exactly as on a section's inner
 *          element. The width rides the token family as class + inline
 *          var(), so a site-extended slot works by defining the variable.
 *          The wrapper keeps the Studio box chrome (background, padding): a
 *          container is not self-styled the way a section is.
 */
import { contentClassNames, textClassNames } from '../render'
import type { BlockNode, RenderContext } from '../types'
import { slot } from '../util'

export function renderContainer(block: BlockNode, ctx: RenderContext) {
  const width = slot(block.width, 'normal')
  return (
    <div
      className={[`tg-container tg-width-${width}`, ...contentClassNames(block), ...textClassNames(block)].join(' ')}
      style={{ maxWidth: `var(--tg-width-${width})` }}
    >
      {ctx.renderList(block.children)}
    </div>
  )
}
