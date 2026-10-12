/**
 * File Name: breadcrumb.tsx
 * Purpose: The ancestry trail above the canvas.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Presentation only - the trail itself is computed by
 *          lib/breadcrumb.ts. Hovering a crumb highlights that block in the
 *          preview, which is what makes the trail explorable rather than
 *          merely informative.
 */
import { clsx } from 'clsx'
import { IconChevronRight } from '@tangen/icons'
import type { Crumb } from '../lib/breadcrumb'

interface BreadcrumbProps {
  crumbs: Crumb[]
  iconFor: (name: string) => React.ComponentType<{ className?: string }>
  onSelect: (key: string | null) => void
  onHover: (key: string | null) => void
}

export function Breadcrumb({ crumbs, iconFor, onSelect, onHover }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Selected block ancestry"
      className="flex items-center gap-0.5 min-w-0 overflow-hidden"
      onMouseLeave={() => onHover(null)}
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        const Icon = c.icon ? iconFor(c.icon) : null
        return (
          <span key={`${c.key ?? 'root'}:${i}`} className="flex items-center gap-0.5 min-w-0">
            {i > 0 && <IconChevronRight className="size-3 shrink-0 text-fg-subtle" />}
            <button
              type="button"
              // The collapsed middle has no single block to select.
              disabled={c.key === null && i > 0}
              onClick={() => onSelect(c.key)}
              onMouseEnter={() => onHover(c.key)}
              className={clsx(
                'flex items-center gap-1 min-w-0 rounded px-1.5 py-0.5 text-[11px] truncate',
                last ? 'text-fg font-medium' : 'text-fg-muted',
                c.key === null && i > 0
                  ? 'cursor-default'
                  : 'hover:bg-surface-hover hover:text-fg',
              )}
              title={c.label}
            >
              {Icon && <Icon className="size-3 shrink-0" />}
              <span className="truncate">{c.label}</span>
            </button>
          </span>
        )
      })}
    </nav>
  )
}
