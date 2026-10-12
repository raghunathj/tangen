/**
 * File Name: EditorBar.tsx
 * Purpose: The bar pinned to the top of the object editor's scroll area for
 *          a condition the author must act on before the next keystroke
 *          (2026-09-13): another actor changed this entry, a save was
 *          refused as stale, or someone else holds the editing claim. Not a
 *          card in the flow: it stays in view wherever the author has
 *          scrolled to, and it never dismisses on its own - the action IS
 *          the way out.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure, so it renders in a test without a socket. The
 *          tone is carried by the edge and the icon chip; the raised
 *          surface and the dialog shadow lift it off the form.
 */
import type { ReactNode } from 'react'
import { IconAlert, IconInfo } from '@tangen/icons'

export interface EditorBarProps {
  tone: 'warning' | 'info'
  title: string
  detail: ReactNode
  /** The way out: Reload, Take over, Take back. */
  actions: ReactNode
  testId?: string
}

export function EditorBar({ tone, title, detail, actions, testId }: EditorBarProps) {
  const warning = tone === 'warning'
  return (
    <div
      role="status"
      data-testid={testId ?? 'editor-bar'}
      data-tone={tone}
      className={
        'sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-l-4 border-border-subtle bg-surface-raised px-5 py-3 shadow-dialog sm:px-8 '
        + (warning ? 'border-l-warning' : 'border-l-accent')
      }
    >
      <span className={'flex size-8 shrink-0 items-center justify-center rounded-md ' + (warning ? 'bg-warning-muted text-warning' : 'bg-accent-muted text-accent-fg')} aria-hidden="true">
        {warning ? <IconAlert className="size-4" /> : <IconInfo className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ui-sm font-semibold text-fg">{title}</p>
        <p className="text-ui-xs text-fg-muted">{detail}</p>
      </div>
      <span className="flex shrink-0 items-center gap-2">{actions}</span>
    </div>
  )
}
