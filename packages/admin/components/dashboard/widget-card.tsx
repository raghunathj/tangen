/**
 * File Name: widget-card.tsx
 * Purpose: One card for every home-dashboard widget. The chrome is the kit's
 *          `Panel` - the same hairline, radius and barely-there lift a framed
 *          DataList and a settings card use - so the home page reads as part
 *          of the product rather than a board of widgets pasted onto it.
 *
 *          Two calibrations came out of the 2026-09-19 pass: the card body is
 *          the RAISED surface (a grey body on a near-white page went muddy and
 *          flattened the hairline), and the grey is spent where it earns its
 *          keep instead - the icon tile and a table's header row.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @/kit only. No em dashes.
 */
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Panel } from '@/kit'

export interface WidgetCardProps {
  /** The widget's mark, in a grey tile. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Makes the whole card the link: the pointer, the hover and the role. */
  onOpen?: () => void
  /** The right end of the header row: a summary, a link, a control. */
  action?: ReactNode
  /** The body owns its own padding (a table, a list). */
  flush?: boolean
  children?: ReactNode
}

export function WidgetCard({ icon, title, description, action, onOpen, flush, children }: WidgetCardProps) {
  return (
    <Panel
      flush
      className={clsx(
        'flex h-full min-h-0 flex-col',
        onOpen && 'cursor-pointer transition-colors motion-fast hover:border-border-strong',
      )}
      {...(onOpen ? { onClick: onOpen, role: 'link' } : {})}
    >
      <div className="flex items-start gap-2.5 p-4 pb-3">
        {icon && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-muted [&_svg]:size-4">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-ui-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-ui-xs text-fg-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={clsx('min-h-0 flex-1', !flush && 'px-4 pb-4')}>{children}</div>
    </Panel>
  )
}
