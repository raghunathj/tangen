/**
 * File Name: link.tsx
 * Purpose: kit.link - one anchor: text, a scheme-checked destination, and
 *          whether it opens a new tab.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The anchor IS the text element
 *          (it wears the derived `--text` class), so a class's typography
 *          lands on it directly. The href goes through `safeHref`, like
 *          every href the kit writes: an unsafe scheme drops the navigation
 *          and keeps the words, rendered as an anchor without href so the
 *          block still occupies its place on the canvas. A new-tab link
 *          always carries rel="noopener noreferrer".
 */
import { textClassNames } from '../render'
import type { BlockNode } from '../types'
import { oneOf, safeHref, str } from '../util'

export function renderLink(block: BlockNode) {
  const href = safeHref(block.href)
  const target = oneOf(block.target, ['_self', '_blank'] as const, '_self')
  const blank = target === '_blank' && !!href
  return (
    <a
      className={['tg-link', ...textClassNames(block)].join(' ')}
      {...(href ? { href } : {})}
      {...(blank ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {str(block.text)}
    </a>
  )
}
