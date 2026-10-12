/**
 * File Name: refused-note.ts
 * Purpose: The note the Style panel shows when Block protection refused
 *          declarations on the last draft render - what was left out, and
 *          why, said once.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The compiler reports every refusal (`refused` on the
 *          draft and publish responses) rather than dropping it, and the
 *          panel refuses the same properties before they are written - so
 *          in the normal course nothing reaches this note. What does reach
 *          it is the other designer's class, the class written before a
 *          Block's author tightened its declaration, the row edited by hand:
 *          a value that is in the store, compiles to nothing, and would
 *          otherwise be "the page did not move" with no explanation.
 *
 *          Pure, so the wording is testable without a render. The note is
 *          dismissible, and the KEY is what makes dismissal honest: it is
 *          derived from the refusals themselves, so the same list stays
 *          dismissed across re-renders and a different one shows again.
 */
import type { Refusal } from '@tangen/studio-compiler'

export interface RefusedNote {
  /** The one-line summary: "2 declarations were refused by Block protection: .card display, .cta width". */
  summary: string
  /** One line per refusal, with the compiler's reason. */
  lines: string[]
  /** Stable for the same set of refusals, so a dismissal survives re-renders. */
  key: string
}

/** `.card display` - the rule and the property, how the server log says it. */
const where = (r: Refusal) => `.${r.rule} ${r.property}`

/**
 * The note for a refusal list, or null when there is nothing to say.
 *
 * Duplicates collapse (a rule refused at two breakpoints is one refusal to
 * a designer) and the order is the rule's then the property's, so the
 * summary reads the same however the compiler happened to walk the rows.
 */
export function formatRefusedNote(refused: readonly Refusal[] | undefined): RefusedNote | null {
  const seen = new Map<string, Refusal>()
  for (const r of refused ?? []) {
    if (!r || typeof r.rule !== 'string' || typeof r.property !== 'string') continue
    seen.set(where(r), r)
  }
  if (seen.size === 0) return null
  const list = [...seen.values()].sort((a, b) =>
    a.rule.localeCompare(b.rule) || a.property.localeCompare(b.property))
  const count = list.length
  const noun = count === 1 ? 'declaration was' : 'declarations were'
  return {
    summary: `${count} ${noun} refused by Block protection: ${list.map(where).join(', ')}`,
    lines: list.map((r) => `${where(r)}: ${r.reason || 'refused'}`),
    key: list.map(where).join('|'),
  }
}
