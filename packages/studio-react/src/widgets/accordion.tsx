/**
 * File Name: accordion.tsx
 * Purpose: kit.accordion - disclosure items via native <details>/<summary>.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: DELIBERATELY NOT a client island. The contract lists
 *          accordion among the islands, but native disclosure gives the
 *          whole behaviour with ZERO client JS, which the phase 2 perf
 *          budget ("islands only where needed") values more than an
 *          animation. If animated open/close is ever required, this file
 *          becomes the 'use client' leaf; nothing else changes. Bodies are
 *          richtext, rendered through the safe renderer.
 */
import type { BlockNode } from '../types'
import { RichText } from '../richtext'
import { items, str } from '../util'
import { withPartClasses } from '../parts'

type AccordionItem = { title?: unknown; body?: unknown }

export function renderAccordion(block: BlockNode) {
  const list = items<AccordionItem>(block.items)
  if (list.length === 0) return null
  // The three Style Parts the kit declares: the item, its title row, and
  // its body - each on the element a designer would point at.
  const itemClass = withPartClasses('tg-accordion__item', block, 'item')
  const titleClass = withPartClasses('tg-accordion__title', block, 'title')
  const bodyClass = withPartClasses('tg-accordion__body', block, 'body')
  return (
    <div className="tg-accordion">
      {list.map((item, i) => (
        <details key={i} className={itemClass}>
          <summary className={titleClass}>{str(item.title)}</summary>
          <div className={bodyClass}>
            <RichText value={item.body} />
          </div>
        </details>
      ))}
    </div>
  )
}
