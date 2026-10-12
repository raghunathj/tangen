/**
 * File Name: state.ts
 * Purpose: The review v2 state model - the multi-stage workflow definition,
 *          per-object review records (stage + assignee + history), the lazy
 *          v1 -> v2 record migration, and the mirrored label names. The
 *          LAST stage of a workflow is terminal ("ready to publish").
 *          Browser-safe (types + pure functions only).
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Review state lives in extension_data keyed by the
 *          OBJECT ID, so the admin routes (ctx.store) and the content hooks
 *          (ctx.extensionData.get('review', objectId)) read the same rows.
 *          The workflow definition shares the store under WORKFLOW_KEY.
 *          stageId === null means "not in review" - a plain draft, a
 *          rejected draft returned to its author (rejectedNote set, see
 *          isReturned), or a completed cycle (history retained for the
 *          queue's Done tab).
 */

export const EXTENSION_ID = 'review'

/** Store key for the per-workspace options mirror (never collides with object-id keys). */
/** The pre-E.7 mirror of the install option; carried into the settings seed at START and removed (coverage.ts). */
export const OPTIONS_KEY = '__options__'

/** Store key for the admin-configurable workflow definition. */
export const WORKFLOW_KEY = '__workflow__'

/** History entries kept per record (oldest dropped first). */
export const HISTORY_CAP = 30

// ── Workflow definition ──────────────────────────────────────────────────────

export interface WorkflowStage {
  /** Stable id - survives renames; referenced by records and history. */
  id: string
  name: string
  /** One of STAGE_COLORS (see workflow.ts). */
  color: string
  /**
   * Roles allowed to advance or reject at this stage.
   *
   * `null` or absent = NEVER restricted (every stage before this feature),
   * so anyone holding review:approve acts, exactly as before. `[]` = a real
   * restriction that currently names nobody, so only the owner acts.
   *
   * The two must never collapse into each other: if deleting a role emptied
   * a list and that read as "unrestricted", broken config would silently
   * WIDEN a permission. See canActOnStage in workflow.ts.
   */
  roles?: string[] | null
}

export interface WorkflowDefinition {
  /** The owning workflow's id (v3 sets); absent on bare v2-shaped definitions. */
  id?: string
  /** The owning workflow's name - shown once a workspace runs more than one. */
  name?: string
  /** Ordered; the LAST stage is terminal ("ready to publish"). Min 2. */
  stages: WorkflowStage[]
  /** Covered type names; null = all types. */
  coveredTypes: string[] | null
  /** True once an admin saved the workflow - until then coveredTypes follows the code option. */
  configured: boolean
}

/** The seed workflow - equivalent to the v1 pending/approved semantics. */
export const DEFAULT_STAGES: WorkflowStage[] = [
  { id: 'stg_review', name: 'Review', color: 'amber' },
  { id: 'stg_approved', name: 'Approved', color: 'green' },
]

export function terminalStage(wf: Pick<WorkflowDefinition, 'stages'>): WorkflowStage {
  return wf.stages[wf.stages.length - 1]
}

export function stageById(wf: Pick<WorkflowDefinition, 'stages'>, id: string | null | undefined): WorkflowStage | null {
  if (!id) return null
  return wf.stages.find((s) => s.id === id) ?? null
}

/** The stage after `stageId`, or null when terminal/unknown. */
export function nextStage(wf: Pick<WorkflowDefinition, 'stages'>, stageId: string): WorkflowStage | null {
  const idx = wf.stages.findIndex((s) => s.id === stageId)
  if (idx === -1 || idx >= wf.stages.length - 1) return null
  return wf.stages[idx + 1]
}

export function isTerminal(wf: Pick<WorkflowDefinition, 'stages'>, stageId: string | null | undefined): boolean {
  return !!stageId && terminalStage(wf).id === stageId
}

// ── Per-object review record ─────────────────────────────────────────────────

export interface HistoryEntry {
  /** Stage ids; null = not in review. from === to marks an assignment entry. */
  from: string | null
  to: string | null
  /** Acting member id (null for system moves, e.g. the publish reset). */
  byId: string | null
  /**
   * Display label for a non-member actor - a Flow action writes byId null +
   * actorLabel 'Flow: <flow name>' so timelines attribute the move honestly.
   * Renderers prefer it over 'System' whenever byId is null.
   */
  actorLabel?: string
  /**
   * The actor's role for this environment at the moment they acted, so a
   * timeline can say in WHAT capacity a stage was qualified rather than
   * leaving it to be inferred from the name.
   */
  role?: string | null
  /**
   * The actor got in only because they are the owner, not because the stage
   * named their role. Per-stage roles exist to make the trail mean
   * something; an override that looked like an ordinary sign-off would
   * defeat that.
   */
  override?: boolean
  /**
   * The author pulled their OWN item out of review (R5). Shares the
   * `to: null` shape with a rejection, so it needs its own marker or every
   * timeline would report a self-withdrawal as "rejected by <the author>".
   */
  withdrawn?: boolean
  at: string
  /** Reject note / optional advance or assign note / stage-deletion marker / 'Published'. */
  note?: string
  /**
   * Set on assignment entries - the assignee after the change (null =
   * unassigned) - and on rejection entries - the author the item was
   * returned to.
   */
  assigneeId?: string | null
  /** Set on 'Published' entries - the per-stage qualification snapshot of that cycle. */
  qualification?: StageQualification
}

