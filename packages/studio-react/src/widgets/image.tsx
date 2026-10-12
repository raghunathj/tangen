/**
 * File Name: image.tsx
 * Purpose: kit.image - one image, width-bounded by the width token family,
 *          corners from the radius family. Accepts a resolved media object
 *          ({ url }) or a plain URL string.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. Renders nothing without a
 *          resolvable URL (a half-configured block should lose its image,
 *          not show a broken glyph). loading="lazy" keeps the perf budget
 *          honest without any client JS.
 */
import type { BlockNode } from '../types'
import { mediaUrl, slot, str } from '../util'
import { withPartClasses } from '../parts'

export function renderImage(block: BlockNode) {
  const url = mediaUrl(block.image)
  if (!url) return null
  const width = slot(block.width, 'normal')
  const rounded = slot(block.rounded, 'none')
  return (
    <figure className={`tg-image tg-width-${width}`} style={{ maxWidth: `var(--tg-width-${width})` }}>
      <img
        src={url}
        alt={str(block.alt)}
        loading="lazy"
        // The `image` Style Part: the picture itself, not the figure.
        className={withPartClasses(`tg-image__img tg-radius-${rounded}`, block, 'image')}
        style={{ borderRadius: `var(--tg-radius-${rounded})` }}
      />
    </figure>
  )
}
