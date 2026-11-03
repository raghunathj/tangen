/**
 * File Name: relation-picker.ts
 * Purpose: What a relation picker needs beyond the shared query layer: the
 *   status filter's vocabulary, the id toggle, and the label and tone of a
 *   content status.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Query building moved to lib/pickable-objects.ts, which
 *          every entry picker shares. See the note below.
 */

export type RelationStatusFilter = 'all' | 'draft' | 'published' | 'archived'

/*
 * `buildRelationQuery` lived here and is gone. It hard-coded `limit: 20` with
 * an `offset` parameter that both relation pickers only ever passed as 0, so
 * every relation field offered the first 20 entries of its target type and no
 * way to reach the 21st. The pickers share `pickerQueryBody` with the object
 * and link pickers now, which pages, sorts and carries a field's filter -
 * see lib/pickable-objects.ts. A source gate keeps them on it.
 */

/**
 * Adds id to the array if absent, removes it if present; used for multi-select relation fields.
 * @param ids - Current array of selected IDs
 * @param id - The ID to toggle
 * @returns Updated array with the ID added or removed
 */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export interface StatusBadge {
  label: string
  /** A `Badge` variant from `@tangen/ui`, not a class string. */
  variant: 'default' | 'neutral' | 'success' | 'error' | 'warning' | 'info'
}

/**
 * The label and `Badge` variant for a content status.
 *
 * This used to return a Tailwind class string, and those strings painted raw
 * palette steps - a fixed green fill, fixed green text, a fixed green border -
 * which the design system's own Badge doc says a badge must never do, because
 * a palette step is one colour and a surface has two themes. Naming the
 * VARIANT keeps the colour decision in the design system, where dark mode is
 * already answered.
 */
export function statusBadge(status: string): StatusBadge {
  switch (status) {
    case 'published':
      return { label: 'Published', variant: 'success' }
    case 'draft':
      return { label: 'Draft', variant: 'neutral' }
    case 'archived':
      return { label: 'Archived', variant: 'warning' }
    case 'staged':
      return { label: 'Staged', variant: 'default' }
    default:
      // An unknown status is shown as it arrived rather than guessed at.
      return { label: status, variant: 'neutral' }
  }
}
