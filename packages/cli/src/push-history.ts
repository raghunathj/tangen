/**
 * File Name: push-history.ts
 * Purpose: Integrity of the push ledger (closure plan, Phase 1 Unit 4). Every
 *          push records a deterministic checksum of the effective plan and
 *          the statements it ran; before the next push touches the database,
 *          the environment's history is re-fingerprinted from what the ledger
 *          stores and compared with what it recorded. A disagreement means a
 *          historical row was edited or corrupted after the fact, and the
 *          push fails closed with the row named. Rows written before
 *          checksums existed are legacy: accepted, counted, reported, never
 *          rewritten.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: The fingerprint is sha256 over a canonical JSON form
 *          (keys sorted, JSON semantics for undefined and dates) of the plan
 *          summary and the ordered SQL text - labels and groups are display
 *          text and do not take part, so two equivalent pushes agree. The
 *          jsonb round trip reorders keys and never changes values, which is
 *          exactly what the canonical form is insensitive to.
 */
import { createHash } from 'node:crypto'
import { eq, asc } from 'drizzle-orm'
import { schemaPushes } from '@tangen/db'
import type { DbClient } from '@tangen/db'

export const PUSH_FINGERPRINT_VERSION = 1

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]))
  }
  return value
}

/** JSON with sorted keys and JSON's own semantics for what a value is. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value ?? null))))
}

/** The ordered SQL of a statement list, whether it holds statement objects or bare strings. */
function sqlOf(statements: unknown): string[] {
  if (!Array.isArray(statements)) return []
  return statements.map((s) => (typeof s === 'string' ? s : String((s as { sql?: unknown })?.sql ?? '')))
}

/** The checksum a push records: deterministic for an equivalent plan and the same statements. */
export function fingerprintPush(plan: unknown, statements: unknown): string {
  return createHash('sha256')
    .update(stableStringify({ v: PUSH_FINGERPRINT_VERSION, plan: plan ?? {}, statements: sqlOf(statements) }))
    .digest('hex')
}

export interface PushHistoryRow {
  id: string
  startedAt: Date | string
  status: string
  checksum: string | null
  planJson: unknown
  statementsJson: unknown
}

export interface PushHistoryMismatch {
  id: string
  startedAt: string
  status: string
  recorded: string
  computed: string
}

export interface PushHistory {
  /** False when the ledger table does not exist yet (a database no push has recorded into). */
  available: boolean
  rows: number
  /** Rows whose stored plan and statements fingerprint to their recorded checksum. */
  verified: number
  /** Rows written before checksums existed; accepted as they are, never rewritten. */
  legacy: number
  mismatches: PushHistoryMismatch[]
}

/** Pure: verifies rows already read (doctor reads them with its own query). */
export function verifyPushHistoryRows(rows: PushHistoryRow[]): PushHistory {
  let verified = 0
  let legacy = 0
  const mismatches: PushHistoryMismatch[] = []
  for (const r of rows) {
    if (r.checksum === null || r.checksum === undefined) { legacy++; continue }
    const computed = fingerprintPush(r.planJson, r.statementsJson)
    if (computed === r.checksum) verified++
    else mismatches.push({ id: r.id, startedAt: new Date(r.startedAt).toISOString(), status: r.status, recorded: r.checksum, computed })
  }
  return { available: true, rows: rows.length, verified, legacy, mismatches }
}

/** Reads and verifies every ledger row of an environment. */
export async function verifyPushHistory(db: DbClient): Promise<PushHistory> {
  let rows: PushHistoryRow[]
  try {
    rows = await db.select({
      id: schemaPushes.id,
      startedAt: schemaPushes.startedAt,
      status: schemaPushes.status,
      checksum: schemaPushes.checksum,
      planJson: schemaPushes.planJson,
      statementsJson: schemaPushes.statementsJson,
    }).from(schemaPushes).orderBy(asc(schemaPushes.startedAt))
  } catch {
    return { available: false, rows: 0, verified: 0, legacy: 0, mismatches: [] }
  }
  return verifyPushHistoryRows(rows)
}

/** The refusal a push prints when history does not verify; null when it does. */
export function pushHistoryGate(history: PushHistory): string | null {
  if (history.mismatches.length === 0) return null
  const lines = [
    `Refused: the push history of this environment does not verify (${history.mismatches.length} of ${history.rows} ledger row${history.rows === 1 ? '' : 's'}). Nothing was applied.`,
    'Each row of schema_pushes records a checksum of the plan and statements it ran; these rows no longer fingerprint to theirs, so the ledger was edited or corrupted after the fact:',
  ]
  for (const m of history.mismatches) {
    lines.push(`  - ${m.id}  ${m.status} ${m.startedAt}  recorded ${m.recorded.slice(0, 12)}, now ${m.computed.slice(0, 12)}`)
  }
  lines.push('', 'Inspect those rows (plan_json, statements_json, checksum) against a backup of the ledger and restore them; a schema whose history cannot be trusted is not pushed to.',
    'See docs/architecture/database-safety.md, "Migration history".')
  return lines.join('\n')
}

/** One line for the plan output and doctor: what the history looks like. */
export function describePushHistory(history: PushHistory): string {
  if (!history.available) return 'push history: no ledger yet'
  if (history.rows === 0) return 'push history: empty'
  const parts = [`${history.verified} verified`]
  if (history.legacy > 0) parts.push(`${history.legacy} before checksums (unverified, accepted)`)
  if (history.mismatches.length > 0) parts.push(`${history.mismatches.length} DO NOT VERIFY`)
  return `push history: ${history.rows} row${history.rows === 1 ? '' : 's'}, ${parts.join(', ')}`
}
