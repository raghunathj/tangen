/**
 * File Name: confirm-x.tsx
 * Purpose: Two-step delete for the builder's structural ✕ buttons — the first click
 *   arms a red "Delete?" that must be clicked again within a moment to confirm
 *   (auto-disarms). Prevents accidental removals without stacking confirm dialogs
 *   inside modals and drag rows.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { Button } from '@/kit'
import { IconX } from '@tangen/icons'
import { confirmationsPaused, pauseConfirmations } from '@/lib/confirm-guard'

export function ConfirmX({ onConfirm, title = 'Remove', className = '' }: {
  onConfirm: () => void
  title?: string
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 2500)
    return () => clearTimeout(t)
  }, [armed])

  if (armed) {
    return (
      <span className={`inline-flex shrink-0 items-center gap-1 ${className}`} onClick={(e) => e.stopPropagation()}>
        <Button size="xs" variant="destructive" className="h-6 px-1.5 text-ui-2xs" onClick={() => { setArmed(false); onConfirm() }}>Delete?</Button>
        <Button size="xs" variant="ghost" className="h-6 px-1 text-ui-2xs text-fg-subtle underline" title="Delete and stop asking until the page reloads" onClick={() => { pauseConfirmations(); setArmed(false); onConfirm() }}>don't ask</Button>
      </span>
    )
  }
  return (
    <Button size="xs" variant="ghost" aria-label={title} title={`${title} (asks to confirm)`} className={`size-6 shrink-0 p-0 text-fg-subtle hover:text-danger-fg ${className}`}
      icon={<IconX className="size-3.5" />}
      onClick={(e) => { e.stopPropagation(); if (confirmationsPaused()) { onConfirm(); return } setArmed(true) }} />
  )
}
