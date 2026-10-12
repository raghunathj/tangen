/**
 * File Name: review-modal.tsx
 * Purpose: The Review modal - the queue's single per-row surface: the
 *          reviewer SEES the content before acting. Header with title,
 *          type, stage badge, assignee, and an Open-in-editor link; a
 *          scrollable read-only draft preview (string/richtext fields as
 *          labeled blocks); the latest submit/advance/reject note quoted
 *          prominently; the last few activity events with a Full-activity
 *          hop to the timeline; and a footer that walks the same
 *          Advance (optional note, Enter confirms) / Reject (note
 *          required) / Assign (searchable member list) steps inline.
 *          Without review:approve it is a pure read view - and so is a
 *          RETURNED row (rejected, back with the author): a red callout
 *          says who it was returned to and points at the editor, where
 *          the resubmit happens. A STALE terminal row (content edited
 *          after approval) reads the same way: an amber callout plus a
 *          hint at the editor - no footer actions, since only a resubmit
 *          or a revert can unblock publishing.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The draft comes from the core editor GET
 *          (/objects/<type>/<id>); actions call the extension's admin
 *          routes (/admin/ext/review/*) and then onActed() so the queue
 *          refreshes. Advance/Reject close the modal; Assign keeps it open
 *          with the new assignee. No em dashes in UI copy.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminFetch, toast, cx, Button, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/kit'
import { IconExternalLink } from '@tangen/icons'
import { isReturned, type WorkflowStage } from './state'
import {
  actorName, advanceActionLabel, isStaleRow, latestReviewNote, memberName, queueBadge, relativeTime,
  timelineEvents, timelineHeadline,
  type MemberOption, type QueueRow,
} from './queue-model'
import {
  canConfirmReviewAction, summarizeObjectFields,
  type PreviewBlock, type ReviewModalMode,
} from './preview-model'
import { ASSIGNABLE_CAPABILITY, InitialsAvatar, MemberPickList, OverrideNotice, useMembers } from './dialogs'
import { ActivityDialog, markerClass } from './timeline'

/** Events shown inline before the reviewer needs the full timeline. */
const COMPACT_ACTIVITY_COUNT = 4

const NOTE_CLASS = 'mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-focus-border outline-none resize-none'

interface ReviewModalProps {
  row: QueueRow
  workflow: { id?: string; name?: string; stages: WorkflowStage[] }
  members: MemberOption[] | null | undefined
  /**
   * Fallback list only. The modal fetches its own, scoped to the ROW's stage
   * roles - the queue loads one list for the whole page, which cannot know
   * that this row sits in an admin-only stage while the next one does not.
   */
  assignableMembers: MemberOption[] | null | undefined
  /** The queue's review:approve gate - without it the modal is read-only. */
  canApprove: boolean
  workspaceId: string
  onClose: () => void
  /** Fired after any successful action so the queue reloads. */
  onActed: () => void
}

interface DraftState {
  loading: boolean
  failed: boolean
  title: string
  updatedAt?: string
  blocks: PreviewBlock[]
}

