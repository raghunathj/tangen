/**
 * File Name: queue-model.ts
 * Purpose: Pure view-model helpers shared by the Review queue page, the
 *          Review modal, and the editor panel: tab derivation, action
 *          labeling (Advance reads the NEXT stage's name, "Approve" on
 *          terminal entry), client-side filter + search derivation, the
 *          latest-note extraction, stage badge/dot styling (plus the
 *          Returned badge for rejected-not-resubmitted rows and the
 *          stale-approval marker for edited-after-approval terminal rows),
 *          member-name resolution + initials, relative timestamps, Done-tab
 *          outcome extraction, and the activity-timeline event derivation
 *          the Activity modal renders. Browser-safe.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Kept free of React so bun can unit-test the queue
 *          logic without a DOM (__tests__/queue-model.test.ts).
 */
import {
  isReturned, isTerminal, nextStage, stageById,
  type HistoryEntry, type ReviewRecord, type StageQualification, type WorkflowStage,
} from './state'

export interface QueueRow extends ReviewRecord {
  objectId: string
  /**
   * TERMINAL rows only (the queue route computes it just for them): true
   * when the draft changed after the approval froze the hash - the publish
   * gate would reject this row today. Absent on non-terminal rows.
   */
  stale?: boolean
  /** Can the CALLER act on the stage this row sits in (stage roles applied). */
  canAct?: boolean
  /** They only get in as the owner - the dialogs say so before acting. */
  actingAsOverride?: boolean
  /** The stage's role restriction, for the override notice. */
  stageRoles?: string[] | null
}

export interface MemberOption {
  id: string
  name?: string | null
  email?: string | null
}

export type QueueTab = 'mine' | 'all' | 'done'

/** "Assigned to me" is the landing tab whenever it has items. */
export function resolveDefaultTab(mineCount: number): QueueTab {
  return mineCount > 0 ? 'mine' : 'all'
}

/**
 * The inline advance action's label: the NEXT stage's name - except the hop
 * INTO the terminal stage, which reads "Approve". Null at the terminal
 * stage (nothing left to advance) or off-workflow.
 */
export function advanceActionLabel(wf: { stages: WorkflowStage[] }, stageId: string | null): string | null {
  if (!stageId) return null
  const next = nextStage(wf, stageId)
  if (!next) return null
  return isTerminal(wf, next.id) ? 'Approve' : `Advance to ${next.name}`
}

/** Client-side stage/type/workflow filtering (option lists stay stable while filtered). */
export function filterQueueRows(
  rows: QueueRow[],
  filters: {
    stage?: string; type?: string; workflow?: string
    /** Free-text search - applied with the dropdown filters, never apart. */
    search?: string
    workflows?: Array<{ id: string; name: string; stages: WorkflowStage[] }> | null
    primary?: { stages: WorkflowStage[] }
    members?: MemberOption[] | null
  } = {},
): QueueRow[] {
  const primary = filters.primary ?? { stages: [] }
  return rows.filter((r) =>
    (!filters.stage || r.stageId === filters.stage) &&
    (!filters.type || r.typeName === filters.type) &&
    (!filters.workflow || rowWorkflowId(r) === filters.workflow) &&
    (!filters.search?.trim() ||
      matchesQueueSearch(r, filters.search, workflowForRow(filters.workflows ?? null, r, primary), filters.members ?? null)))
}

/** Rows per request - the queue route's maximum page size. */
export const QUEUE_PAGE_LIMIT = 200

/** Hard ceiling on a scope, so a runaway queue cannot hang the page. */
export const QUEUE_MAX_ROWS = 2000

export interface QueuePage {
  data: QueueRow[]
  meta: { total: number }
}

/**
 * L3 - the queue route paginates (limit/offset/total), and it defaults to 50.
 * The page previously took that default and then paginated CLIENT-side over
 * it, so a queue deeper than 50 items silently showed the first 50 and
 * reported that as the total.
 *
 * Filtering and search stay client-side because they are richer than the
 * route: search matches assignee and submitter NAMES, which only the admin
 * (holding the member list) can resolve, and staleness, which the route
 * computes only for the rows it returns. Filtering server-side would
 * silently drop both. So the scope is fetched WHOLE, one request per page,
 * and every existing filter/search/pagination semantic is preserved exactly.
 *
 * `truncated` says the scope exceeded QUEUE_MAX_ROWS and the caller is
 * looking at a prefix - surfaced in the UI rather than hidden.
 */
