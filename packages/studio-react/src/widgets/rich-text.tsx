/**
 * File Name: rich-text.tsx
 * Purpose: kit.richText - a long-form body rendered from the platform's
 *          richtext value (the TipTap document the admin editor stores),
 *          with its headings, paragraphs, links and list items reachable as
 *          Style Parts.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Server-component-safe. The body goes through the
 *          package's safe RichText renderer - never raw HTML - the same one
 *          kit.text and the accordion use; this widget is the one that hands
 *          it part classes. The block is Guided: `display` on the root
 *          would unmake the flow of a body, so the root refuses it, and the
 *          four element kinds a document renders are the parts a designer
 *          reaches (parts.ts explains the scoped classes). Root typography
 *          reaches everything inside by inheritance from the wrapper.
 */
import { partClassNames } from '../parts'
import type { BlockNode } from '../types'
import { RichText } from '../richtext'

export function renderRichText(block: BlockNode) {
  const part = (name: string) => partClassNames(block, name).join(' ')
  return (
    <div className="tg-richtext">
      <RichText
        value={block.body}
        partClasses={{ heading: part('heading'), paragraph: part('paragraph'), link: part('link'), item: part('item') }}
      />
    </div>
  )
}