export function ReviewModal({
  row, workflow, members, assignableMembers, canApprove, workspaceId, onClose, onActed,
}: ReviewModalProps) {
  const [mode, setMode] = useState<ReviewModalMode>('view')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  // Assign keeps the modal open - track the assignee locally after it lands.
  const [assigneeId, setAssigneeId] = useState<string | null>(row.assigneeId)
  const [draft, setDraft] = useState<DraftState>({ loading: true, failed: false, title: '', blocks: [] })

  // Load the draft once on open - the whole point is seeing it before acting.
  useEffect(() => {
    let alive = true
    adminFetch<{ data: Record<string, unknown> }>(`/objects/${row.typeName}/${row.objectId}`)
      .then((r) => {
        if (!alive) return
        const data = r.data ?? {}
        setDraft({
          loading: false,
          failed: false,
          title: typeof data.title === 'string' ? data.title : '',
          updatedAt: typeof data.updated_at === 'string' ? data.updated_at : undefined,
          blocks: summarizeObjectFields(data),
        })
      })
      .catch(() => { if (alive) setDraft((d) => ({ ...d, loading: false, failed: true })) })
    return () => { alive = false }
  }, [row.typeName, row.objectId])

  // A returned row (rejected, back with the author) is a pure read view -
  // the resubmit happens in the editor panel. So is a STALE terminal row
  // (content edited after approval): advancing is impossible on a terminal
  // record anyway, and the only sensible moves - resubmitting or reverting
  // the edit - live in the editor.
  const returned = isReturned(row)
  const stale = isStaleRow(row)
  const badge = queueBadge(workflow, row)
  const label = advanceActionLabel(workflow, row.stageId)
  const terminal = label === 'Approve'
  const lastNote = latestReviewNote(row.history, workflow)
  // Stage roles decide, not the capability: a restricted stage admits people
  // without review:approve and refuses people with it. Older payloads have no
  // canAct, so fall back to the capability rather than locking the modal.
  const canAct = row.canAct ?? canApprove
  // Who can actually take THIS row: a stage naming roles admits only those
  // roles (with or without review:approve), so assigning anyone else hands it
  // to someone who will be refused. Falls back to the page-wide list while
  // this request is in flight.
  const stageAssignable = useMembers(ASSIGNABLE_CAPABILITY, row.stageRoles ?? null)
  const assignable = stageAssignable ?? assignableMembers
  const override = row.actingAsOverride === true
  const currentStage = workflow.stages.find((s) => s.id === row.stageId)
  const events = timelineEvents(row.history, workflow)
  const recentEvents = events.slice(-COMPACT_ACTIVITY_COUNT)
  const editorHref = `/${workspaceId}/objects/${row.typeName}/${row.objectId}`
  const displayTitle = row.title || draft.title || row.objectId

  const act = async (path: string, body: Record<string, unknown>, okMsg: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      await adminFetch(`/admin/ext/review/${path}/${row.objectId}`, { method: 'POST', body: JSON.stringify(body) })
      toast.success(okMsg)
      onActed()
      return true
    } catch (e) {
      toast.error('Review action failed', (e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const confirmAdvance = async () => {
    if (!row.stageId) return
    const idx = workflow.stages.findIndex((s) => s.id === row.stageId)
    const next = workflow.stages[idx + 1]
    if (!next) return
    const trimmed = note.trim()
    const ok = await act('advance', trimmed ? { note: trimmed } : {},
      terminal ? `Approved - "${displayTitle}" is ready to publish` : `Moved to ${next.name}`)
    if (ok) onClose()
  }

  const confirmReject = async () => {
    const trimmed = note.trim()
    if (!canConfirmReviewAction('reject', trimmed)) return
    const ok = await act('reject', { note: trimmed }, 'Rejected - the author has your note')
    if (ok) onClose()
  }

  const confirmAssign = async (id: string | null) => {
    const ok = await act('assign', { assigneeId: id }, id ? 'Assigned' : 'Assignee cleared')
    if (ok) { setAssigneeId(id); setMode('view') }
  }

  const enterMode = (next: ReviewModalMode) => { setNote(''); setMode(next) }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="pr-8">Review "{displayTitle}"</DialogTitle>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
            <span className="text-fg-subtle">{row.typeName}</span>
            <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-medium ${badge.className}`}>
              {badge.label}
            </span>
            {workflow.name && <span className="text-fg-subtle">in {workflow.name}</span>}
            {assigneeId ? (
              <span className="flex items-center gap-1.5">
                <InitialsAvatar name={memberName(members ?? null, assigneeId)} seed={assigneeId} />
                <span className="max-w-[160px] truncate">{memberName(members ?? null, assigneeId)}</span>
              </span>
            ) : (
              <span className="text-fg-subtle">Unassigned</span>
            )}
            <Link
              to={editorHref}
              className="inline-flex items-center gap-1 text-accent-fg hover:underline"
            >
              <IconExternalLink className="size-3.5" aria-hidden />
              Open in editor
            </Link>
          </div>
        </DialogHeader>

        {/* Content preview + notes + compact activity */}
        <div className="max-h-[50vh] space-y-4 overflow-y-auto px-6 py-4">
          {returned && (
            <div className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2">
              <p className="text-sm font-medium text-danger-fg">
                Returned to {memberName(members ?? null, row.assigneeId ?? row.submittedBy ?? null)} - address the note and resubmit
              </p>
              <p className="mt-0.5 text-xs text-danger-fg">
                Resubmitting happens in the editor.{' '}
                <Link to={editorHref} className="font-medium underline hover:no-underline">Open in editor</Link>
              </p>
            </div>
          )}
          {stale && (
            <div className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2">
              <p className="text-sm font-medium text-warning-fg">
                Approval is stale - the content changed after it was approved
              </p>
              <p className="mt-0.5 text-xs text-warning-fg">
                Publishing stays blocked until the author resubmits it for review or the edit is reverted.{' '}
                <Link to={editorHref} className="font-medium underline hover:no-underline">Open in editor</Link>
              </p>
            </div>
          )}
          {draft.failed ? (
            <p className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning-fg">
              Could not load the draft - open it in the editor.
            </p>
          ) : draft.loading ? (
            <div className="animate-pulse space-y-2.5" aria-hidden>
              <div className="h-4 w-2/3 rounded bg-surface-hover" />
              <div className="h-3 w-1/3 rounded bg-surface-hover" />
              <div className="h-3 w-full rounded bg-surface-hover" />
              <div className="h-3 w-full rounded bg-surface-hover" />
              <div className="h-3 w-3/4 rounded bg-surface-hover" />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-fg">{draft.title || displayTitle}</p>
                {draft.updatedAt && (
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    Updated{' '}
                    <time dateTime={draft.updatedAt} title={new Date(draft.updatedAt).toLocaleString()}>
                      {relativeTime(draft.updatedAt)}
                    </time>
                  </p>
                )}
              </div>
              {draft.blocks.length === 0 ? (
                <p className="text-xs text-fg-subtle">No text content to preview - open it in the editor for the full form.</p>
              ) : draft.blocks.map((b) => (
                <div key={b.name}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{b.label}</p>
                  <div className="relative mt-1">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{b.text}</p>
                    {b.truncated && (
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface to-transparent" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {lastNote && (
            <blockquote className="rounded-md border-l-2 border-accent/30 bg-surface-sunken px-3 py-2">
              <p className="text-sm text-fg-muted">{lastNote.note}</p>
              <p className="mt-1 text-xs text-fg-subtle">
                {actorName(members ?? null, lastNote.byId, lastNote.actorLabel)}
                {lastNote.at && (
                  <>
                    {' · '}
                    <time dateTime={lastNote.at} title={new Date(lastNote.at).toLocaleString()}>{relativeTime(lastNote.at)}</time>
                  </>
                )}
              </p>
            </blockquote>
          )}

          {recentEvents.length > 0 && (
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Recent activity</p>
                <button
                  type="button"
                  onClick={() => setActivityOpen(true)}
                  className="text-xs text-fg-muted transition-colors hover:text-fg cursor-pointer"
                >
                  Full activity
                </button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {recentEvents.map((event, i) => (
                  <li key={`${event.at}-${i}`} className="flex items-baseline gap-2 text-xs">
                    <span aria-hidden className={cx('size-2 shrink-0 self-center rounded-full', markerClass(event))} />
                    <span className="min-w-0 flex-1 truncate text-fg-muted">{timelineHeadline(event, members ?? null)}</span>
                    <span className="shrink-0 text-fg-subtle">
                      {actorName(members ?? null, event.byId, event.actorLabel)}
                      {event.at && (
                        <>
                          {' · '}
                          <time dateTime={event.at} title={new Date(event.at).toLocaleString()}>{relativeTime(event.at)}</time>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Inline action step (same semantics as the standalone dialogs) */}
        {mode === 'advance' && (
          <div className="border-t border-border px-6 py-4 space-y-2">
            {override && <OverrideNotice stageName={currentStage?.name} roles={row.stageRoles ?? undefined} />}
            <p className="text-xs text-fg-subtle">
              {terminal
                ? 'The item enters the final stage and becomes publishable while unchanged.'
                : 'The item moves to the next stage of the review workflow.'}
            </p>
            <Label htmlFor="review-modal-advance-note">Note (optional)</Label>
            <textarea
              id="review-modal-advance-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void confirmAdvance() }
              }}
              rows={2}
              autoFocus
              maxLength={500}
              placeholder="Add context for the next reviewer - Enter confirms"
              className={NOTE_CLASS}
            />
          </div>
        )}
        {mode === 'reject' && (
          <div className="border-t border-border px-6 py-4 space-y-2">
            {override && <OverrideNotice stageName={currentStage?.name} roles={row.stageRoles ?? undefined} />}
            <p className="text-xs text-fg-subtle">
              The item leaves the review workflow and goes back to the author with your note.
            </p>
            <Label htmlFor="review-modal-reject-note">Note for the author (required)</Label>
            <textarea
              id="review-modal-reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              autoFocus
              maxLength={500}
              placeholder="What needs to change before resubmitting?"
              className={NOTE_CLASS}
            />
          </div>
        )}
        {mode === 'assign' && (
          <div className="border-t border-border px-6 py-4">
            <MemberPickList members={assignable} current={assigneeId} onPick={confirmAssign} />
          </div>
        )}

        <DialogFooter>
          {mode === 'view' && (canAct && !returned && !stale ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => enterMode('assign')}>Assign…</Button>
              <Button variant="ghost" className="text-danger-fg hover:text-danger-fg" disabled={busy} onClick={() => enterMode('reject')}>
                Reject…
              </Button>
              {label && (
                <Button disabled={busy} onClick={() => enterMode('advance')}>{label}</Button>
              )}
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>Close</Button>
          ))}
          {mode === 'advance' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => enterMode('view')}>Cancel</Button>
              <Button disabled={busy} onClick={() => void confirmAdvance()}>
                {busy ? 'Working…' : label ?? 'Advance'}
              </Button>
            </>
          )}
          {mode === 'reject' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => enterMode('view')}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={busy || !canConfirmReviewAction('reject', note)}
                onClick={() => void confirmReject()}
              >
                {busy ? 'Rejecting…' : 'Reject'}
              </Button>
            </>
          )}
          {mode === 'assign' && (
            <Button variant="secondary" disabled={busy} onClick={() => enterMode('view')}>Cancel</Button>
          )}
        </DialogFooter>

        {activityOpen && (
          <ActivityDialog
            title={displayTitle}
            history={row.history}
            workflow={workflow}
            members={members ?? null}
            onClose={() => setActivityOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