export async function fetchQueueScope(
  fetchPage: (limit: number, offset: number) => Promise<QueuePage>,
): Promise<{ rows: QueueRow[]; total: number; truncated: boolean }> {
  const first = await fetchPage(QUEUE_PAGE_LIMIT, 0)
  const total = first.meta?.total ?? first.data.length
  const rows = [...first.data]
  const reachable = Math.min(total, QUEUE_MAX_ROWS)

  // A short page means the server has nothing more, whatever total claims.
  while (rows.length < reachable && first.data.length > 0) {
    const next = await fetchPage(QUEUE_PAGE_LIMIT, rows.length)
    if (next.data.length === 0) break
    rows.push(...next.data)
  }
  return { rows: rows.slice(0, QUEUE_MAX_ROWS), total, truncated: total > QUEUE_MAX_ROWS }
}

/**
 * The workflow a row belongs to. Records written before v3 carry no
 * workflowId; they belong to the migrated default (wf_default), which is
 * exactly what the server backfills them to.
 */
export function rowWorkflowId(row: Pick<QueueRow, 'workflowId'>): string {
  return row.workflowId ?? 'wf_default'
}

/**
 * The row's workflow definition out of the set the queue loaded - used for
 * its stages (badge, advance label) and its name. Falls back to the primary
 * definition when a record's workflow is gone.
 */
export function workflowForRow(
  workflows: Array<{ id: string; name: string; stages: WorkflowStage[] }> | null,
  row: Pick<QueueRow, 'workflowId'>,
  fallback: { stages: WorkflowStage[] },
): { id?: string; name?: string; stages: WorkflowStage[] } {
  const hit = workflows?.find((w) => w.id === rowWorkflowId(row))
  return hit ?? fallback
}

/** Distinct type names across the loaded rows, sorted, for the type filter. */
export function distinctTypes(rows: QueueRow[]): string[] {
  return [...new Set(rows.map((r) => r.typeName).filter(Boolean))].sort()
}

/**
 * The queue's client-side search predicate - a case-insensitive substring
 * match over everything a reviewer would type to find a row: title, type
 * name, current stage name (or "Returned" for a returned row, "Stale" for
 * a stale terminal one), assignee name, and submitter name. An empty query
 * matches everything.
 */
export function matchesQueueSearch(
  row: QueueRow, query: string, wf: { stages: WorkflowStage[] }, members: MemberOption[] | null,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    row.title ?? '',
    row.typeName ?? '',
    stageById(wf, row.stageId)?.name ?? '',
    isReturned(row) ? 'Returned' : '',
    isStaleRow(row) ? 'Stale' : '',
    row.assigneeId ? memberName(members, row.assigneeId) : '',
    row.submittedBy ? memberName(members, row.submittedBy) : '',
  ].join(' ').toLowerCase()
  return haystack.includes(q)
}

/** Stage badge classes per workflow color (light tint + border, dark-safe). */
export const STAGE_BADGE_CLASS: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  pink: 'bg-pink-50 text-pink-700 border-pink-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  red: 'bg-red-50 text-red-600 border-red-200',
}

export function stageBadgeClass(wf: { stages: WorkflowStage[] }, stageId: string | null): string {
  const stage = stageById(wf, stageId)
  return STAGE_BADGE_CLASS[stage?.color ?? ''] ?? STAGE_BADGE_CLASS.gray
}

/** The Returned badge tint - a red/amber alert, distinct from the stage pills. */
export const RETURNED_BADGE_CLASS = 'bg-red-50 text-red-700 border-red-200'

/** Tooltip for the stale marker on a terminal row's stage pill. No em dashes. */
export const STALE_TOOLTIP = 'Approval is stale - content changed after approval'

/**
 * A terminal-stage row whose approval went stale (the queue route computes
 * `stale` for terminal rows only, so a stray flag off-stage never renders).
 */
export function isStaleRow(row: Pick<QueueRow, 'stageId' | 'stale'>): boolean {
  return !!row.stageId && row.stale === true
}

/**
 * What a queue row's status badge shows: a "Returned" alert for a rejected
 * row awaiting the author's resubmit, otherwise the current stage's pill
 * ("In review" when the stage no longer exists).
 */
export function queueBadge(
  wf: { stages: WorkflowStage[] }, row: Pick<QueueRow, 'stageId' | 'rejectedNote'>,
): { label: string; className: string } {
  if (isReturned(row)) return { label: 'Returned', className: RETURNED_BADGE_CLASS }
  return { label: stageById(wf, row.stageId)?.name ?? 'In review', className: stageBadgeClass(wf, row.stageId) }
}

/** Solid swatch/marker fill per workflow color (timeline dots, color pickers). */
export const STAGE_DOT_CLASS: Record<string, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  teal: 'bg-teal-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
}

