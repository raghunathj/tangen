/**
 * File Name: panel.tsx
 * Purpose: The Review editor panel - the object's place in the review
 *          workflow: current stage badge + assignee, Submit for review
 *          (with optional assignee; a resubmit after a rejection prefills
 *          the reviewer who rejected) when out of review, the same
 *          Advance/Reject/Assign actions as the queue (advance through the
 *          optional-note confirm), the reviewer's note after a rejection, and
 *          a View activity timeline modal - the ONE place activity is
 *          listed, so the rail does not repeat what the modal already shows.
 *          A STALE terminal approval (content
 *          edited after entering the terminal stage, per the state route's
 *          `stale` flag) swaps the green ready-to-publish line for an amber
 *          warning and offers the resubmit control right there.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Calls the extension's admin routes
 *          (/admin/ext/review/*) and re-syncs the editor via the C4
 *          refresh() prop after every transition. Type coverage is
 *          resolved server-side - the panel renders on every type and
 *          explains when review is not required. No em dashes in UI copy.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminFetch, toast, Button, ConfirmDialog, cx } from '@/kit'
import { IconArrowRight, IconCloseCircle, IconUserAdd, IconHistory, IconShieldCheck, IconUndo } from '@tangen/icons'
import { isReturned, lastRejectedBy, type ReviewRecord, type WorkflowStage } from './state'
import { advanceActionLabel, memberName, scheduleWarning, stageBadgeClass } from './queue-model'
import { ASSIGNABLE_CAPABILITY, AdvanceDialog, AssignDialog, RejectDialog, useMembers, useSelfId } from './dialogs'
import { ActivityDialog } from './timeline'

interface PanelProps {
  /** The object's id ('' while the editor is on /new). */
  objectId?: string
  /** Lifecycle status: draft | published | scheduled | archived. */
  status?: string
  /** Re-runs the editor's object load. */
  refresh?: () => void
  /**
   * Changes on every successful save. This panel's `stale` flag is computed
   * SERVER-side from the current draft, so without re-reading on save the
   * warning only appeared after a page reload.
   */
  savedAt?: string | null
  /** Published, then edited since. Nothing to re-review without it. */
  hasDraftChanges?: boolean
  /** ISO time a scheduled publish is due, when the object is scheduled. */
  scheduledAt?: string | null
  /**
   * Flushes any pending editor change and resolves once it is stored.
   * Every transition here reads the object SERVER-side - approving freezes a
   * hash of it - so acting on a 3s-debounced draft would approve content the
   * reviewer had already changed on screen.
   */
  save?: () => Promise<void>
}

interface StateResponse {
  data: {
    record: ReviewRecord | null
    /** Terminal-stage approval no longer matching the current draft. */
    stale: boolean
    covered: boolean
    canApprove: boolean
    canManage: boolean
    /** Can THIS caller act on the stage the item is in (stage roles applied). */
    canAct?: boolean
    /** They only get in as the owner - worth saying, not hiding. */
    actingAsOverride?: boolean
    workflow: { id?: string; name?: string; stages: WorkflowStage[]; coveredTypes: string[] | null; configured: boolean }
    /** Every workflow in the workspace - the panel names its own when >1. */
    workflows?: Array<{ id: string; name: string }>
  }
}

