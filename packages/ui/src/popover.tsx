'use client'
/**
 * File Name: popover.tsx
 * Purpose: Popover - the anchored surface for inline editors, filter
 *          builders and pickers (UI V2 spec §12), over Radix Popover. Same
 *          surface as Menu (raised, popover shadow, radius lg) with 8px
 *          padding and a 240px minimum, so a property row's editor and a
 *          filter chip's editor look like the same thing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @radix-ui/react-popover. Focus moves into the content
 *          on open and returns to the trigger on close (Radix).
 */
import React from 'react'
import * as P from '@radix-ui/react-popover'
import { cx } from './utils'

const Popover = P.Root
const PopoverTrigger = P.Trigger
const PopoverAnchor = P.Anchor
const PopoverClose = P.Close

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    /** Remove the default 8px padding (for a list that manages its own). */
    flush?: boolean
  }
>(({ className, flush, sideOffset = 4, collisionPadding = 8, align = 'start', ...props }, ref) => (
  <P.Portal>
    <P.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cx(
        'z-(--tg-z-popover) min-w-[15rem] rounded-lg bg-surface-raised text-fg shadow-popover outline-none',
        !flush && 'p-2',
        'animate-slide-down-and-fade data-[side=top]:animate-slide-up-and-fade',
        className,
      )}
      {...props}
    />
  </P.Portal>
))
PopoverContent.displayName = 'PopoverContent'

export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent }
