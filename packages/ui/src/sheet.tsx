'use client'
import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { IconX } from '@tangen/icons'
import { cx } from './utils'

/**
 * File Name: sheet.tsx
 * Purpose: Sheet — a side-slider overlay for EDITOR flows (add/edit forms).
 *          Built on the same Radix Dialog primitive as <Dialog> (so it
 *          inherits focus-trap, portal, aria, scroll-lock), but slides in
 *          from the edge and, by design, does NOT close on Escape or an
 *          outside click — only the × / Cancel / Save buttons dismiss it,
 *          so a stray keystroke never discards an in-progress form. Use
 *          <Dialog> for confirmations and quick pickers; <Sheet> for forms.
 *
 * Author: Raghunath J
 * License: MIT
 */

/**
 * Close-reason guards. A non-dismissible sheet cancels Radix's Escape and
 * outside-click close reasons (returning handlers that preventDefault);
 * a dismissible one returns no handlers, restoring the default behavior.
 * Extracted so the "Escape must not close" contract is unit-testable.
 */
export function makeCloseGuards(dismissible: boolean): {
  onEscapeKeyDown?: (e: Event) => void
  onInteractOutside?: (e: Event) => void
  onPointerDownOutside?: (e: Event) => void
} {
  if (dismissible) {
    // Even dismissible sheets must not close when the click lands inside the
    // DatePicker's body-portaled calendar (it lives outside the sheet's DOM).
    const guard = (e: Event) => {
      if ((e.target as Element)?.closest?.('[data-datepicker-pop],[data-tangen-overlay]')) e.preventDefault()
    }
    return { onInteractOutside: guard, onPointerDownOutside: guard }
  }
  const prevent = (e: Event) => e.preventDefault()
  return { onEscapeKeyDown: prevent, onInteractOutside: prevent, onPointerDownOutside: prevent }
}

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close

const SheetPortal = ({ children }: { children: React.ReactNode }) => (
  <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>
)

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cx('fixed inset-0 z-(--tg-z-sheet) bg-surface-overlay', className)}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Which edge to slide from. Default 'right'. */
    side?: 'right' | 'left'
    /** Allow Escape / outside-click to close. Default false (editor-safe). */
    dismissible?: boolean
    showClose?: boolean
    /** Width: sm 480px (the default), md 640px (editors), lg 800px (pickers, previews). */
    size?: 'sm' | 'md' | 'lg'
  }
>(({ className, children, side = 'right', dismissible = false, showClose = true, size = 'sm', onCloseAutoFocus, ...props }, ref) => {
  // Same as DialogContent: a sheet opened by an ordinary button has no Radix
  // trigger to hand focus back to, so closing dropped the keyboard user on
  // <body>. Captured during render, before the focus scope moves.
  const returnFocus = React.useRef<HTMLElement | null>(null)
  if (returnFocus.current === null && typeof document !== 'undefined') {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) returnFocus.current = active
  }

  return (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onCloseAutoFocus={(e) => {
        onCloseAutoFocus?.(e)
        if (e.defaultPrevented) return
        const el = returnFocus.current
        if (el && document.contains(el)) {
          e.preventDefault()
          el.focus()
        }
      }}
      className={cx(
        'fixed inset-y-0 z-(--tg-z-sheet) flex h-full w-full flex-col bg-surface-raised text-fg shadow-sheet outline-none',
        size === 'lg' ? 'sm:max-w-[800px]' : size === 'md' ? 'sm:max-w-[640px]' : 'sm:max-w-[480px]',
        side === 'right' ? 'right-0' : 'left-0',
        className,
      )}
      {...makeCloseGuards(dismissible)}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          className="absolute right-3 top-2.5 flex size-7 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          aria-label="Close"
        >
          <IconX className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </SheetPortal>
  )
})
SheetContent.displayName = 'SheetContent'

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('flex min-h-(--tg-header-h) shrink-0 flex-col justify-center px-5 py-2.5 pr-12 border-b border-border-subtle', className)} {...props} />
)

const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('flex-1 overflow-y-auto px-5 py-4 text-ui', className)} {...props} />
)

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('flex shrink-0 items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle', className)} {...props} />
)

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cx('text-title-sm text-fg', className)} {...props} />
))
SheetTitle.displayName = 'SheetTitle'

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cx('mt-1 text-ui-sm text-fg-muted', className)} {...props} />
))
SheetDescription.displayName = 'SheetDescription'

export {
  Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay,
  SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle, SheetDescription,
}