export function ReviewPanel({ objectId, status, refresh, savedAt, save, hasDraftChanges, scheduledAt }: PanelProps) {
  const { typeName } = useParams<{ workspaceId: string; typeName: string }>()
  const members = useMembers()
  // Only capability holders can act - the submit/assign pickers offer them.

  const selfId = useSelfId()
  const [submitOpen, setSubmitOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [record, setRecord] = useState<ReviewRecord | null>(null)
  const [stale, setStale] = useState(false)
  const [workflow, setWorkflow] = useState<{ name?: string; stages: WorkflowStage[] } | null>(null)
  const [workflowCount, setWorkflowCount] = useState(1)
  const [covered, setCovered] = useState(true)
  const [canApprove, setCanApprove] = useState(false)
  const [canAct, setCanAct] = useState(false)
  const [override, setOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  // R4: a stage that names roles admits only those roles, so the assignee
  // picker offers them rather than every review:approve holder. Unrestricted
  // stages keep the capability filter.
  const stageRoles = (() => {
    const stages = workflow?.stages ?? []
    // In review: the stage it sits in. NOT in review: the stage a submit will
    // put it in, which is where the assignee has to be able to act - picking
    // from every review:approve holder at submit time hands it straight to
    // someone the first stage refuses.
    const target = record?.stageId
      ? stages.find((s) => s.id === record.stageId)
      : stages[0]
    return target?.roles ?? null
  })()
  const assignableMembers = useMembers(ASSIGNABLE_CAPABILITY, stageRoles)

  const load = useCallback(() => {
    if (!objectId) { setLoaded(true); return }
    adminFetch<StateResponse>(`/admin/ext/review/state/${objectId}`, undefined, typeName ? { type: typeName } : undefined)
      .then((r) => {
        setRecord(r.data.record)
        setStale(r.data.stale === true)
        setWorkflow(r.data.workflow)
        setWorkflowCount(r.data.workflows?.length ?? 1)
        setCovered(r.data.covered)
        setCanApprove(r.data.canApprove)
        setCanAct(r.data.canAct ?? r.data.canApprove)
        setOverride(r.data.actingAsOverride === true)
      })
      .catch(() => { /* uninstalled or offline - keep the panel quiet */ })
      .finally(() => setLoaded(true))
    // Re-read on BOTH signals the editor gives us. `savedAt` covers content
    // edits (which can make an approval stale); `status` covers lifecycle
    // moves, and a publish completes the review cycle server-side - without
    // it the rail kept offering "Ready to publish" for an object that had
    // already gone out, and the Resubmit control only appeared on reload.
  }, [objectId, typeName, savedAt, status])
  useEffect(load, [load])

  // A returned record (rejected, waiting on the author) prefills the submit
  // dialog with the reviewer who rejected - changeable before confirming.
  const returnedTo = isReturned(record) ? lastRejectedBy(record?.history) : null

  const act = async (path: string, body?: Record<string, unknown>, okMsg?: string) => {
    if (!objectId) return
    setBusy(true)
    try {
      // A reviewer who edits and immediately approves must approve what they
      // are looking at, not the last autosaved draft.
      await save?.()
      await adminFetch(`/admin/ext/review/${path}/${objectId}`, { method: 'POST', body: JSON.stringify(body ?? {}) })
      if (okMsg) toast.success(okMsg)
      load()
      refresh?.()
    } catch (e) {
      toast.error('Review action failed', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!objectId) {
    return <p className="text-sm text-fg-subtle">Save this object first, then submit it for review.</p>
  }
  if (!loaded) {
    return <p className="text-sm text-fg-subtle">Loading review state…</p>
  }
  if (!covered) {
    return <p className="text-sm text-fg-subtle">Review is not required for this content type.</p>
  }

  const wf = workflow ?? { stages: [] }
  const stage = record?.stageId ? wf.stages.find((s) => s.id === record.stageId) ?? null : null
  const terminal = wf.stages.length > 0 && record?.stageId === wf.stages[wf.stages.length - 1].id
  // Only the person who submitted it sees Withdraw. The owner may also
  // withdraw (the route allows it) but acts from the Review queue, not from
  // someone else's editor sidebar.
  const isSubmitter = !!selfId && record?.submittedBy === selfId
  // A published object with no edits since has nothing to re-review, so the
  // resubmit control would be an action with no effect. It reappears the
  // moment the draft diverges from what went out.
  const needsReview = status !== 'published' || hasDraftChanges !== false
  const advanceLabel = record?.stageId ? advanceActionLabel(wf, record.stageId) : null
  // A scheduled publish still meets the gate, so an item that is not approved
  // by its due time simply does not go out. Say so where the reviewer is.
  const schedule = scheduleWarning({
    status, scheduledAt, approved: terminal && !stale, now: new Date(),
  })

  return (
    <div className="space-y-3">
      {/* Current standing */}
      {stage ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${stageBadgeClass(wf, record!.stageId)}`}>
            {stage.name}
          </span>
          <span className={`text-xs ${record?.assigneeId ? 'text-fg-muted' : 'text-fg-subtle'}`}>
            {record?.assigneeId ? `Assigned to ${memberName(members ?? null, record.assigneeId)}` : 'Unassigned'}
          </span>
          {workflowCount > 1 && wf.name && (
            <span className="w-full text-[11px] text-fg-subtle">in {wf.name}</span>
          )}
        </div>
      ) : status === 'published' && hasDraftChanges ? (
        /* Content ahead of what is live. Same amber as the in-review stale
           warning - it is the same fact in a different phase: what you are
           looking at has not been reviewed. */
        <p className="text-xs font-medium text-warning-fg">
          Edited since publishing - send it back through review to republish.
        </p>
      ) : (
        <p className="text-sm text-fg-subtle">
          {status === 'published'
            ? 'Published. Editing it again starts a fresh review.'
            : record?.rejectedNote
              ? 'Rejected - address the note and resubmit.'
              : 'Not in review yet.'}
        </p>
      )}

      {record?.rejectedNote && !stage && (
        <p className="text-xs text-fg-muted rounded-md bg-danger-muted border border-red-100 px-2.5 py-2">
          Reviewer: {record.rejectedNote}
        </p>
      )}
      {terminal && !stale && (
        <p className="text-xs text-fg-subtle">
          Ready to publish. Editing the content again invalidates the approval.
        </p>
      )}
      {terminal && stale && (
        <p className="text-xs font-medium text-warning-fg">
          Edited since approval - resubmit before publishing.
        </p>
      )}
      {schedule && (
        <p className={cx(
          'text-xs font-medium',
          schedule.tone === 'danger' ? 'text-danger-fg' : schedule.tone === 'warning' ? 'text-warning-fg' : 'text-fg-muted',
        )}>
          {schedule.text}
        </p>
      )}
      {stage && !canAct && (
        <p className="text-xs text-fg-subtle">
          {canApprove
            ? `Only certain roles can action "${stage.name}".`
            : 'Waiting for a reviewer.'}
        </p>
      )}
      {stage && canAct && override && (
        <p className="text-xs font-medium text-warning-fg">
          Restricted stage - you act here as the owner.
        </p>
      )}

      {/* Rail layout: every action is a full-width icon button in ONE stack,
          so the narrow column reads consistently rather than mixing a bare
          submit control with the icon buttons below it. */}
      <div className="space-y-1.5">
        {/* Submit also shows for a STALE terminal record - the resubmit route
            restarts the cycle from any stage. The reviewer is picked in the
            dialog: a submit needs an owner, so asking is part of submitting. */}
        {((!stage && needsReview) || (terminal && stale)) && (
          <Button size="xs" variant="secondary" className="w-full justify-center" disabled={busy}
            onClick={() => setSubmitOpen(true)}
            icon={<IconShieldCheck className="size-3.5" />}>
            {record?.history?.length ? 'Resubmit for review' : 'Submit for review'}
          </Button>
        )}
        {stage && canAct && (
          <>
            {advanceLabel && (
              <Button size="xs" className="w-full justify-center" disabled={busy} onClick={() => setAdvanceOpen(true)}
                icon={<IconArrowRight className="size-3.5" />}>
                {advanceLabel}
              </Button>
            )}
            <Button size="xs" variant="secondary" className="w-full justify-center text-danger-fg hover:text-danger-fg hover:border-danger/40" disabled={busy} onClick={() => setRejectOpen(true)}
              icon={<IconCloseCircle className="size-3.5" />}>
              Reject…
            </Button>
            {/* Nothing left to hand to anyone once it is approved. */}
            {!terminal && (
              <Button size="xs" variant="secondary" className="w-full justify-center" disabled={busy} onClick={() => setAssignOpen(true)}
                icon={<IconUserAdd className="size-3.5" />}>
                Assign…
              </Button>
            )}
          </>
        )}
        {/* The author's way back out. Stage roles make advance and reject the
            STAGE's decision, so without this a mistaken submission sits stuck
            until a role holder frees it. Needs no capability - it is the
            author retracting their own work, not a review decision. */}
        {/* Not offered once approved: from there, editing the content makes
            the approval stale and the resubmit control appears, which is the
            natural path back. The route still allows it for the owner. */}
        {stage && !terminal && isSubmitter && (
          <Button size="xs" variant="secondary" className="w-full justify-center" disabled={busy}
            onClick={() => setWithdrawOpen(true)}
            icon={<IconUndo className="size-3.5" />}>
            Withdraw from review
          </Button>
        )}
        {(record?.history?.length ?? 0) > 0 && (
          <button type="button" onClick={() => setActivityOpen(true)}
            className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors cursor-pointer">
            <IconHistory className="size-3.5" />
            View activity
          </button>
        )}
      </div>

      {advanceOpen && (
        <AdvanceDialog
          title={record?.title}
          actionLabel={advanceLabel ?? 'Advance'}
          terminal={advanceLabel === 'Approve'}
          override={override}
          stageName={stage?.name}
          stageRoles={stage?.roles ?? undefined}
          onClose={() => setAdvanceOpen(false)}
          onConfirm={async (note) => {
            setAdvanceOpen(false)
            await act('advance', note ? { note } : {},
              advanceLabel === 'Approve' ? 'Approved - this draft can now be published' : 'Advanced')
          }}
        />
      )}
      {rejectOpen && (
        <RejectDialog
          title={record?.title}
          override={override}
          stageName={stage?.name}
          stageRoles={stage?.roles ?? undefined}
          onClose={() => setRejectOpen(false)}
          onConfirm={async (note) => {
            setRejectOpen(false)
            await act('reject', { note }, 'Rejected - the author has your note')
          }}
        />
      )}
      {submitOpen && (
        <AssignDialog
          title={record?.title}
          members={assignableMembers}
          current={returnedTo}
          onClose={() => setSubmitOpen(false)}
          onConfirm={async (assigneeId) => {
            setSubmitOpen(false)
            await act('submit', { typeName, assigneeId }, 'Submitted for review')
          }}
        />
      )}
      {assignOpen && (
        <AssignDialog
          title={record?.title}
          members={assignableMembers}
          current={record?.assigneeId ?? null}
          onClose={() => setAssignOpen(false)}
          onConfirm={async (assigneeId) => {
            setAssignOpen(false)
            await act('assign', { assigneeId }, assigneeId ? 'Assigned' : 'Assignee cleared')
          }}
        />
      )}
      {activityOpen && (
        <ActivityDialog
          title={record?.title}
          history={record?.history ?? []}
          workflow={wf}
          members={members ?? null}
          onClose={() => setActivityOpen(false)}
        />
      )}
      {/* ConfirmDialog owns its own visibility via `open`, so unlike the
          dialogs above it is not wrapped in a conditional. */}
      <ConfirmDialog
        open={withdrawOpen} onOpenChange={setWithdrawOpen}
        title="Withdraw from review?"
        message={terminal
          ? 'This item is approved and ready to publish. Withdrawing discards that approval - resubmitting starts the review again from the first stage.'
          : 'This takes the item out of review and hands it back to you. You can submit it again whenever you are ready.'}
        confirmLabel="Withdraw"
        variant={terminal ? 'destructive' : 'default'}
        onConfirm={() => act('withdraw', undefined, 'Withdrawn from review')}
      />
    </div>
  )
}
