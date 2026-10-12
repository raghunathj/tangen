/**
 * File Name: viewport.ts
 * Purpose: The header's publish-state meta (label + dot colour per object
 *   status).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Preview WIDTHS deliberately do NOT live here. Studio
 *   once shipped a three-preset fork; the admin's own control
 *   (usePreviewBreakpoints / PreviewBreakpoints in the live-preview pane)
 *   already carries those presets PLUS the site's configured widths
 *   (frontend.previewBreakpoints) and each person's saved custom ones, so
 *   Studio uses that and the fork is gone. Re-adding presets here would
 *   silently drop both of those - viewport.test.ts guards against it.
 */

export interface StatusMeta {
  label: string
  /** Tailwind class for the header status dot. */
  dot: string
}

/** Header publish-state meta. Anything unknown reads as a draft (never lies "live"). */
export function statusMeta(status: string | null | undefined): StatusMeta {
  switch (status) {
    case 'published': return { label: 'Published', dot: 'bg-green-500' }
    case 'scheduled': return { label: 'Scheduled', dot: 'bg-blue-500' }
    case 'archived': return { label: 'Archived', dot: 'bg-amber-500' }
    default: return { label: 'Draft', dot: 'bg-fg-subtle' }
  }
}
