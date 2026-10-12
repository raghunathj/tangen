/**
 * File Name: retention.ts
 * Purpose: One retention policy for the operational tables (closure plan
 *          Phase 2, Unit 3): which tables, which timestamp, how each is
 *          scoped to a workspace, how many days a deployment keeps, and one
 *          batched, idempotent purge that removes what is past the cutoff
 *          and nothing else. The scheduler runs it once a day per process.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Deletes in batches by ctid so a purge over a large
 *          backlog never holds a long lock, and returns the rows it removed.
 *          The per-table timestamp columns are indexed with their scope
 *          (migration 0044 added the three that were not). Customer content
 *          is never on the policy: only the tables listed here can be
 *          touched, and each is named with its own column set. Legacy
 *          per-feature settings (search.analytics.retentionDays,
 *          dashboard.activity.retentionDays) still apply to their own
 *          table, so a deployment that tuned them keeps what it chose.
 */
import { sql } from 'drizzle-orm'
import type { RetentionConfig, RetentionTable } from '@tangen/types'
import { getLogger } from '@tangen/logging'
import { resolveSearchAnalytics } from './search-config'

const logger = getLogger(['tangen', 'api', 'retention'])

export const DEFAULT_RETENTION_DAYS = 90
export const DEFAULT_BATCH_SIZE = 1000
/** The dashboard's documented ceiling for the activity feed. */
const ACTIVITY_MAX_DAYS = 90

export interface RetentionPolicy {
  table: RetentionTable
  /** The timestamp the cutoff compares against. */
  timestampColumn: string
  /** How a row is tied to a workspace: a column, or through the environment it names. */
  scope: { column: string } | { viaEnvironment: string }
  /** What the rows are, for the log line. */
  describe: string
}

/** Every table the policy covers, with its own columns. Nothing else can be purged. */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  { table: 'audit_log', timestampColumn: 'created_at', scope: { column: 'workspace_id' }, describe: 'audit events' },
  { table: 'workspace_activity', timestampColumn: 'created_at', scope: { column: 'workspace_id' }, describe: 'activity feed rows' },
  { table: 'webhook_deliveries', timestampColumn: 'created_at', scope: { column: 'workspace_id' }, describe: 'webhook deliveries' },
  { table: 'search_query_log', timestampColumn: 'created_at', scope: { column: 'workspace_id' }, describe: 'search query log rows' },
  { table: 'job_runs', timestampColumn: 'started_at', scope: { column: 'workspace_id' }, describe: 'job runs' },
]

export interface ResolvedRetention {
  enabled: boolean
  batchSize: number
  /** Days per table; null keeps the table's rows forever. */
  days: Record<RetentionTable, number | null>
}

type ProjectLike = {
  workspaceId: string
  retention?: RetentionConfig
  dashboard?: { activity?: { retentionDays?: number } }
  config?: { retention?: RetentionConfig; dashboard?: { activity?: { retentionDays?: number } } }
} & Record<string, unknown>

const positiveDays = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null)

/** The policy one workspace runs under: its config, its legacy per-feature settings, then the defaults. */
export function resolveRetention(project: ProjectLike | undefined): ResolvedRetention {
  const cfg = project?.config?.retention ?? project?.retention
  const defaultDays = positiveDays(cfg?.defaultDays) ?? DEFAULT_RETENTION_DAYS
  const batchSize = positiveDays(cfg?.batchSize) ?? DEFAULT_BATCH_SIZE
  const days = {} as Record<RetentionTable, number | null>
  for (const p of RETENTION_POLICIES) {
    const own = cfg?.days?.[p.table]
    if (own === false) { days[p.table] = null; continue }
    const explicit = positiveDays(own)
    if (explicit !== null) { days[p.table] = explicit; continue }
    if (p.table === 'search_query_log') { days[p.table] = resolveSearchAnalytics(project as never).retentionDays; continue }
    if (p.table === 'workspace_activity') {
      const legacy = positiveDays((project?.config?.dashboard ?? project?.dashboard)?.activity?.retentionDays)
      days[p.table] = legacy !== null ? Math.min(ACTIVITY_MAX_DAYS, legacy) : defaultDays
      continue
    }
    days[p.table] = defaultDays
  }
  return { enabled: cfg?.enabled !== false, batchSize, days }
}

