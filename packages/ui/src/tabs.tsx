'use client'
/**
 * File Name: tabs.tsx
 * Purpose: Tabs (UI V2 spec §13) over Radix Tabs. Two looks, one contract:
 *          `pill` for a frame header (28px, the active tab a neutral
 *          selected tint) and `underline` for content sections (36px, the
 *          active tab in `fg` with a 2px `fg` underline). Neutral in both:
 *          selection is not intent, so it is not indigo.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @radix-ui/react-tabs (roving tabindex, arrow keys,
 *          aria-selected). Replaces the hand-rolled tablists and the
 *          api-keys TabBar.
 */
import React from 'react'
import * as T from '@radix-ui/react-tabs'
import { cx } from './utils'

type Variant = 'pill' | 'underline'
const VariantContext = React.createContext<Variant>('underline')

const Tabs = React.forwardRef<
  React.ElementRef<typeof T.Root>,
  React.ComponentPropsWithoutRef<typeof T.Root> & { variant?: Variant }
>(({ variant = 'underline', className, ...props }, ref) => (
  <VariantContext.Provider value={variant}>
    <T.Root ref={ref} className={cx('flex flex-col', className)} {...props} />
  </VariantContext.Provider>
))
Tabs.displayName = 'Tabs'

const TabsList = React.forwardRef<
  React.ElementRef<typeof T.List>,
  React.ComponentPropsWithoutRef<typeof T.List>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(VariantContext)
  return (
    <T.List
      ref={ref}
      className={cx(
        'flex shrink-0 items-center',
        variant === 'pill' ? 'gap-0.5 rounded-control bg-surface-sunken p-0.5' : 'gap-4 border-b border-border-subtle',
        className,
      )}
      {...props}
    />
  )
})
TabsList.displayName = 'TabsList'

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof T.Trigger>,
  React.ComponentPropsWithoutRef<typeof T.Trigger> & { count?: number }
>(({ className, children, count, ...props }, ref) => {
  const variant = React.useContext(VariantContext)
  return (
    <T.Trigger
      ref={ref}
      className={cx(
        'inline-flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-ui-sm font-medium transition-colors motion-fast',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        'disabled:pointer-events-none disabled:text-fg-faint',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'pill'
          ? [
              'h-7 rounded-[calc(var(--tg-radius-control)-2px)] px-2.5 text-fg-muted hover:text-fg',
              'data-[state=active]:bg-surface-raised data-[state=active]:text-fg data-[state=active]:shadow-raised',
            ]
          : [
              '-mb-px h-9 border-b-2 border-transparent px-0.5 text-fg-muted hover:text-fg',
              'data-[state=active]:border-fg data-[state=active]:text-fg',
            ],
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="rounded-sm bg-surface-hover px-1 text-ui-2xs text-fg-muted">{count}</span>
      )}
    </T.Trigger>
  )
})
TabsTrigger.displayName = 'TabsTrigger'

const TabsContent = React.forwardRef<
  React.ElementRef<typeof T.Content>,
  React.ComponentPropsWithoutRef<typeof T.Content>
>(({ className, ...props }, ref) => (
  <T.Content
    ref={ref}
    className={cx('outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus', className)}
    {...props}
  />
))
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsList, TabsTrigger, TabsContent }
