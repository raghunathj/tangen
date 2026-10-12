/**
 * File Name: publish-menu.tsx
 * Purpose: The Publish control - the primary action, plus schedule, unpublish
 *          and archive behind a chevron.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Which actions exist is decided by publishActions(), not
 *          here. Actions that cannot apply are ABSENT rather than disabled: a
 *          menu of greyed-out entries makes people hunt for the state that
 *          would enable them.
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IconChevronDown } from '@tangen/icons'
import { Button } from '@/kit'
import { publishActions, type PublishActionId } from '../lib/publish-menu'

interface PublishMenuProps {
  status: string
  /** Environment-aware wording, e.g. "Publish to production". */
  label: string
  busy?: boolean
  blockedReason?: string | null
  /** What to do INSTEAD, when the block offers a way forward. */
  policyAction?: { label: string; run: () => void } | null
  onAction: (action: PublishActionId) => void
}

export function PublishMenu({ status, label, busy, blockedReason, policyAction, onAction }: PublishMenuProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  const actions = publishActions(status, true)
  const primary = actions[0]
  const rest = actions.slice(1)

  // Before any early return: a hook after a conditional return changes the
  // hook order between renders, which React refuses to run.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!primary) return null

  // Blocked WITH a way forward: offer that instead of a dead Publish button.
  // A disabled control plus an explanation still leaves the user to go and
  // find the thing that unblocks it.
  if (blockedReason && policyAction) {
    return (
      // No warning icon: a draft that has not been submitted yet is the
      // NORMAL state, not an alarm, and an alarm that is always on says
      // nothing. The button IS the message, and carries the reason.
      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0"
        onClick={policyAction.run}
        isLoading={busy}
        title={blockedReason}
      >
        {policyAction.label}
      </Button>
    )
  }

  return (
    <div ref={box} className="relative shrink-0 flex items-center gap-1.5">

      {/* ONE control that happens to have two hit areas - built from the
          accent tokens directly rather than two Buttons that merely touch,
          which left a seam and mismatched radii. */}
      <div className="flex items-stretch h-7 rounded-md overflow-hidden bg-accent text-white shadow-sm">
        <button
          type="button"
          onClick={() => onAction(primary.id)}
          disabled={busy}
          className="px-3 text-xs font-medium hover:bg-accent-strong disabled:opacity-60 transition-colors duration-(--tg-motion-fast)"
        >
          {busy ? 'Working…' : primary.id === 'publish' && primary.label === 'Publish' ? label : primary.label}
        </button>
        {rest.length > 0 && (
          <>
            <span aria-hidden className="w-px bg-black/20" />
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label="More publishing actions"
              className="grid place-items-center px-1.5 hover:bg-accent-strong transition-colors duration-(--tg-motion-fast)"
            >
              <IconChevronDown className={clsx('size-3.5 transition-transform duration-(--tg-motion-fast)', open && 'rotate-180')} />
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-border bg-surface-raised shadow-lg py-1">
          {rest.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setOpen(false); onAction(a.id) }}
              className={clsx(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover',
                a.destructive ? 'text-danger' : 'text-fg',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