/** The instant before which a row is past retention; rows AT the cutoff are kept. */
export function retentionCutoff(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function rowsOf(res: unknown): number {
  if (Array.isArray(res)) return res.length
  const r = res as { rows?: unknown[]; rowCount?: number; count?: number } | undefined
  return r?.rows?.length ?? r?.rowCount ?? r?.count ?? 0
}

/**
 * Removes one workspace's rows of one table that are older than the cutoff,
 * in batches, and returns how many went. Idempotent: a second run over the
 * same cutoff removes nothing.
 */
export async function purgeTable(
  db: { execute: (q: any) => Promise<any> },
  policy: RetentionPolicy,
  opts: { workspaceId: string; cutoff: Date; batchSize?: number },
): Promise<number> {
  const batch = Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH_SIZE))
  const table = sql.identifier(policy.table)
  const ts = sql.identifier(policy.timestampColumn)
  const scope = 'column' in policy.scope
    ? sql`${sql.identifier(policy.scope.column)} = ${opts.workspaceId}`
    : sql`${sql.identifier(policy.scope.viaEnvironment)} IN (SELECT "id" FROM "environments" WHERE "workspace_id" = ${opts.workspaceId})`
  const cutoff = opts.cutoff.toISOString()
  let deleted = 0
  for (;;) {
    const res = await db.execute(sql`
      DELETE FROM ${table}
      WHERE ctid IN (
        SELECT ctid FROM ${table}
        WHERE ${scope} AND ${ts} < ${cutoff}::timestamptz
        LIMIT ${batch}
      )
      RETURNING 1`)
    const n = rowsOf(res)
    deleted += n
    if (n < batch) break
  }
  return deleted
}

export type RetentionSummary = Partial<Record<RetentionTable, number>>

/** Runs the policy for every project. Returns rows removed per table; logs a line per table that lost rows. */
export async function runRetention(
  db: { execute: (q: any) => Promise<any> },
  projects: ProjectLike[] | undefined,
  now: Date = new Date(),
): Promise<RetentionSummary> {
  const summary: RetentionSummary = {}
  for (const project of projects ?? []) {
    const resolved = resolveRetention(project)
    if (!resolved.enabled) continue
    for (const policy of RETENTION_POLICIES) {
      const days = resolved.days[policy.table]
      if (days === null) continue
      try {
        const n = await purgeTable(db, policy, { workspaceId: project.workspaceId, cutoff: retentionCutoff(days, now), batchSize: resolved.batchSize })
        if (n > 0) {
          summary[policy.table] = (summary[policy.table] ?? 0) + n
          logger.info(`retention: removed ${n} ${policy.describe} older than ${days} days`, { table: policy.table, workspaceId: project.workspaceId, days, deleted: n })
        }
      } catch (err) {
        // One table's failure (absent on an old database, a lock) never stops the others.
        logger.warn(`retention: ${policy.table} purge failed for ${project.workspaceId}`, { table: policy.table, workspaceId: project.workspaceId, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  return summary
}

const RUN_EVERY_MS = 24 * 60 * 60 * 1000
/** The first purge waits for the process to settle; a boot is not the moment for housekeeping. */
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000
let nextRunAt = Date.now() + FIRST_RUN_DELAY_MS

/** Scheduler entry point: one purge per day per process, the first ten minutes after boot. */
export async function runRetentionThrottled(
  db: { execute: (q: any) => Promise<any> },
  projects: ProjectLike[] | undefined,
  now: Date = new Date(),
): Promise<RetentionSummary | null> {
  if (now.getTime() < nextRunAt) return null
  nextRunAt = now.getTime() + RUN_EVERY_MS
  return runRetention(db, projects, now)
}

/** Test seam: forget the throttle. */
export function resetRetentionThrottle(): void {
  nextRunAt = 0
}
