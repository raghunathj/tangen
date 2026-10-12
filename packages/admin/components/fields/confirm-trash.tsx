/**
 * File Name: confirm-trash.tsx
 * Purpose: Two-step delete for ENTRY-editor cards (component blocks, repeater rows) —
 *   the trash icon arms a red "Delete?" that must be clicked again to confirm
 *   (auto-disarms). Same guard the schema builder's ✕ buttons use.
 *
 * Author: Raghunath J
 * License: MIT
 */
import { useEffect, useState } from 'react'
import { IconTrash } from '@tangen/icons'
import { confirmationsPaused, pauseConfirmations } from '@/lib/confirm-guard'

export function ConfirmTrash({ onConfirm, title = 'Remove' }: {
  onConfirm: () => void
  title?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 2500)
    return () => clearTimeout(t)
  }, [armed])

  if (armed) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => { setArmed(false); onConfirm() }}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger text-white hover:bg-danger-fg"
        >
          Delete?
        </button>
        <button
          type="button"
          title="Delete and stop asking until the page reloads"
          onClick={() => { pauseConfirmations(); setArmed(false); onConfirm() }}
          className="text-[10px] text-fg-subtle hover:text-fg underline"
        >
          don't ask
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (confirmationsPaused()) { onConfirm(); return } setArmed(true) }}
      title={`${title} (asks to confirm)`}
      className="p-1 rounded text-fg-subtle hover:text-danger-fg hover:bg-danger-muted transition-colors"
    >
      <IconTrash className="size-3.5" />
    </button>
  )
}
