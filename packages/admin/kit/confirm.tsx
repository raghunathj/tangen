/**
 * File Name: confirm.tsx
 * Purpose: Kit confirmation dialog — a declarative <ConfirmDialog> and a
 *          promise-based useConfirm() so destructive actions never ship with
 *          window.confirm or hand-rolled modals.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Part of the stable @/kit surface.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogDescription, DialogFooter,
  Button,
} from '@tangen/ui'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 'destructive' renders a red confirm button (default for deletes). */
  variant?: 'default' | 'destructive'
  /** Awaited — the dialog shows a loading state until it settles. */
  onConfirm: () => void | Promise<void>
}

/** Declarative confirmation dialog. */
export function ConfirmDialog({
  open, onOpenChange, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'default', onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* The message belongs in the BODY (padded, between the bordered header
            and footer) - not as a header subtitle, which left an empty gap.
            DialogBody, so a confirm is padded like every other dialog. */}
        {message && (
          <DialogBody>
            <DialogDescription className="mt-0">{message}</DialogDescription>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'primary'}
            size="sm"
            isLoading={busy}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
}

/**
 * Promise-based confirmation:
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   …
 *   if (await confirm({ title: 'Delete this?', variant: 'destructive' })) { … }
 *   …
 *   return <>{page}{confirmDialog}</>
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const settle = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }

  const confirmDialog = options ? (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) settle(false) }}
      title={options.title}
      message={options.message}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      variant={options.variant}
      onConfirm={() => settle(true)}
    />
  ) : null

  return { confirm, confirmDialog }
}
