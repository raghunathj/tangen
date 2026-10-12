/**
 * File Name: react.ts
 * Purpose: React bindings for @tangen/toolbar - <TangenToolbar/> mounts the
 *          floating toolbar for the component's lifetime.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: react is an OPTIONAL peer dependency - only this
 *          subpath entry imports it; the core entry stays framework-free.
 *          The 'use client' directive is injected by the build banner - a
 *          source directive would land mid-bundle and break Next.
 */
import { useEffect } from 'react'
import { mountToolbar, unmountToolbar, type ToolbarConfig } from './core'
import { reportPage, reportNoPage, type ReportPageOpts } from './page'
import type { PageIdentity } from './state'

/** Mounts the floating Tangen toolbar while rendered. Renders nothing. */
export function TangenToolbar(props: ToolbarConfig): null {
  useEffect(() => {
    mountToolbar(props)
    return () => unmountToolbar()
    // Mount once - config changes require a remount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * Declares the content object behind the current page for the component's
 * lifetime - drop one into each content page (a post, a product). Feeds the
 * toolbar's "Edit this page" button and the admin live-preview follow;
 * unmount (route change to a non-content page) reports not-editable.
 */
export function TangenPage(props: PageIdentity & ReportPageOpts): null {
  const { adminOrigin, ...page } = props
  useEffect(() => {
    reportPage(page, adminOrigin ? { adminOrigin } : {})
    return () => reportNoPage(adminOrigin ? { adminOrigin } : {})
    // Identity keys only - a title change alone should not re-report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.type, page.slug])
  return null
}