// ── Publish qualification snapshot ──────────────────────────────────────────

/** One stage's pass evidence: who advanced the item out of it (or into the terminal stage) and when. */
export interface QualifiedStage {
  stageId: string
  /** Name snapshot at publish time - stable even if the stage is later renamed/deleted. */
  name: string
  byId: string | null
  /** Non-member actor label carried over from the qualifying history entry (e.g. 'Flow: <name>'). */
  actorLabel?: string
  at: string
}

/**
 * Whether ALL workflow stages were qualified before a publish - frozen onto
 * the 'Published' history entry so the timeline can prove the chain later.
 */
export interface StageQualification {
  /** The workflow this cycle ran under (v3 sets) - frozen with the proof. */
  workflowId?: string
  /** Its name at publish time, stable even if the workflow is later renamed. */
  workflowName?: string
  /** Stages that WERE passed this cycle, in workflow order. */
  stages: QualifiedStage[]
  /** True when every stage of the workflow (at publish time) has evidence. */
  complete: boolean
  /** Names of stages with no evidence - possible after mid-cycle workflow edits. */
  missing?: string[]
}

/**
 * Computes the qualification snapshot for the CURRENT cycle from a record's
 * history against the workflow's stages at this moment. A cycle = history
 * since the most recent submit (an entry into the first stage that is not a
 * stage-removal move, or the original from-null submit). Evidence per
 * stage: the advance that LEFT it (non-terminal) or ENTERED it (terminal);
 * rejections, assignments, and forced stage-removal moves never qualify.
 * Gaps happen when the workflow was edited mid-cycle (a stage added after
 * the item passed that point, or stage-deletion reassignment) - those stage
 * names land in `missing` and `complete` goes false.
 */
export function computeQualification(
  history: HistoryEntry[],
  wf: Pick<WorkflowDefinition, 'stages'> & Partial<Pick<WorkflowDefinition, 'id' | 'name'>>,
): StageQualification {
  const first = wf.stages[0]
  const terminal = terminalStage(wf)

  // Find the cycle boundary: the most recent submit entry.
  let start = -1
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    const isSubmit = e.to !== null && e.from !== e.to && e.note !== 'Stage removed' &&
      (e.from === null || e.to === first?.id)
    if (isSubmit) { start = i; break }
  }
  // Evidence never comes from the submit entry itself (a resubmit FROM a
  // stage must not read as having passed it).
  const evidence = start >= 0 ? history.slice(start + 1) : [...history]

  const qualified: QualifiedStage[] = []
  const missing: string[] = []
  for (const stage of wf.stages) {
    const isTerminalStage = stage.id === terminal.id
    let found: HistoryEntry | undefined
    for (let i = evidence.length - 1; i >= 0; i--) {
      const e = evidence[i]
      if (e.from === e.to || e.note === 'Stage removed') continue
      if (isTerminalStage ? e.to === stage.id : (e.from === stage.id && e.to !== null)) { found = e; break }
    }
    if (found) {
      qualified.push({
        stageId: stage.id, name: stage.name, byId: found.byId, at: found.at,
        ...(found.actorLabel ? { actorLabel: found.actorLabel } : {}),
      })
    } else missing.push(stage.name)
  }
  return {
    ...(wf.id ? { workflowId: wf.id } : {}),
    ...(wf.name ? { workflowName: wf.name } : {}),
    stages: qualified,
    complete: missing.length === 0,
    ...(missing.length > 0 ? { missing } : {}),
  }
}

/** One object's review record (extension_data, key = objectId). */
export interface ReviewRecord {
  /** Current stage; null = not in review. */
  stageId: string | null
  /** The object's content type - needed by the queue + label entity type. */
  typeName: string
  /**
   * The workflow this cycle was submitted under (v3). An in-flight cycle
   * completes under it even if the type is reassigned to another workflow
   * mid-flight; absent on v2 records, which backfill lazily (workflows.ts
   * recordWorkflowId).
   */
  workflowId?: string
  /** Title snapshot (refreshed on transitions), for the queue listing. */
  title?: string
  assigneeId: string | null
  submittedBy: string
  submittedAt: string
  /** Bumped on every transition - the queue sorts by it. */
  updatedAt: string
  /** Content hash frozen on ENTERING the terminal stage; publish requires a match. */
  approvedHash?: string
  /** The reviewer's required note from the last rejection. */
  rejectedNote?: string
  history: HistoryEntry[]
}

/** Append an entry, keeping at most HISTORY_CAP (newest kept). */
export function pushHistory(history: HistoryEntry[] | undefined, entry: HistoryEntry): HistoryEntry[] {
  const next = [...(history ?? []), entry]
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next
}

