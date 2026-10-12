/**
 * File Name: list-chip.tsx
 * Purpose: The view bar's left chip, as a primitive: an icon, a label and the
 *          row count, in the shape the content list's view switcher already
 *          wears. A list that has no saved views still needs to say what it is
 *          showing and how much of it, and it should say it in the same voice -
 *          so this is in the kit rather than redrawn per page.
 *
 * Author: Raghunath J
 * License: MIT
 */
import * as React from 'react'
import { cx } from './utils'

export interface ListChipProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What this list is: "All redirects", "Missing pages". */
  label: string
  /** How many rows the list holds in total; omitted while it is unknown. */
  count?: number
  /** The list's own icon, drawn before the label. */
  icon?: React.ReactNode
}

/**
 * A link inside body copy: black with a quiet underline that firms up on
 * hover. An accent-coloured link in a dense admin reads as decoration; this
 * reads as text you can click.
 */
export const TEXT_LINK = 'font-medium text-fg underline decoration-border decoration-1 underline-offset-2 transition-colors motion-fast hover:decoration-fg'

export function ListChip({ label, count, icon, className, ...props }: ListChipProps) {
  return (
    <div
      className={cx(
        'inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-control px-1.5 text-ui font-medium text-fg',
        className,
      )}
      {...props}
    >
      {icon && <span className="shrink-0 text-fg-subtle [&_svg]:size-4" aria-hidden>{icon}</span>}
      <span className="truncate">{label}</span>
      {typeof count === 'number' && (
        <span className="shrink-0 font-normal text-fg-subtle tabular-nums">{`· ${count.toLocaleString()}`}</span>
      )}
    </div>
  )
}
