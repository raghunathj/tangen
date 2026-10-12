/**
 * File Name: list.tsx
 * Purpose: kit.list - a bulleted (<ul>) or numbered (<ol>) list of short
 *          text items.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The list is Guided and exposes
 *          `item`, so each <li> wears `partClassNames(block, 'item')` - the
 *          scoped class the compiler emits for a class aimed at the item -
 *          and nothing else does (see parts.ts). Typography on the root
 *          class reaches the items by inheritance from the wrapper, which
 *          wears the derived text class for a block with no text element of
 *          its own. An empty list renders nothing, like the icon list.
 */
import { withPartClasses } from '../parts'
import type { BlockNode } from '../types'
import { items, oneOf, str } from '../util'

type ListItem = { text?: unknown }

export function renderList(block: BlockNode) {
  const list = items<ListItem>(block.items)
  if (list.length === 0) return null
  const ordered = oneOf(block.style, ['unordered', 'ordered'] as const, 'unordered') === 'ordered'
  const Tag = ordered ? 'ol' : 'ul'
  const itemClass = withPartClasses('tg-list__item', block, 'item')
  return (
    <Tag className={`tg-list tg-list--${ordered ? 'ordered' : 'unordered'}`}>
      {list.map((item, i) => (
        <li key={i} className={itemClass}>{str(item.text)}</li>
      ))}
    </Tag>
  )
}