export function stageDotClass(color: string | undefined): string {
  return STAGE_DOT_CLASS[color ?? ''] ?? STAGE_DOT_CLASS.gray
}

/** Up to two initials from a display name or email, for avatar chips. */
export function initials(name: string): string {
  const cleaned = name.trim()
  if (!cleaned) return '?'
  const words = cleaned.split(/[\s._@-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

/**
 * Compact "2h ago" style timestamps for the queue. Falls back to the local
 * date beyond a week; callers put the absolute time in a title attribute.
 */
export function relativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString()
}

/** Display name for a member id; ids the directory no longer knows read as a former member. */
export function memberName(members: MemberOption[] | null, id: string | null | undefined): string {
  if (!id) return 'Unassigned'
  const m = members?.find((x) => x.id === id)
  if (m) return m.name || m.email || m.id
  // Directory unavailable (no manage:members) - show the id rather than lying.
  if (!members) return id
  return 'Former member'
}

/**
 * The actor line for a history entry / timeline event: the member's name, or
 * for byId null the entry's actorLabel (a Flow action writes
 * 'Flow: <flow name>'), falling back to 'System' for platform moves.
 */
export function actorName(
  members: MemberOption[] | null, byId: string | null | undefined, actorLabel?: string | null,
): string {
  if (byId) return memberName(members, byId)
  return actorLabel || 'System'
}

export interface DoneOutcome {
  kind: 'published' | 'rejected' | 'withdrawn'
  at: string
  byId: string | null
  /** Non-member actor label from the closing entry (e.g. 'Flow: <name>'). */
  actorLabel?: string
  note?: string
  /** Published only - the per-stage qualification snapshot of that cycle. */
  qualification?: StageQualification
}

/** What closed a completed cycle - from the last leave-review history entry. */
export function doneOutcome(record: ReviewRecord): DoneOutcome | null {
  for (let i = record.history.length - 1; i >= 0; i--) {
    const e = record.history[i]
    if (e.to === null && e.from !== e.to) {
      if (e.note === 'Published') {
        return { kind: 'published', at: e.at, byId: e.byId, actorLabel: e.actorLabel, qualification: e.qualification }
      }
      if (e.withdrawn) return { kind: 'withdrawn', at: e.at, byId: e.byId, actorLabel: e.actorLabel, note: e.note }
      return { kind: 'rejected', at: e.at, byId: e.byId, actorLabel: e.actorLabel, note: e.note }
    }
  }
  return null
}

/** One-line description of a history entry for the panel's compact history. */
export function describeHistoryEntry(
  entry: HistoryEntry, wf: { stages: WorkflowStage[] }, members: MemberOption[] | null,
): string {
  const by = actorName(members, entry.byId, entry.actorLabel)
  if (entry.from === entry.to && entry.from !== null) {
    return entry.assigneeId
      ? `${by} assigned it to ${memberName(members, entry.assigneeId)}`
      : `${by} cleared the assignee`
  }
  if (entry.to === null) {
    if (entry.note === 'Published') return `${by} published it`
    // A withdrawal shares this shape with a rejection - without the marker
    // the timeline would report an author pulling back their own work as
    // having been rejected by themselves.
    if (entry.withdrawn) return `${by} withdrew it from review${entry.note ? `: ${entry.note}` : ''}`
    const returned = entry.assigneeId ? ` and returned it to ${memberName(members, entry.assigneeId)}` : ''
    return `${by} rejected it${returned}${entry.note ? `: ${entry.note}` : ''}`
  }
  const toName = stageById(wf, entry.to)?.name ?? entry.to
  if (entry.from === null) return `${by} submitted it to ${toName}`
  if (entry.note === 'Stage removed') return `Moved to ${toName} (stage removed)`
  return `${by} moved it to ${toName}`
}

// ── Activity timeline ────────────────────────────────────────────────────────

export type TimelineKind = 'submitted' | 'moved' | 'approved' | 'rejected' | 'assigned' | 'published' | 'withdrawn'

/** Sentinel notes the server writes - never quoted as reviewer prose. */
export const SYSTEM_NOTES = ['Published', 'Stage removed']

export interface TimelineEvent {
  kind: TimelineKind
  at: string
  byId: string | null
  /** Non-member actor label (e.g. 'Flow: <name>') - shown when byId is null. */
  actorLabel?: string
  /** Target stage for submitted/moved/approved; null when it no longer exists. */
  stage: WorkflowStage | null
  /**
   * Assignment target (assigned; null = assignee cleared), or the author a
   * rejection returned the item to (rejected; absent on legacy entries).
   */
  assigneeId?: string | null
  /** Human note to quote under the point (system sentinels stripped). */
  note?: string
  /** Published only - whether all stages were qualified before the publish. */
  qualification?: StageQualification
}

/**
 * Maps a record's history to timeline events, chronological (newest LAST).
 * Kind derivation: from === to is an assignment; to === null closed the
 * cycle ('Published' sentinel vs a rejection); otherwise entering the
 * terminal stage is an approval, entering the first stage is a (re)submit
 * (advance never moves backward - only stage removal does, and that carries
 * its sentinel note), and everything else is a stage move.
 */
export function timelineEvents(history: HistoryEntry[], wf: { stages: WorkflowStage[] }): TimelineEvent[] {
  const first = wf.stages[0]
  return history.map((e): TimelineEvent => {
    const base = { at: e.at, byId: e.byId, ...(e.actorLabel ? { actorLabel: e.actorLabel } : {}) }
    const note = e.note && !SYSTEM_NOTES.includes(e.note) ? e.note : undefined
    if (e.from === e.to && e.from !== null) {
      return { ...base, kind: 'assigned', stage: stageById(wf, e.to), assigneeId: e.assigneeId ?? null, note }
    }
    if (e.to === null) {
      if (e.note === 'Published') return { ...base, kind: 'published', stage: null, qualification: e.qualification }
      if (e.withdrawn) return { ...base, kind: 'withdrawn', stage: null, note }
      return { ...base, kind: 'rejected', stage: null, note, ...(e.assigneeId ? { assigneeId: e.assigneeId } : {}) }
    }
    const stage = stageById(wf, e.to)
    if (e.note === 'Stage removed') return { ...base, kind: 'moved', stage }
    if (e.from === null || e.to === first?.id) return { ...base, kind: 'submitted', stage, note }
    if (isTerminal(wf, e.to)) return { ...base, kind: 'approved', stage, note }
    return { ...base, kind: 'moved', stage, note }
  })
}

/**
 * The most recent human note on the record's SUBMIT/ADVANCE/REJECT path -
 * what the Review modal quotes prominently before the reviewer acts.
 * Assignment notes and system sentinels never surface here.
 */
export function latestReviewNote(
  history: HistoryEntry[], wf: { stages: WorkflowStage[] },
): { note: string; byId: string | null; actorLabel?: string; at: string; kind: TimelineKind } | null {
  const events = timelineEvents(history, wf)
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.note && e.kind !== 'assigned') return { note: e.note, byId: e.byId, actorLabel: e.actorLabel, at: e.at, kind: e.kind }
  }
  return null
}

