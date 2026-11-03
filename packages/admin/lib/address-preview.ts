/**
 * File Name: address-preview.ts
 * Purpose: The rule the editor's URL preview follows - slice 7 of
 *          tasks/plan-content-paths.md. The slug row has always read
 *          `/<slug>`, which for a type that declares a path pattern is wrong:
 *          a page whose parents are About > Company lives at /about/company,
 *          not at /company.
 *
 *          The server answers two things on a read that asks for them: the
 *          address (`_path`) and its SHAPE (`_pathTemplate`), which is the
 *          same address with `:slug` left where the slug goes. The shape is
 *          what lets this row recompose the address on every keystroke
 *          without a round trip, and why the editor asks for it at all.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure, and deliberately does no composing of its own.
 *          Only the server can know an ancestor's slug, so everything here
 *          is one substitution into what the server already said. A template
 *          with no hole in it (the declared root page, or a `{ field }` or
 *          function declaration) is one complete address, left alone.
 */
import { slugify } from './editor'

/** The hole the server leaves where the slug goes. */
const HOLE = ':slug'

/**
 * The address a template describes, with whatever the slug box is holding.
 * `null` means this type declares no path, which is the editor's signal to
 * draw the plain slug row rather than an address with nothing in it.
 */
export function addressFor(template: string | null | undefined, slug: string): string | null {
  if (!template) return null
  const typed = slugify(slug ?? '')
  // One rule, segment by segment: the hole becomes what the box holds, and
  // an empty box DROPS the segment rather than emitting a double slash - the
  // address of a page being created is its parents until it has a slug. A
  // template with no hole in it (the root page, or a `{ field }` or function
  // declaration) has nothing to substitute and comes back as it went in.
  const segments = template.split('/').filter((part, i) => !(i === 0 && part === ''))
    .flatMap((part) => (part === HOLE ? (typed ? [typed] : []) : [part]))
  return `/${segments.join('/')}`
}

/**
 * Where the slug box sits inside the address: the text either side of it.
 * `null` when there is no hole to draw a box in, which keeps the plain slug
 * row for the root page and for the two non-pattern declarations.
 */
export function addressFrame(
  template: string | null | undefined,
): { prefix: string; suffix: string } | null {
  if (!template) return null
  const at = template.indexOf(HOLE)
  if (at < 0) return null
  return { prefix: template.slice(0, at), suffix: template.slice(at + HOLE.length) }
}
