/**
 * File Name: ancestor-prefix.tsx
 * Purpose: Where a row SITS, as a faded prefix on its title: `About › Company`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: This replaced an indented tree view, and the reasons are
 *          worth keeping because they are not aesthetic.
 *
 *          The tree built its hierarchy from the rows of ONE PAGE and promoted
 *          any row whose parent was absent to the root, so a search, a filter
 *          or page 2 showed children as top-level rows. A prefix is resolved
 *          on the server (`_ancestors`) and is therefore correct in every one
 *          of those states, and under any sort.
 *
 *          It also costs no horizontal room. Indentation was 24px per level on
 *          top of a checkbox and a chevron: 140px before the title at depth 4,
 *          188px at the platform's own six-level bound, which on a narrow
 *          column left nothing for the words. A prefix is part of the text, so
 *          it truncates with the text instead of pushing it off the row.
 *
 *          And it let the list become the SAME data table every other content
 *          type gets, which is what brought back the header row, the declared
 *          columns, sorting, selection and the bulk actions - a hierarchical
 *          type had none of them.
 */
import { IconChevronRight } from '@tangen/icons'

/** One ancestor as the read returns it, root first. */
export interface AncestorRef {
  id: string
  title: string | null
}

export function AncestorPrefix({ ancestors }: { ancestors?: AncestorRef[] }) {
  if (!Array.isArray(ancestors) || ancestors.length === 0) return null

  // The whole chain, for the hover - a truncated prefix still answers "where
  // is this?" when a reader asks for it.
  const full = ancestors.map((a) => a.title ?? 'Untitled').join(' › ')

  return (
    <span
      className="mr-1 inline-flex shrink items-center gap-0.5 truncate text-ui-sm text-fg-subtle"
      title={full}
      aria-label={`in ${full}`}
    >
      {ancestors.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-0.5">
          <span className="truncate">{a.title ?? <span className="italic">Untitled</span>}</span>
          <IconChevronRight className="size-3 shrink-0 text-fg-faint" aria-hidden="true" />
        </span>
      ))}
    </span>
  )
}
