/**
 * File Name: review-chip.tsx
 * Purpose: Where a page stands in review, and what this member can do about
 *          it, without leaving Studio.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio previously showed only a "Submit for review"
 *          button, which said what to do but never what HAPPENED. Once
 *          submitted the page simply could not be published and nothing
 *          explained why - the state lived in a panel of the other editor.
 *
 *          Read-only about the workflow: it renders whatever stage the review
 *          extension reports, and offers only the actions that extension says
 *          this member can take.
 */
import { reviewActions, type ReviewAction } from '../lib/review-state'
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { IconShieldCheck, IconChevronDown } from '@tangen/icons'

export interface ReviewState {
  record: { stageId?: string; stageName?: string } | null
  /** The type is governed by a workflow at all. */
  covered: boolean
  /** Approved, but the draft changed after approval froze. */
  stale?: boolean
  /** This member can act on the stage the page is actually in. */
  canAct?: boolean
  /** Terminal stage reached - approved. */
  approved?: boolean
}

interface ReviewChipProps {
  state: ReviewState | null
  /** Review is the only way forward, so this is THE action, not a status. */
  primary?: boolean
  busy?: boolean
  onSubmit: () => void
  onWithdraw: () => void
  onAdvance: () => void
  onReject: () => void
}

export function ReviewChip({ state, primary, busy, onSubmit, onWithdraw, onAdvance, onReject }: ReviewChipProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Not reviewed: say nothing at all rather than "no review" chrome on every
  // page in a workspace that does not use it.
  if (!state?.covered) return null

  const stage = state.record?.stageName ?? state.record?.stageId
  // Nothing submitted yet and review is the gate: name the ACT, not the
  // absence of it. "Not submitted" describes a state; "Send for review" is
  // the thing to do about it.
  const label = state.stale ? 'Approval stale'
    : state.approved ? 'Approved'
    : stage ? stage
    : primary ? 'Send for review'
    : 'Not submitted'

  const tone = state.stale ? 'text-warning bg-warning-muted'
    : state.approved ? 'text-success bg-success-muted'
    : stage ? 'text-info bg-info-muted'
    : primary ? 'bg-accent text-white shadow-sm'
    : 'text-fg-muted bg-surface-sunken'

  // Only what this member can actually do. The decision is pure and tested
  // in lib/review-state.ts, because the inline version of it silently
  // offered nothing for a stale approval and the page got stuck.
  const run: Record<ReviewAction['id'], () => void> = {
    submit: onSubmit, resubmit: onSubmit, withdraw: onWithdraw, advance: onAdvance, reject: onReject,
  }
  const actions = reviewActions(state).map((a) => ({ ...a, run: run[a.id] }))

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          // One action and it IS the point of the button: run it rather than
          // making someone open a menu to find its only entry.
          if (primary && !stage && actions.length === 1) { actions[0].run(); return }
          if (actions.length > 0) setOpen((o) => !o)
        }}
        disabled={busy || actions.length === 0}
        title={state.stale ? 'Approved, but the draft has changed since' : `Review: ${label}`}
        className={clsx(
          'flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium',
          'transition-colors duration-(--tg-motion-fast)',
          tone,
          actions.length > 0 && 'hover:brightness-110 cursor-pointer',
        )}
      >
        <IconShieldCheck className="size-3.5" />
        <span className="max-w-28 truncate">{label}</span>
        {actions.length > 1 && <IconChevronDown className={clsx('size-3', open && 'rotate-180')} />}
      </button>

      {open && actions.length > 0 && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-border bg-surface-raised shadow-lg py-1">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setOpen(false); a.run() }}
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
