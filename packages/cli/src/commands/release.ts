/**
 * File Name: release.ts
 * Purpose: `tangen release list|status` (closure plan Phase 5B, Unit 13):
 *          read-only views of a workspace's releases from the database:
 *          the list with status, path (labels and roles), approval and
 *          schedule; one release with its items in apply order, their
 *          outcomes, the approval checksum and the history. Applying,
 *          approving and scheduling stay in the API, where the engine,
 *          the preflight and the scheduler live: the CLI reports that
 *          boundary instead of pretending to cross it.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Raw SQL over the drizzle client (postgres.js or
 *          PGlite). A database without the
 *          releases table (a composition without releases) is reported,
 *          not crashed on.
 */
export interface ReleaseCommandDeps {
  db: unknown
  workspaceId: string
  json?: boolean
  log?: (msg: string) => void
}

type Exec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

function execOf(db: unknown): Exec {
  const d = db as { $rawClient?: { unsafe: (t: string, p: unknown[]) => Promise<unknown[]> }; session?: { client?: { unsafe?: (t: string, p: unknown[]) => Promise<unknown[]>; query?: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } }; $client?: { query: (t: string, p: unknown[]) => Promise<{ rows: unknown[] }> } }
  const raw = d.$rawClient ?? d.session?.client
  if (raw && typeof raw.unsafe === 'function') return async (t, p) => (await raw.unsafe!(t, p ?? [])) as Array<Record<string, unknown>>
  const pg = d.$client ?? d.session?.client
  if (pg && typeof pg.query === 'function') { const q = pg.query.bind(pg); return async (t, p) => (await q(t, p ?? [])).rows as Array<Record<string, unknown>> }
  throw new Error('release: not a drizzle client this platform knows')
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

export interface ReleaseListRow {
  id: string
  name: string
  status: string
  items: number
  approvedAt: string | null
  approvedBy: string | null
  scheduledAt: string | null
  attempts: number
  createdAt: string | null
  appliedAt: string | null
}

async function hasReleases(exec: Exec): Promise<boolean> {
  const rows = await exec(`SELECT to_regclass('releases') AS t`)
  return rows[0]?.t != null
}

export async function readReleaseList(db: unknown, workspaceId: string, status?: string): Promise<ReleaseListRow[]> {
  const exec = execOf(db)
  if (!(await hasReleases(exec))) throw new Error('this database has no releases table: releases are not part of this composition, or migrations have not run (tangen doctor)')
  const rows = await exec(
    `SELECT r.*, (SELECT count(*)::int FROM release_items i WHERE i.release_id = r.id) AS item_count FROM releases r WHERE r.workspace_id = $1 ${status ? 'AND r.status = $2' : ''} ORDER BY r.created_at DESC, r.id`,
    status ? [workspaceId, status] : [workspaceId],
  )
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), status: String(r.status),
    items: Number(r.item_count ?? 0), approvedAt: iso(r.approved_at), approvedBy: (r.approved_by as string | null) ?? null, scheduledAt: iso(r.scheduled_at),
    attempts: Number(r.attempts ?? 0), createdAt: iso(r.created_at), appliedAt: iso(r.applied_at),
  }))
}

export interface ReleaseStatusReport extends ReleaseListRow {
  checksum: string | null
  frozen: boolean
  failure: unknown
  items_: Array<{ position: number | null; typeName: string; objectId: string; outcome: string | null; error: string | null }>
  history: Array<{ at: string | null; action: string; from: string | null; to: string; actor: string | null; attempt: number; reason: string | null; error: string | null }>
}

