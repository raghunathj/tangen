/**
 * File Name: sub-nav.tsx
 * Purpose: SubNav (UI V2 spec §15): a horizontal row of navigation pills
 *          under a frame header. It is what a contextual tree becomes when
 *          the sidebar has narrowed to a rail, so the rail and a second
 *          column never stack. Neutral selection, 28px pills, scrolls
 *          sideways inside itself.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Router-agnostic through `asChild` (Radix Slot).
 */
import React from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import { cx } from './utils'

const SubNav = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'nav'> & { label?: string }>(
  ({ className, label = 'Section', children, ...props }, ref) => (
    <nav ref={ref} aria-label={label} className={cx('min-w-0 overflow-x-auto', className)} {...props}>
      <ul className="flex items-center gap-1 px-4 py-1.5 sm:px-6">{children}</ul>
    </nav>
  ),
)
SubNav.displayName = 'SubNav'

const SubNavItem = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<'a'> & { asChild?: boolean; active?: boolean; icon?: React.ReactNode }
>(({ asChild, active, icon, className, children, ...props }, ref) => {
  const Comp = asChild ? Slot : 'a'
  return (
    <li className="shrink-0">
      <Comp
        ref={ref}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'inline-flex h-7 items-center gap-1.5 rounded-control px-2.5 text-ui-sm font-medium whitespace-nowrap transition-colors motion-fast',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          '[&_svg]:size-4 [&_svg]:shrink-0',
          active ? 'bg-surface-selected text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
          className,
        )}
        {...props}
      >
        {icon}
        <Slottable>{children}</Slottable>
      </Comp>
    </li>
  )
})
SubNavItem.displayName = 'SubNavItem'

export { SubNav, SubNavItem }
