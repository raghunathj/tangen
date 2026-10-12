/**
 * File Name: buttons.tsx
 * Purpose: kit.buttons - a group of link buttons with variant (primary /
 *          secondary / ghost), size (sm / md / lg) and group alignment.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe: buttons are plain anchors, no
 *          handlers. Hrefs are scheme-checked; an item with an unsafe or
 *          missing href renders as an inert button-shaped span so the label
 *          survives.
 */
import type { BlockNode } from '../types'
import { items, oneOf, safeHref, str } from '../util'
import { withPartClasses } from '../parts'

type ButtonItem = { label?: unknown; href?: unknown; variant?: unknown; size?: unknown }

export function renderButtons(block: BlockNode) {
  const list = items<ButtonItem>(block.items)
  if (list.length === 0) return null
  const align = oneOf(block.align, ['left', 'center', 'right'] as const, 'left')
  return (
    <div className={`tg-buttons tg-align-${align}`}>
      {list.map((item, i) => {
        const variant = oneOf(item.variant, ['primary', 'secondary', 'ghost'] as const, 'primary')
        const size = oneOf(item.size, ['sm', 'md', 'lg'] as const, 'md')
        const href = safeHref(item.href)
        // The `button` Style Part is every button, whichever element it
        // renders as - one part, so a brand colour is one rule.
        const className = withPartClasses(`tg-btn tg-btn--${variant} tg-btn--${size}`, block, 'button')
        const label = str(item.label)
        return href ? (
          <a key={i} className={className} href={href}>
            {label}
          </a>
        ) : (
          <span key={i} className={className}>
            {label}
          </span>
        )
      })}
    </div>
  )
}
