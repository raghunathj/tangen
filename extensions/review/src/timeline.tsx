/**
 * File Name: timeline.tsx
 * Purpose: The Activity modal - one review record's full history as a
 *          vertical timeline: a colored point per event (submit indigo,
 *          stage moves in the stage's color, approve/publish green, reject
 *          red), actor + relative timestamp per point, reviewer notes
 *          quoted under their point, and the per-stage qualification
 *          checklist under Published points (all stages passed, or which
 *          are missing). Chronological, newest last, scrollable. Opened
 *          from the queue rows and the editor panel.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Events derive from the record's history via
 *          timelineEvents (queue-model.ts) - the modal itself fetches
 *          nothing. No em dashes in UI copy.
 */
import { useEffect, useRef } from 'react'
import {
  Button, cx,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/kit'
import { IconCheck, IconWarning } from '@tangen/icons'
import type { HistoryEntry, StageQualification, WorkflowStage } from './state'
import {
  actorName, relativeTime, stageDotClass, timelineEvents, timelineHeadline,
  type MemberOption, type TimelineEvent,
} from './queue-model'

/** The marker fill for a timeline point (stage moves use the stage's color).
 *  Exported for the Review modal's compact activity dots. */
export function markerClass(event: TimelineEvent): string {
  switch (event.kind) {
    case 'submitted': return 'bg-accent'
    case 'approved':
    case 'published': return 'bg-success'
    case 'rejected': return 'bg-danger'
    case 'assigned': return 'bg-fg-faint'
    // A withdrawal is the author stepping back, not a judgement on the work -
    // neutral, deliberately not the red a rejection gets.
    case 'withdrawn': return 'bg-fg-faint'
    case 'moved': return stageDotClass(event.stage?.color)
  }
}

function Marker({ event }: { event: TimelineEvent }) {
  const withCheck = event.kind === 'approved' || event.kind === 'published'
  return (
    <span
      aria-hidden
      className={cx(
        'absolute left-0 top-0.5 inline-flex items-center justify-center rounded-full ring-4 ring-surface',
        withCheck ? 'size-4' : 'size-4 p-1',
        markerClass(event),
      )}
    >
      {withCheck
        ? <IconCheck className="size-3 text-white" />
        : <span className="size-1.5 rounded-full bg-white/90" />}
    </span>
  )
}

/**
 * The publish's per-stage qualification checklist - proves (or flags)
 * whether every workflow stage was passed before the item went live.
 */
function QualificationChecklist({ qualification, members }: { qualification: StageQualification; members: MemberOption[] | null }) {
  const q = qualification
  return (
    <div className="mt-1.5 rounded-md border border-border bg-surface-sunken px-3 py-2">
      {q.complete ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success-fg">
          <IconCheck className="size-3.5 shrink-0" />
          All {q.stages.length} {q.stages.length === 1 ? 'stage' : 'stages'} passed
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-medium text-warning-fg">
          <IconWarning className="size-3.5 shrink-0" />
          Not all stages verified{q.missing?.length ? ` - missing: ${q.missing.join(', ')}` : ''}
        </p>
      )}
      {q.stages.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {q.stages.map((s) => (
            <li key={s.stageId} className="flex items-baseline gap-1.5 text-xs">
              <IconCheck className="size-3 shrink-0 self-center text-success-fg" aria-hidden />
              <span className="font-medium text-fg">{s.name}</span>
              <span className="text-fg-subtle">
                {actorName(members, s.byId, s.actorLabel)}
                {s.at && (
                  <>
                    {' · '}
                    <time dateTime={s.at} title={new Date(s.at).toLocaleString()}>{relativeTime(s.at)}</time>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ActivityDialogProps {
  title?: string
  history: HistoryEntry[]
  workflow: { stages: WorkflowStage[] }
  members: MemberOption[] | null
  onClose: () => void
}

/** One record's review activity, oldest first, auto-scrolled to the latest. */
export function ActivityDialog({ title, history, workflow, members, onClose }: ActivityDialogProps) {
  const events = timelineEvents(history, workflow)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Newest last + scrollable: land the viewport on the latest event.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activity{title ? ` for "${title}"` : ''}</DialogTitle>
          <DialogDescription>
            Everything that happened to this item in review, oldest first.
          </DialogDescription>
        </DialogHeader>
        <div ref={scrollRef} className="max-h-[55vh] overflow-y-auto px-6 py-4">
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-subtle">No review activity yet.</p>
          ) : (
            <ol className="relative ml-2 border-l border-border pl-6">
              {events.map((event, i) => {
                const abs = event.at ? new Date(event.at).toLocaleString() : ''
                return (
                  <li key={`${event.at}-${i}`} className={cx('relative', i < events.length - 1 && 'pb-5')}>
                    <span className="absolute -left-[31px] top-0">
                      <Marker event={event} />
                    </span>
                    <p className="text-sm font-medium text-fg">{timelineHeadline(event, members)}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {actorName(members, event.byId, event.actorLabel)}
                      {event.at && (
                        <>
                          {' · '}
                          <time dateTime={event.at} title={abs}>{relativeTime(event.at)}</time>
                        </>
                      )}
                    </p>
                    {event.note && (
                      <blockquote className="mt-1.5 rounded-md border-l-2 border-border-strong bg-surface-sunken px-3 py-2 text-xs text-fg-muted">
                        {event.note}
                      </blockquote>
                    )}
                    {event.kind === 'published' && event.qualification && (
                      <QualificationChecklist qualification={event.qualification} members={members} />
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
