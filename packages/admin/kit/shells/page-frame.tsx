/**
 * File Name: page-frame.tsx
 * Purpose: PageFrame - the one page model of UI V2 (spec §14). The frame
 *          header stays shell-owned (usePageHeader → the workspace layout's
 *          header bar); this is the CONTENT side: the scroll container, the
 *          width mode (`form` 720px, `document` 840px, `full`), the padding
 *          rhythm, an optional toolbar row and an optional aside column.
 *          `AdminPage` is the supported extension-facing facade over it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface. Width follows the
 *          task: settings and forms do not stretch because the window is
 *          wide; tables, schema tools and developer surfaces may.
 */
import type { ReactNode } from 'react'
import { clsx } from 'clsx'

export type PageFrameWidth = 'form' | 'document' | 'full'

export interface PageFrameProps {
  /** `form` 720px and `document` 840px are centred; `full` uses the width. */
  width?: PageFrameWidth
  /** A row under the header that never scrolls away: search, filters, view. */
  toolbar?: ReactNode
  /** A right column (an inspector, a rail). Hidden under 1024px unless `asideAlways`. */
  aside?: ReactNode
  asideWidth?: 280 | 300 | 320
  asideAlways?: boolean
  /** Remove the content padding (a table that owns its own edges). */
  flush?: boolean
  className?: string
  contentClassName?: string
  children: ReactNode
}

const MAX: Record<PageFrameWidth, string> = {
  form: 'max-w-[720px]',
  document: 'max-w-[840px]',
  full: '',
}

export function PageFrame({
  width = 'full', toolbar, aside, asideWidth = 300, asideAlways, flush, className, contentClassName, children,
}: PageFrameProps) {
  return (
    <div className={clsx('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      {toolbar && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-4 sm:px-6">
          {toolbar}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div
            className={clsx(
              !flush && 'px-4 py-5 sm:px-6 sm:py-6',
              // A flush page owns its layout and gets the full height, so a builder can split it into columns that scroll on their own.
              flush && 'h-full',
              width !== 'full' && clsx('mx-auto w-full', MAX[width]),
              contentClassName,
            )}
          >
            {children}
          </div>
        </div>
        {aside && (
          <aside
            className={clsx(
              'shrink-0 overflow-y-auto border-l border-border-subtle bg-surface',
              asideAlways ? 'flex' : 'hidden lg:flex',
              'flex-col',
              asideWidth === 280 ? 'w-[280px]' : asideWidth === 320 ? 'w-[320px]' : 'w-[300px]',
            )}
          >
            {aside}
          </aside>
        )}
      </div>
    </div>
  )
}
