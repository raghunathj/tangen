'use client'
import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { IconX } from '@tangen/icons'
import { cx } from './utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

const DialogPortal = ({ children }: { children: React.ReactNode }) => (
  <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>
)

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cx('fixed inset-0 z-(--tg-z-dialog) bg-surface-overlay', className)}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showClose?: boolean
    /** Width: sm 480px (confirmations), md 640px (forms, the default), lg 800px (pickers, diffs). */
    size?: 'sm' | 'md' | 'lg'
  }
>(({ className, children, showClose = true, size = 'md', onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  // Where focus came from, so it can go back. Radix returns focus to its own
  // <Dialog.Trigger>; most Admin dialogs are opened by an ordinary button that
  // sets state instead, so there was no trigger to return to and closing left
  // the keyboard user on <body> at the top of the document - measured, not
  // assumed (Phase 8B browser harness). Captured here rather than per dialog
  // so every consumer gets it once.
  // Captured during RENDER, not in onOpenAutoFocus: by the time Radix fires
  // that event its focus scope has already left the trigger, so reading
  // document.activeElement there returned <body>.
  const returnFocus = React.useRef<HTMLElement | null>(null)
  if (returnFocus.current === null && typeof document !== 'undefined') {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) returnFocus.current = active
  }


  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={(e) => {
        onCloseAutoFocus?.(e)
        if (e.defaultPrevented) return
        const el = returnFocus.current
        // Only if it is still on the page: a dialog that deleted the row its
        // trigger lived in must not force focus onto a detached node.
        if (el && document.contains(el)) {
          e.preventDefault()
          el.focus()
        }
      }}
      className={cx(
        'fixed left-1/2 top-1/2 z-(--tg-z-dialog) flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
        size === 'sm' ? 'max-w-[480px]' : size === 'lg' ? 'max-w-[750px]' : 'max-w-[640px]',
        'rounded-xl bg-surface-raised text-fg shadow-dialog outline-none',
        className,
      )}
      // The DatePicker calendar portals to <body> - without these guards a
      // click on a calendar day counts as outside interaction and closes the
      // whole dialog mid-selection.
      onPointerDownOutside={(e) => { if ((e.target as Element)?.closest?.('[data-datepicker-pop],[data-tangen-overlay]')) e.preventDefault() }}
      onInteractOutside={(e) => { if ((e.target as Element)?.closest?.('[data-datepicker-pop],[data-tangen-overlay]')) e.preventDefault() }}
      {...props}
    >
      {withDialogPadding(children)}
      {showClose && (
        <DialogPrimitive.Close
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-control text-fg-subtle transition-colors motion-fast hover:bg-surface-hover hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          aria-label="Close"
        >
          <IconX className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = 'DialogContent'

/**
 * Content between the header and the footer belongs in a DialogBody, which is
 * where the dialog's inner padding and its scroll live. Forgetting it produced
 * a dialog whose fields touched the edges, and it was forgotten repeatedly -
 * so the primitive no longer needs to be remembered: any stray children are
 * wrapped here. A caller that already uses DialogBody is left exactly as it is.
 */
export function withDialogPadding(children: React.ReactNode): React.ReactNode {
  const list = React.Children.toArray(children)
  const isKind = (node: React.ReactNode, kind: unknown) => React.isValidElement(node) && node.type === kind
  if (list.some((c) => isKind(c, DialogBody))) return children
  const head: React.ReactNode[] = []
  const body: React.ReactNode[] = []
  const foot: React.ReactNode[] = []
  for (const child of list) {
    if (isKind(child, DialogHeader)) { head.push(child); continue }
    if (isKind(child, DialogFooter)) { foot.push(child); continue }
    // Anything else is content, wherever the caller put it.
    body.push(child)
  }
  if (body.length === 0) return children
  return <>{head}<DialogBody>{body}</DialogBody>{foot}</>
}

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('flex min-h-11 shrink-0 flex-col justify-center px-5 py-2.5 pr-12 border-b border-border-subtle', className)} {...props} />
)

/**
 * The padded region between header and footer. It exists because those two
 * were padded and the body was not, so every dialog hand-rolled its own -
 * and the ones that forgot rendered flush to the edges. Mirrors SheetBody.
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('min-h-0 flex-1 overflow-y-auto px-5 py-4 text-ui', className)} {...props} />
)

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('flex shrink-0 items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle', className)} {...props} />
)

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cx('flex items-center gap-2 text-title-sm text-fg [&>svg]:size-4.5 [&>svg]:text-fg-subtle', className)} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cx('mt-1 text-ui-sm text-fg-muted', className)} {...props} />
))
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay,
  DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription,
}
