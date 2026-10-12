'use client'
/**
 * File Name: menu.tsx
 * Purpose: Menu - the one dropdown menu of the Admin (UI V2 spec §12), over
 *          Radix DropdownMenu: a raised surface with the popover shadow, 28px
 *          items, a highlighted state shared by pointer and keyboard,
 *          destructive items in the danger text, groups separated by a
 *          hairline, and shortcut hints. Replaces the hand-positioned
 *          AnchoredDropdown and the raw DropdownMenu sites.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @radix-ui/react-dropdown-menu. The trigger receives
 *          `data-state="open"`, which Button renders as its selected state.
 */
import React from 'react'
import * as M from '@radix-ui/react-dropdown-menu'
import { IconCheck, IconChevronRight } from '@tangen/icons'
import { cx } from './utils'

const Menu = M.Root
const MenuTrigger = M.Trigger
const MenuGroup = M.Group
const MenuPortal = M.Portal
const MenuSub = M.Sub
const MenuRadioGroup = M.RadioGroup

// The available height is what stops a long menu (or one opened low in the
// window) from being cut off: it scrolls inside the viewport instead.
const SURFACE = 'z-(--tg-z-popover) max-h-(--radix-dropdown-menu-content-available-height) min-w-[12rem] overflow-y-auto rounded-lg bg-surface-raised p-1 text-fg shadow-popover outline-none'
const ITEM = [
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-control px-2 text-ui-sm text-fg outline-none',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle',
  'hover:bg-surface-sunken data-[highlighted]:bg-surface-sunken data-[highlighted]:text-fg data-[highlighted]:[&_svg]:text-fg',
  'data-[state=open]:bg-surface-selected',
  'data-[disabled]:pointer-events-none data-[disabled]:text-fg-faint data-[disabled]:[&_svg]:text-fg-faint',
  'data-[inset]:pl-8',
].join(' ')

/** `md` is the roomier menu (36px items, 18px icons, 300px wide): filter and
 *  picker menus. The default is the dense 32px menu for actions. */
const MenuContent = React.forwardRef<
  React.ElementRef<typeof M.Content>,
  React.ComponentPropsWithoutRef<typeof M.Content> & { size?: 'sm' | 'md' }
>(({ className, sideOffset = 4, collisionPadding = 8, size = 'sm', ...props }, ref) => (
  <M.Portal>
    <M.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      data-size={size}
      className={cx(
        SURFACE,
        'animate-slide-down-and-fade data-[side=top]:animate-slide-up-and-fade',
        size === 'md' && 'w-[300px] [&_[role^=menuitem]]:h-9 [&_[role^=menuitem]]:text-ui [&_[role^=menuitem]_svg]:size-4.5',
        className,
      )}
      {...props}
    />
  </M.Portal>
))
MenuContent.displayName = 'MenuContent'

const MenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof M.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof M.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <M.SubTrigger ref={ref} data-inset={inset || undefined} className={cx(ITEM, className)} {...props}>
    {children}
    <IconChevronRight className="ml-auto" aria-hidden />
  </M.SubTrigger>
))
MenuSubTrigger.displayName = 'MenuSubTrigger'

const MenuSubContent = React.forwardRef<
  React.ElementRef<typeof M.SubContent>,
  React.ComponentPropsWithoutRef<typeof M.SubContent>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <M.Portal>
    <M.SubContent ref={ref} sideOffset={sideOffset} className={cx(SURFACE, className)} {...props} />
  </M.Portal>
))
MenuSubContent.displayName = 'MenuSubContent'

const MenuItem = React.forwardRef<
  React.ElementRef<typeof M.Item>,
  React.ComponentPropsWithoutRef<typeof M.Item> & {
    inset?: boolean
    /** An irreversible action: danger text, kept last in its group. */
    destructive?: boolean
  }
>(({ className, inset, destructive, ...props }, ref) => (
  <M.Item
    ref={ref}
    data-inset={inset || undefined}
    className={cx(
      ITEM,
      destructive && 'text-danger-fg [&_svg]:text-danger data-[highlighted]:bg-danger-muted data-[highlighted]:text-danger-fg data-[highlighted]:[&_svg]:text-danger',
      className,
    )}
    {...props}
  />
))
MenuItem.displayName = 'MenuItem'

/**
 * A REAL box, drawn whether or not it is ticked: a bare tick that appears only
 * once something is chosen hides the fact that several options can be (the
 * user, 2026-09-20, against the content list, whose filter draws the box).
 */
const MenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof M.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof M.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <M.CheckboxItem ref={ref} className={cx(ITEM, 'group/check pl-8', className)} {...props}>
    <span
      className={cx(
        'absolute left-2 grid size-4 place-items-center rounded-[4px] border border-border-strong bg-surface transition-colors motion-fast',
        'group-data-[state=checked]/check:border-accent-strong group-data-[state=checked]/check:bg-accent-strong',
      )}
      aria-hidden
    >
      <M.ItemIndicator><IconCheck className="size-3 text-accent-contrast!" aria-hidden /></M.ItemIndicator>
    </span>
    {children}
  </M.CheckboxItem>
))
MenuCheckboxItem.displayName = 'MenuCheckboxItem'

const MenuRadioItem = React.forwardRef<
  React.ElementRef<typeof M.RadioItem>,
  React.ComponentPropsWithoutRef<typeof M.RadioItem>
>(({ className, children, ...props }, ref) => (
  <M.RadioItem ref={ref} className={cx(ITEM, 'pl-8', className)} {...props}>
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <M.ItemIndicator><IconCheck className="text-accent-fg!" aria-hidden /></M.ItemIndicator>
    </span>
    {children}
  </M.RadioItem>
))
MenuRadioItem.displayName = 'MenuRadioItem'

const MenuLabel = React.forwardRef<
  React.ElementRef<typeof M.Label>,
  React.ComponentPropsWithoutRef<typeof M.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <M.Label ref={ref} className={cx('px-2 py-1.5 text-ui-2xs text-fg-subtle', inset && 'pl-8', className)} {...props} />
))
MenuLabel.displayName = 'MenuLabel'

const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof M.Separator>,
  React.ComponentPropsWithoutRef<typeof M.Separator>
>(({ className, ...props }, ref) => (
  <M.Separator ref={ref} className={cx('-mx-1 my-1 h-px bg-border-subtle', className)} {...props} />
))
MenuSeparator.displayName = 'MenuSeparator'

/** A keyboard hint at the end of an item ("⌘K"). */
const MenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cx('ml-auto pl-4 text-ui-2xs font-normal tracking-wide text-fg-subtle', className)} {...props} />
)

export {
  Menu, MenuTrigger, MenuContent, MenuItem, MenuCheckboxItem, MenuRadioItem, MenuRadioGroup,
  MenuLabel, MenuSeparator, MenuShortcut, MenuGroup, MenuPortal, MenuSub, MenuSubTrigger, MenuSubContent,
}