/**
 * A record the reviewer sent back to the author and the author has not
 * resubmitted yet: rejection returns the item (assignee = the cycle's
 * submitter), so it stays visible in the queue's active tabs instead of
 * vanishing. Both resubmitting and a completed publish clear rejectedNote,
 * which ends the returned state.
 */
export function isReturned(rec: Pick<ReviewRecord, 'stageId' | 'rejectedNote'> | null | undefined): boolean {
  return !!rec && rec.stageId === null && !!rec.rejectedNote
}

/**
 * The actor of the record's most recent rejection - the reviewer a resubmit
 * defaults its assignee back to. Null when no rejection closed a cycle (a
 * publish carries the 'Published' sentinel and never counts).
 */
export function lastRejectedBy(history: HistoryEntry[] | undefined): string | null {
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    const e = history![i]
    if (e.to === null && e.from !== e.to && e.note !== 'Published') return e.byId
  }
  return null
}

// ── Mirrored operational labels (entity `content:<typeName>`, one at a time) ─

export const REVIEW_LABELS = {
  pending: 'review:pending',
  approved: 'review:approved',
  rejected: 'review:rejected',
} as const

export type ReviewLabelKey = keyof typeof REVIEW_LABELS

export const ALL_REVIEW_LABELS: string[] = Object.values(REVIEW_LABELS)

/**
 * Which mirrored label a record carries: any non-terminal stage -> pending,
 * the terminal stage -> approved, null with a reject note -> rejected,
 * anything else (plain draft / completed cycle) -> none.
 */
export function labelForRecord(wf: Pick<WorkflowDefinition, 'stages'>, rec: ReviewRecord | null): ReviewLabelKey | null {
  if (!rec) return null
  if (rec.stageId) return isTerminal(wf, rec.stageId) ? 'approved' : 'pending'
  return rec.rejectedNote ? 'rejected' : null
}

// ── Lazy v1 -> v2 record migration ──────────────────────────────────────────

interface V1Record {
  state: 'pending' | 'approved' | 'rejected'
  typeName?: string
  title?: string
  submittedBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  reason?: string
  approvedHash?: string
}

function isV1Record(raw: Record<string, unknown>): raw is Record<string, unknown> & V1Record {
  return typeof raw.state === 'string' && !('stageId' in raw)
}

function isV2Record(raw: Record<string, unknown>): boolean {
  return 'stageId' in raw && Array.isArray(raw.history)
}

/**
 * Normalizes whatever is stored under an object id into a v2 record.
 * v1 records map: pending -> the first stage, approved -> the terminal
 * stage (existing approvedHash kept), rejected -> null with the note
 * preserved. Idempotent - a v2 record passes through unchanged, anything
 * unrecognized reads as "no record". Callers persist when `changed`.
 */
export function migrateRecord(
  raw: Record<string, unknown> | undefined | null,
  wf: Pick<WorkflowDefinition, 'stages'>,
): { record: ReviewRecord | null; changed: boolean } {
  if (!raw || Object.keys(raw).length === 0) return { record: null, changed: false }
  if (isV2Record(raw)) return { record: raw as unknown as ReviewRecord, changed: false }
  if (!isV1Record(raw)) return { record: null, changed: false }

  const first = wf.stages[0]
  const terminal = terminalStage(wf)
  const submittedAt = String(raw.submittedAt ?? new Date().toISOString())
  const submittedBy = String(raw.submittedBy ?? '')
  const base: ReviewRecord = {
    stageId: null,
    typeName: String(raw.typeName ?? ''),
    title: typeof raw.title === 'string' ? raw.title : undefined,
    assigneeId: null,
    submittedBy,
    submittedAt,
    updatedAt: String(raw.reviewedAt ?? submittedAt),
    history: [{ from: null, to: first.id, byId: submittedBy || null, at: submittedAt }],
  }

  if (raw.state === 'pending') {
    return { record: { ...base, stageId: first.id }, changed: true }
  }
  if (raw.state === 'approved') {
    return {
      record: {
        ...base,
        stageId: terminal.id,
        approvedHash: typeof raw.approvedHash === 'string' ? raw.approvedHash : undefined,
        history: pushHistory(base.history, {
          from: first.id, to: terminal.id,
          byId: raw.reviewedBy ? String(raw.reviewedBy) : null,
          at: String(raw.reviewedAt ?? submittedAt),
        }),
      },
      changed: true,
    }
  }
  // rejected -> not in review, note preserved
  const note = typeof raw.reason === 'string' && raw.reason ? raw.reason : undefined
  return {
    record: {
      ...base,
      stageId: null,
      rejectedNote: note,
      history: pushHistory(base.history, {
        from: first.id, to: null,
        byId: raw.reviewedBy ? String(raw.reviewedBy) : null,
        at: String(raw.reviewedAt ?? submittedAt),
        note,
      }),
    },
    changed: true,
  }
}
