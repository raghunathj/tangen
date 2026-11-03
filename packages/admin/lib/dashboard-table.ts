/**
 * File Name: dashboard-table.ts
 * Purpose: One cell of a dashboard table widget, formatted by the
 *          `displayType` its column declares.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: `ContentTableColumn.displayType` has been part of the
 *          contract since the dashboard shipped, and until now nothing read
 *          it: every cell went through `String(value)`, so a column declared
 *          `date` printed `2026-01-02T00:00:00.000Z` on the dashboard. The
 *          one test it had asserted that the type literal compiles.
 *
 *          `status` deliberately returns text rather than a pill. Three
 *          private `StatusChip` copies already exist in this package
 *          (object-picker, multi-relation-picker, taxonomy), and a fourth is
 *          the wrong answer; one shared chip is its own piece of work.
 */
import type { ContentTableColumn } from '@tangen/types'

/**
 * An ISO-8601 instant, strictly: `2026-01-02T00:00:00.000Z`. Not "anything
 * `Date` can parse", which would turn a title like "2026 review" into a date.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

/** Short date, the same shape the content lists and the editor sidebar use. */
const asDate = (v: string): string => {
  const d = new Date(v)
  // A column can be declared over a field that holds something else. The
  // value is more useful than `Invalid Date`.
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The text of one cell. Never throws, and never shows a value the writer did
 * not put there: an unparseable value falls back to itself, and nothing at
 * all falls back to a dash.
 */
export function formatWidgetCell(value: unknown, displayType: ContentTableColumn['displayType']): string {
  if (value === null || value === undefined || value === '') return '-'
  switch (displayType) {
    case 'date':
      return typeof value === 'string' || typeof value === 'number' ? asDate(String(value)) : String(value)
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value)
    }
    case 'boolean':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
    case undefined:
      // A column that declares nothing still must not print a timestamp at
      // somebody. The Recent edits widget is configured in app config, and
      // the natural way to write it - `{ key: 'updatedAt', label: 'Updated' }`
      // - named no display type, so the dashboard read
      // `2026-01-02T00:00:00.000Z`. An explicit `'text'` is left alone,
      // because that is an author asking for the value as it is.
      return typeof value === 'string' && ISO_INSTANT.test(value) ? asDate(value) : String(value)
    default:
      return String(value)
  }
}
