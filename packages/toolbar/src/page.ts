/**
 * File Name: page.ts
 * Purpose: Page identity for the toolbar - reportPage tells the toolbar (and,
 *          via the SDK, an embedding admin live-preview pane) which content
 *          object the current page renders, enabling "Edit this page".
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One call serves both consumers: the toolbar's Edit
 *          button and the admin's presentation-mode follow (the SDK's
 *          notifyPreviewNavigation is already a no-op outside the preview
 *          iframe, so calling it unconditionally is safe). SSR-safe.
 */
import { notifyPreviewNavigation, notifyPreviewNotEditable } from '@tangen/sdk'
import { setPage, type PageIdentity } from './state'

export interface ReportPageOpts {
  /** Admin origin to scope the preview postMessage (recommended in prod). */
  adminOrigin?: string
}

/**
 * Declares the content object behind the current page. Call on every route
 * that renders one object (a post, a page, a product). Feeds the toolbar's
 * "Edit this page" button AND the admin's live-preview follow.
 */
export function reportPage(page: PageIdentity, opts: ReportPageOpts = {}): void {
  setPage(page)
  notifyPreviewNavigation(
    { id: page.id, type: page.type, slug: page.slug },
    opts.adminOrigin ? { adminOrigin: opts.adminOrigin } : {},
  )
}

/**
 * Declares the current page has no single editable object (listings, home).
 * Clears the toolbar's Edit button and tells an embedding admin the same.
 */
export function reportNoPage(opts: ReportPageOpts = {}): void {
  setPage(null)
  notifyPreviewNotEditable(opts.adminOrigin ? { adminOrigin: opts.adminOrigin } : {})
}