export async function readReleaseStatus(db: unknown, workspaceId: string, releaseId: string): Promise<ReleaseStatusReport> {
  const exec = execOf(db)
  const [row] = await readReleaseList(db, workspaceId).then((all) => all.filter((r) => r.id === releaseId))
  if (!row) throw new Error(`No release '${releaseId}' in workspace '${workspaceId}' (tangen release list)`)
  const [extra] = await exec(`SELECT approved_checksum, failure FROM releases WHERE id = $1`, [releaseId])
  const items = await exec(`SELECT position, type_name, object_id, apply_outcome, apply_error, frozen_payload IS NOT NULL AS frozen FROM release_items WHERE release_id = $1 ORDER BY position NULLS LAST, type_name, object_id`, [releaseId])
  const history = await exec(`SELECT started_at, action, from_status, to_status, actor, attempt, reason, error_summary FROM release_history WHERE release_id = $1 ORDER BY started_at, id`, [releaseId])
  return {
    ...row,
    checksum: (extra?.approved_checksum as string | null) ?? null,
    frozen: items.length > 0 && items.every((i) => i.frozen === true),
    failure: extra?.failure ?? null,
    items_: items.map((i) => ({ position: i.position == null ? null : Number(i.position), typeName: String(i.type_name), objectId: String(i.object_id), outcome: (i.apply_outcome as string | null) ?? null, error: (i.apply_error as string | null) ?? null })),
    history: history.map((h) => ({ at: iso(h.started_at), action: String(h.action), from: (h.from_status as string | null) ?? null, to: String(h.to_status), actor: (h.actor as string | null) ?? null, attempt: Number(h.attempt ?? 0), reason: (h.reason as string | null) ?? null, error: (h.error_summary as string | null) ?? null })),
  }
}

export async function runReleaseListCommand(deps: ReleaseCommandDeps, status?: string): Promise<void> {
  const log = deps.log ?? console.log
  const rows = await readReleaseList(deps.db, deps.workspaceId, status)
  if (deps.json) { log(JSON.stringify({ workspaceId: deps.workspaceId, releases: rows }, null, 2)); return }
  if (rows.length === 0) { log(`[tangen] no releases${status ? ` with status ${status}` : ''} in workspace ${deps.workspaceId}`); return }
  for (const r of rows) {
    const when = r.status === 'applied' && r.appliedAt ? ` applied ${r.appliedAt}` : r.scheduledAt ? ` scheduled ${r.scheduledAt}` : r.approvedAt ? ` approved ${r.approvedAt}` : ''
    log(`${r.id}  ${r.status.padEnd(9)}  ${r.name}  ${r.items} item(s)${when}${r.attempts > 0 ? `  attempts ${r.attempts}` : ''}`)
  }
  log(`[tangen] approving, scheduling and applying happen in the Admin or the API (POST /api/v1/releases/<id>/approve|schedule|apply); the engine and the preflight live there`)
}

export async function runReleaseStatusCommand(deps: ReleaseCommandDeps, releaseId: string): Promise<void> {
  const log = deps.log ?? console.log
  const r = await readReleaseStatus(deps.db, deps.workspaceId, releaseId)
  if (deps.json) { log(JSON.stringify(r, null, 2)); return }
  log(`${r.id}  ${r.name}`)
  log(`  status    ${r.status}${r.attempts > 0 ? ` (attempt ${r.attempts})` : ''}`)
  if (r.approvedAt) log(`  approved  ${r.approvedAt} by ${r.approvedBy ?? '-'}  checksum ${r.checksum ?? '-'}  payload ${r.frozen ? 'frozen' : 'NOT frozen'}`)
  if (r.scheduledAt) log(`  scheduled ${r.scheduledAt}`)
  if (r.appliedAt) log(`  applied   ${r.appliedAt}`)
  if (r.failure) log(`  failure   ${JSON.stringify(r.failure)}`)
  log(`  items (${r.items_.length}, apply order)`)
  for (const i of r.items_) log(`    ${i.position ?? '-'}  ${i.typeName}/${i.objectId}  ${i.outcome ?? 'pending'}${i.error ? `  ${i.error}` : ''}`)
  if (r.history.length > 0) {
    log(`  history`)
    for (const h of r.history) log(`    ${h.at ?? '-'}  ${h.action}  ${h.from ?? '-'} -> ${h.to}${h.attempt > 0 ? `  attempt ${h.attempt}` : ''}${h.actor ? `  by ${h.actor}` : ''}${h.reason ? `  ${h.reason}` : ''}${h.error ? `  ${h.error}` : ''}`)
  }
}
