/**
 * File Name: release-lifecycle.ts
 * Purpose: The one canonical place a release changes status (closure plan
 *          Phase 5B, Unit 2): DRAFT -> IN_REVIEW -> APPROVED -> APPLYING ->
 *          APPLIED | FAILED, with IN_REVIEW -> DRAFT (withdraw) and FAILED
 *          -> APPLYING (retry). Every transition is a conditional update
 *          that succeeds only from an allowed status, so two actors racing
 *          the same step cannot both win, and every transition writes a
 *          release_history row with the actor, the time, the environments
 *          and their roles.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Pure rules (`RELEASE_TRANSITIONS`, `assertTransition`)
 *          plus the SQL that enforces them. No route may set a status by
 *          hand; the routes call `transitionRelease` (or the higher-level
 *          services that do) and translate `ReleaseStateError` to 409.
 */
import { randomBytes } from 'node:crypto'

export const RELEASE_STATUSES = ['draft', 'in_review', 'approved', 'applying', 'applied', 'failed'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

export type ReleaseAction = 'submit' | 'withdraw' | 'approve' | 'apply' | 'retry' | 'applied' | 'apply-failed' | 'unapprove'

/** Every allowed transition, by the action that performs it. Nothing else moves a release. */
export const RELEASE_TRANSITIONS: ReadonlyArray<{ action: ReleaseAction; from: ReleaseStatus; to: ReleaseStatus }> = [
  { action: 'submit', from: 'draft', to: 'in_review' },
  { action: 'withdraw', from: 'in_review', to: 'draft' },
  { action: 'approve', from: 'in_review', to: 'approved' },
  /** An approval withdrawn before application: back to draft, the frozen payload discarded. */
  { action: 'unapprove', from: 'approved', to: 'draft' },
  { action: 'apply', from: 'approved', to: 'applying' },
  { action: 'retry', from: 'failed', to: 'applying' },
  { action: 'applied', from: 'applying', to: 'applied' },
  { action: 'apply-failed', from: 'applying', to: 'failed' },
]

export function isReleaseStatus(v: unknown): v is ReleaseStatus {
  return typeof v === 'string' && (RELEASE_STATUSES as readonly string[]).includes(v)
}

/** The transition an action performs from a status, or null when the action is not allowed there. */
export function transitionFor(action: ReleaseAction, from: ReleaseStatus): { to: ReleaseStatus } | null {
  const t = RELEASE_TRANSITIONS.find((x) => x.action === action && x.from === from)
  return t ? { to: t.to } : null
}

export class ReleaseStateError extends Error {
  readonly status = 409
  constructor(readonly releaseId: string, readonly action: ReleaseAction, readonly current: ReleaseStatus | null, message?: string) {
    super(message ?? (current === null
      ? `release ${releaseId} not found`
      : `release ${releaseId} cannot ${action} while ${current}: allowed from ${RELEASE_TRANSITIONS.filter((t) => t.action === action).map((t) => t.from).join(', ') || 'nowhere'}`))
  }
}

export type LifecycleExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export interface TransitionInput {
  releaseId: string
  workspaceId: string
  action: ReleaseAction
  actor: string | null
  reason?: string | null
  /** Extra columns the transition sets on the release, e.g. approved_at / approved_checksum. */
  set?: Record<string, unknown>
  /** What the history row records beyond the transition. */
  history?: { checksum?: string | null; counts?: Record<string, unknown> | null; errorId?: string | null; errorSummary?: string | null; attempt?: number }
}

export interface TransitionResult {
  from: ReleaseStatus
  to: ReleaseStatus
  historyId: string
}

const COLUMN = /^[a-z_]+$/

/**
 * Performs one transition atomically: an UPDATE conditioned on the current
 * status being one the action allows. Zero rows updated means another
 * actor moved the release first (or it never existed): a ReleaseStateError
 * naming the status it is in now. On success one release_history row.
 */
export async function transitionRelease(exec: LifecycleExec, input: TransitionInput): Promise<TransitionResult> {
  const allowed = RELEASE_TRANSITIONS.filter((t) => t.action === input.action)
  if (allowed.length === 0) throw new ReleaseStateError(input.releaseId, input.action, null, `unknown release action ${input.action}`)
  const to = allowed[0]!.to
  const froms = allowed.map((t) => t.from)
  const extra = Object.entries(input.set ?? {})
  for (const [k] of extra) if (!COLUMN.test(k)) throw new Error(`release column ${k} is not settable`)
  const sets = ['status = $1', ...extra.map(([k], i) => `${k} = $${i + 4}`)]
  const rows = await exec(
    `UPDATE releases SET ${sets.join(', ')}
      WHERE id = $2 AND workspace_id = $3 AND status = ANY($${extra.length + 4}::text[])
      RETURNING id, attempts,
        (SELECT r2.status FROM releases r2 WHERE r2.id = releases.id) AS new_status`,
    // Bound as text: a Date reaches the driver as ISO text, never as an object it cannot encode.
    [to, input.releaseId, input.workspaceId, ...extra.map(([, v]) => (v instanceof Date ? v.toISOString() : v)), froms],
  )
  if (rows.length === 0) {
    const current = await exec(`SELECT status FROM releases WHERE id = $1 AND workspace_id = $2`, [input.releaseId, input.workspaceId])
    const status = current[0]?.status
    throw new ReleaseStateError(input.releaseId, input.action, isReleaseStatus(status) ? status : null)
  }
  const r = rows[0]!
  // The status we came from is the one the action allows that is not `to`; with one allowed `from` it is that one.
  const fromStatus = froms.length === 1 ? froms[0]! : (froms.find((f) => f !== to) ?? froms[0]!)
  const historyId = await recordReleaseHistory(exec, {
    releaseId: input.releaseId, workspaceId: input.workspaceId, action: input.action, from: fromStatus, to, actor: input.actor,
    reason: input.reason ?? null,
    ...input.history, attempt: input.history?.attempt ?? Number(r.attempts ?? 0),
  })
  return { from: fromStatus, to, historyId }
}

export interface HistoryInput {
  releaseId: string
  workspaceId: string
  /** A transition's action, or a recorded non-transition such as `preflight-failed`. */
  action: string
  from: ReleaseStatus | null
  to: ReleaseStatus
  actor: string | null
  reason?: string | null
  attempt?: number
  checksum?: string | null
  counts?: Record<string, unknown> | null
  errorId?: string | null
  errorSummary?: string | null
}


/** One release_history row. Transitions write one; so does a preflight that refused (status unchanged, from = to). */
let historySeq = 0
/** Time-sortable ids: rows written in the same instant still read back in the order they were written. */
function nextHistoryId(): string {
  historySeq = (historySeq + 1) & 0xffff
  return `rh_${Date.now().toString(16).padStart(12, '0')}${historySeq.toString(16).padStart(4, '0')}${randomBytes(4).toString('hex')}`
}

export async function recordReleaseHistory(exec: LifecycleExec, h: HistoryInput): Promise<string> {
  const historyId = nextHistoryId()
  await exec(
    `INSERT INTO release_history (id, release_id, workspace_id, attempt, action, from_status, to_status, actor, checksum, counts, error_id, error_summary, reason, started_at, finished_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, clock_timestamp(), clock_timestamp())`,
    [historyId, h.releaseId, h.workspaceId, h.attempt ?? 0, h.action, h.from, h.to, h.actor,
      h.checksum ?? null, h.counts ? JSON.stringify(h.counts) : null, h.errorId ?? null, h.errorSummary ?? null, h.reason ?? null],
  )
  return historyId
}

/** The executor over a drizzle client (postgres.js or PGlite), as the install-state service does it. */
export function lifecycleExecFromDb(db: unknown): LifecycleExec {
  const d = db as { $rawClient?: { unsafe: (t: string, p: unknown[]) => Promise<unknown[]> }; session?: { client?: { unsafe?: (t: string, p: unknown[]) => Promise<unknown[]>; query?: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } }; $client?: { query: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } }
  const raw = d.$rawClient ?? d.session?.client
  if (raw && typeof raw.unsafe === 'function') return async (t, p) => (await raw.unsafe!(t, p ?? [])) as Array<Record<string, unknown>>
  const pg = d.$client ?? d.session?.client
  if (pg && typeof pg.query === 'function') { const q = pg.query.bind(pg); return async (t, p) => (await q(t, p ?? [])).rows as Array<Record<string, unknown>> }
  throw new Error('lifecycleExecFromDb: not a drizzle client this platform knows')
}

export interface ReleaseHistoryEntry {
  id: string
  attempt: number
  action: string
  fromStatus: ReleaseStatus | null
  toStatus: ReleaseStatus
  actor: string | null
  checksum: string | null
  counts: Record<string, unknown> | null
  errorId: string | null
  errorSummary: string | null
  reason: string | null
  startedAt: string
  finishedAt: string | null
}

/** The release's history, oldest first: every transition, every refused preflight, every schedule (Phase 5B, Unit 9). */
export async function readReleaseHistory(exec: LifecycleExec, releaseId: string, workspaceId: string): Promise<ReleaseHistoryEntry[]> {
  const rows = await exec(`SELECT * FROM release_history WHERE release_id = $1 AND workspace_id = $2 ORDER BY started_at, id`, [releaseId, workspaceId])
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
  return rows.map((r) => ({
    id: String(r.id), attempt: Number(r.attempt ?? 0), action: String(r.action),
    fromStatus: (r.from_status as ReleaseStatus | null) ?? null, toStatus: r.to_status as ReleaseStatus, actor: (r.actor as string | null) ?? null,
    checksum: (r.checksum as string | null) ?? null,
    counts: r.counts == null ? null : (typeof r.counts === 'string' ? JSON.parse(r.counts) : r.counts) as Record<string, unknown>,
    errorId: (r.error_id as string | null) ?? null, errorSummary: (r.error_summary as string | null) ?? null, reason: (r.reason as string | null) ?? null,
    startedAt: iso(r.started_at) ?? '', finishedAt: iso(r.finished_at),
  }))
}