/** The timeline point's headline, member names resolved by the caller's directory. */
export function timelineHeadline(event: TimelineEvent, members: MemberOption[] | null): string {
  switch (event.kind) {
    case 'submitted': return `Submitted to ${event.stage?.name ?? 'review'}`
    case 'moved': return `Moved to ${event.stage?.name ?? 'a removed stage'}`
    case 'approved': return `Approved - entered ${event.stage?.name ?? 'the final stage'}`
    case 'rejected': return event.assigneeId
      ? `Rejected and returned to ${memberName(members, event.assigneeId)}`
      : 'Rejected'
    case 'assigned': return event.assigneeId ? `Assigned to ${memberName(members, event.assigneeId)}` : 'Assignee cleared'
    case 'published': return 'Published'
    case 'withdrawn': return 'Withdrawn from review'
  }
}


/**
 * What a scheduled publish means for an item still in review. The gate blocks
 * the scheduler's auto-publish exactly like any other publish, so a scheduled
 * item that is not approved by its due time simply does not go out - and until
 * now that failure was a log line nobody reads.
 *
 * `approved` is "sitting in the terminal stage with an approval that still
 * matches the content". Pure so the wording is pinned by tests rather than
 * living in JSX.
 */
export interface ScheduleWarning {
  tone: 'info' | 'warning' | 'danger'
  text: string
}

export function scheduleWarning(input: {
  status?: string
  scheduledAt?: string | null
  approved: boolean
  /** Now, injected so the boundary is testable. */
  now: Date
}): ScheduleWarning | null {
  if (input.status !== 'scheduled' || !input.scheduledAt) return null
  const due = new Date(input.scheduledAt)
  if (Number.isNaN(due.getTime())) return null
  const when = due.toLocaleString()

  if (input.approved) {
    return { tone: 'info', text: `Approved and scheduled to publish on ${when}.` }
  }
  if (due.getTime() <= input.now.getTime()) {
    return {
      tone: 'danger',
      text: `This missed its scheduled publish on ${when} because review was not complete. It publishes on the next run once approved.`,
    }
  }
  return {
    tone: 'warning',
    text: `Scheduled to publish on ${when}. Review has to be complete by then or it will not go out.`,
  }
}
