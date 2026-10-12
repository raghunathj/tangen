/**
 * File Name: page-status.ts
 * Purpose: What the status chip says.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The status COLUMN has four values, but while editing
 *          the state that matters most is not one of them: a page can be
 *          live AND have newer edits that are not. "Published" alone is
 *          misleading there - it is true of the site and false of the screen.
 */

export interface PageStatus {
  label: string
  dot: string
  /** Live, but the draft has moved on since. */
  unpublished: boolean
}

/** Saves and publishes can land in the same second; below this is not a change. */
const SETTLE_MS = 1000

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

interface ObjectLike {
  status?: string | null
  published_at?: unknown
  updated_at?: unknown
}

export function pageStatus(object: ObjectLike | null | undefined): PageStatus {
  const status = object?.status ?? 'draft'

  if (status === 'scheduled') return { label: 'Scheduled', dot: 'bg-info', unpublished: false }
  if (status === 'archived') return { label: 'Archived', dot: 'bg-warning', unpublished: false }

  if (status === 'published') {
    const published = time(object?.published_at)
    const updated = time(object?.updated_at)
    // Both dates required: a missing one is not evidence of a newer draft,
    // and guessing would put a permanent warning on a settled page.
    const newer = published !== null && updated !== null && updated - published > SETTLE_MS
    return newer
      ? { label: 'Changes in draft', dot: 'bg-warning', unpublished: true }
      : { label: 'Published', dot: 'bg-success', unpublished: false }
  }

  // Anything unrecognised reads as a draft - never as live.
  return { label: 'Draft', dot: 'bg-fg-subtle', unpublished: false }
}
