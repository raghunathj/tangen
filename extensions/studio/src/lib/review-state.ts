/**
 * File Name: review-state.ts
 * Purpose: Maps the review extension's state payload into what Studio's chip
 *          needs to show.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Studio deliberately re-derives NOTHING about the
 *          workflow. Whether a page is approved comes from the publish gate's
 *          own verdict rather than from Studio deciding which stage counts as
 *          terminal - two implementations of that rule is how the chip ends
 *          up saying "Approved" over a Publish button that refuses.
 */
import type { ReviewState } from '../components/review-chip'

interface RawState {
  covered?: unknown
  record?: { stageId?: unknown; assigneeId?: unknown } | null
  stale?: unknown
  canAct?: unknown
  workflow?: { stages?: Array<{ id?: unknown; name?: unknown }> } | null
}

/**
 * `publishBlocked` is the gate's answer for this page. Approved means: it has
 * been through review AND the gate no longer objects.
 */
export function reviewChipState(raw: RawState | null | undefined, publishBlocked: boolean): ReviewState | null {
  if (!raw || typeof raw !== 'object' || raw.covered !== true) return null

  const stageId = typeof raw.record?.stageId === 'string' ? raw.record.stageId : undefined
  const stages = Array.isArray(raw.workflow?.stages) ? raw.workflow.stages : []
  const match = stages.find((s) => s?.id === stageId)
  const stageName = typeof match?.name === 'string' ? match.name : stageId

  return {
    covered: true,
    record: stageId ? { stageId, stageName } : null,
    stale: raw.stale === true,
    canAct: raw.canAct === true,
    // Never derived from stage position - the gate is the authority.
    approved: !!stageId && publishBlocked === false,
  }
}

/** One thing the chip can offer. */
export interface ReviewAction {
  id: 'submit' | 'resubmit' | 'withdraw' | 'advance' | 'reject'
  label: string
  destructive?: boolean
}

/**
 * What this member can do from here. Only what the server would accept -
 * offering an action it refuses is how a panel loses trust, and offering
 * NOTHING when the server would accept one is how a page gets stuck.
 *
 * The stale case is the one that got stuck. A stale approval still HAS a
 * stage (the terminal one), so the old inline check `if (!stage) submit`
 * offered nothing - while the review server explicitly accepts a resubmit
 * from a stale terminal stage, restarting the cycle with the gate shut.
 */
export function reviewActions(state: ReviewState): ReviewAction[] {
  const stage = state.record?.stageId
  if (!stage) return [{ id: 'submit', label: 'Submit for review' }]

  if (state.stale) {
    return [
      { id: 'resubmit', label: 'Resubmit for review' },
      { id: 'withdraw', label: 'Withdraw' },
    ]
  }

  if (state.approved) return []

  const out: ReviewAction[] = [{ id: 'withdraw', label: 'Withdraw' }]
  if (state.canAct) {
    out.push({ id: 'advance', label: 'Approve this stage' })
    out.push({ id: 'reject', label: 'Reject', destructive: true })
  }
  return out
}
