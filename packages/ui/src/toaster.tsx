'use client'
/**
 * File Name: toaster.tsx
 * Purpose: Draws the toast queue (Lightfield, 2026-09-12). A toast is a card
 *          on the raised surface, not a coloured block: the status lives in
 *          the icon, the title in the foreground tone, the description a
 *          step softer, and the action - Undo, Retry, View - is a real button
 *          at the right. The stack sits bottom-right, newest last, pauses
 *          while the pointer is over it, and announces politely.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: @radix-ui/react-toast for timing, swipe and the live
 *          region; the store in toast.ts. The same tokens carry light and
 *          dark: nothing here names a colour.
 */
import React from 'react'
import * as RadixToast from '@radix-ui/react-toast'
import { IconCheckCircle, IconCloseCircle, IconWarning, IconInfo, IconLoader, IconX, IconArrowRight, IconExternalLink } from '@tangen/icons'
import { cx } from './utils'
import { Button } from './button'
import { useToastStore, type ToastItem, type ToastVariant } from './toast'

const ICON: Record<ToastVariant, { Icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  success: { Icon: IconCheckCircle, tone: 'text-success' },
  error:   { Icon: IconCloseCircle, tone: 'text-danger' },
  warning: { Icon: IconWarning,     tone: 'text-warning' },
  info:    { Icon: IconInfo,        tone: 'text-info' },
  loading: { Icon: IconLoader,      tone: 'text-fg-subtle animate-spin' },
}

function Toast({ item }: { item: ToastItem }) {
  const remove = useToastStore((s) => s.remove)
  const [busy, setBusy] = React.useState(false)
  const { Icon, tone } = ICON[item.variant]
  const assertive = item.variant === 'error'

  async function act() {
    if (!item.action) return
    setBusy(true)
    try { await item.action.onClick() } finally { setBusy(false); remove(item.id) }
  }

  return (
    <RadixToast.Root
      open
      type={assertive ? 'foreground' : 'background'}
      duration={item.duration}
      onOpenChange={(open) => { if (!open) remove(item.id) }}
      className={cx(
        'group relative flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl bg-surface-raised px-4 py-3.5 text-fg shadow-popover',
        'data-[state=open]:animate-[toast-in_200ms_ease-out]',
        'data-[state=closed]:animate-[toast-out_150ms_ease-in]',
        'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-[toast-out_150ms_ease-in]',
      )}
      data-variant={item.variant}
    >
      <Icon className={cx('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
      <div className="min-w-0 flex-1">
        <RadixToast.Title className="text-ui-sm font-medium leading-5 text-fg">{item.title}</RadixToast.Title>
        {item.description && (
          <RadixToast.Description className="mt-0.5 text-ui-xs leading-4 text-fg-muted">{item.description}</RadixToast.Description>
        )}
        {item.link && (
          <a
            href={item.link.href}
            target={item.link.external ? '_blank' : undefined}
            rel={item.link.external ? 'noreferrer' : undefined}
            className="mt-1.5 inline-flex items-center gap-1 text-ui-xs font-medium text-accent-fg hover:underline"
          >
            {item.link.label}
            {item.link.external ? <IconExternalLink className="size-3" aria-hidden /> : <IconArrowRight className="size-3" aria-hidden />}
          </a>
        )}
      </div>
      {item.action && (
        <RadixToast.Action asChild altText={item.action.label}>
          <Button size="xs" variant="secondary" isLoading={busy} onClick={(e) => { e.preventDefault(); void act() }} className="mt-px shrink-0">
            {item.action.label}
          </Button>
        </RadixToast.Action>
      )}
      <RadixToast.Close
        onClick={() => remove(item.id)}
        aria-label="Dismiss"
        className={cx(
          'absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface-raised text-fg-subtle shadow-raised transition-opacity motion-fast',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg',
        )}
      >
        <IconX className="size-3" aria-hidden />
      </RadixToast.Close>
    </RadixToast.Root>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <RadixToast.Provider swipeDirection="right" label="Notifications">
      {toasts.map((t) => <Toast key={t.id} item={t} />)}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-(--tg-z-toast) flex max-h-screen flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  )
}
