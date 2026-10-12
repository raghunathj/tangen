/**
 * File Name: tag-defaults.ts
 * Purpose: The element types Studio offers a site-wide default for.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This is the level that answers "headings and paragraphs
 *          use different fonts" without a designer setting the heading font
 *          on forty separate elements - and without a class on each.
 *
 *          The list is exactly what the KIT renders. Offering a default for
 *          a tag nothing emits is a control that can never do anything, which
 *          is the same rule that filtered the state switcher.
 *
 *          In the CONTRACT package because the tag ends up inside a CSS
 *          SELECTOR: the extension's route validates a designer's PATCH
 *          against this list, and Porter validates an incoming `tag:` row
 *          against the same list before copying it into another environment.
 *          `extensions/studio/src/lib/tag-defaults.ts` re-exports it.
 */

/** Store keys for tag defaults, namespaced away from `class:`. */
export const TAG_PREFIX = 'tag:'

export interface StudioTag {
  tag: string
  label: string
}

/**
 * Tags the Builder Kit actually emits: kit.heading renders h1-h4 from its
 * level prop, RichText renders paragraphs and list items, kit.buttons renders
 * anchors.
 */
export const STUDIO_TAGS: readonly StudioTag[] = [
  { tag: 'h1', label: 'Heading 1' },
  { tag: 'h2', label: 'Heading 2' },
  { tag: 'h3', label: 'Heading 3' },
  { tag: 'h4', label: 'Heading 4' },
  { tag: 'p', label: 'Paragraph' },
  { tag: 'li', label: 'List item' },
  { tag: 'a', label: 'Link' },
] as const

const BY_TAG = new Map(STUDIO_TAGS.map((t) => [t.tag, t]))

/** One offered tag, or null - never a caller-supplied selector fragment. */
export function tagByName(tag: string): StudioTag | null {
  return BY_TAG.get(String(tag ?? '')) ?? null
}
