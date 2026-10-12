/**
 * File Name: breadcrumb.tsx
 * Purpose: Breadcrumb (UI V2 spec §13): `text-ui` (the benchmark page title, 13px), links in `fg-muted`,
 *          a `/` separator in `fg-faint`, the current page in `fg` at weight
 *          500. Replaces the hand-built Link chains; the frame header renders
 *          it for every page.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Router-agnostic: pass `asChild` on a BreadcrumbLink and
 *          wrap a router Link, or give it an `href`.
 */
import React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cx } from './utils'

const Breadcrumb = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'nav'>>(
  ({ className, ...props }, ref) => (
    <nav ref={ref} aria-label="Breadcrumb" className={cx('min-w-0', className)} {...props} />
  ),
)
Breadcrumb.displayName = 'Breadcrumb'

const BreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<'ol'>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cx('flex min-w-0 flex-wrap items-center gap-1.5 text-ui text-fg-muted', className)} {...props} />
  ),
)
BreadcrumbList.displayName = 'BreadcrumbList'

const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<'li'>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cx('inline-flex min-w-0 items-center gap-1.5', className)} {...props} />
  ),
)
BreadcrumbItem.displayName = 'BreadcrumbItem'

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<'a'> & { asChild?: boolean }>(
  ({ asChild, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'a'
    return (
      <Comp
        ref={ref}
        className={cx(
          'truncate rounded-xs transition-colors motion-fast hover:text-fg',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          className,
        )}
        {...props}
      />
    )
  },
)
BreadcrumbLink.displayName = 'BreadcrumbLink'

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<'span'>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} role="link" aria-disabled="true" aria-current="page" className={cx('truncate font-medium text-fg', className)} {...props} />
  ),
)
BreadcrumbPage.displayName = 'BreadcrumbPage'

const BreadcrumbSeparator = ({ className, children, ...props }: React.ComponentPropsWithoutRef<'li'>) => (
  <li role="presentation" aria-hidden="true" className={cx('select-none text-fg-faint', className)} {...props}>
    {children ?? '/'}
  </li>
)

export { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator }
