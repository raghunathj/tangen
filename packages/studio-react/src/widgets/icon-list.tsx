/**
 * File Name: icon-list.tsx
 * Purpose: kit.iconList - a 1/2/3-column grid of icon + title + body items,
 *          icons from the contract's closed set.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. An unknown icon slug renders
 *          no icon (never a broken image); the item text still shows.
 */
import type { BlockNode } from '../types'
import { KIT_ICONS } from '../icons'
import { items, oneOf, str } from '../util'

type IconItem = { icon?: unknown; title?: unknown; body?: unknown }

export function renderIconList(block: BlockNode) {
  const list = items<IconItem>(block.items)
  if (list.length === 0) return null
  const columns = oneOf(block.columns, ['1', '2', '3'] as const, '1')
  return (
    <ul className={`tg-icon-list tg-cols-${columns}`}>
      {list.map((item, i) => {
        const icon = str(item.icon)
        const Icon = icon ? KIT_ICONS[icon] : undefined
        return (
          <li key={i} className="tg-icon-list__item">
            {Icon && <span className="tg-icon-list__icon">{Icon({ className: 'tg-icon' })}</span>}
            <div className="tg-icon-list__content">
              {str(item.title) !== '' && <p className="tg-icon-list__title">{str(item.title)}</p>}
              {str(item.body) !== '' && <p className="tg-icon-list__body">{str(item.body)}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
