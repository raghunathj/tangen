/**
 * File Name: guarded-drops.ts
 * Purpose: Guarded drops (freeze review C2, Unit 2). A destructive push does
 *          not erase a column or a table: it renames it aside to
 *          `_dropped__<original>__<id>` so the values survive, the original
 *          identity is recoverable from the name, doctor can report it, a
 *          re-declaration recovers it, and physical deletion is a separate,
 *          explicit, individually approved purge.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Names obey PostgreSQL's 63-byte identifier limit by
 *          truncating the original, never the id. The id is derived from a
 *          seed (the plan's own id and the object) so a plan and its apply
 *          agree; a collision with an existing guarded name moves to the next
 *          attempt of the same derivation. The purge reuses the destructive
 *          policy: one approval per guarded object, never in production.
 */
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { queryRows, type SqlReader, type PlannedStatement } from './migration-plan'
import { safeId, isSafeIdent } from './column-types'
import { evaluateDestructivePolicy } from './destructive-policy'
import type { ChangeOperation, ChangePlan } from './types'
import type { DeploymentRole } from '@tangen/types'

export const GUARD_PREFIX = '_dropped__'
export const PG_IDENT_MAX = 63
const ID_LEN = 8
const SEP = '__'

/** Eight hex characters from the seed; `attempt` moves to the next candidate on a collision. */
export function guardId(seed: string, attempt = 0): string {
  return createHash('sha256').update(`${seed}:${attempt}`).digest('hex').slice(0, ID_LEN)
}

/** `_dropped__<original>__<id>`, the original truncated so the whole name fits 63 bytes. */
export function guardedName(original: string, id: string): string {
  const room = PG_IDENT_MAX - GUARD_PREFIX.length - SEP.length - id.length
  let base = original
  while (Buffer.byteLength(base) > room) base = base.slice(0, -1)
  return `${GUARD_PREFIX}${base}${SEP}${id}`
}

export function isGuardedName(name: string): boolean {
  return parseGuardedName(name) !== null
}

export function parseGuardedName(name: string): { original: string; id: string } | null {
  const m = new RegExp(`^${GUARD_PREFIX}(.+)${SEP}([0-9a-f]{${ID_LEN}})$`).exec(name)
  return m ? { original: m[1]!, id: m[2]! } : null
}

/** The first candidate name not already in `existing`; deterministic for a seed. */
export function freeGuardedName(existing: Iterable<string>, original: string, seed: string): string {
  const taken = new Set(existing)
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = guardedName(original, guardId(seed, attempt))
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`no free guarded name for "${original}" after 64 attempts`)
}

/** A guarded column or table as it exists in the database now. */
export interface GuardedObject {
  kind: 'column' | 'table'
  /** For a column, the table it sits in; for a table, its own guarded name. */
  table: string
  /** The physical guarded name. */
  name: string
  original: string
  id: string
  /** Rows holding a value (column) or rows (table); null when it cannot be counted. */
  rows: number | null
}

/** Every guarded column and table in the current schema. */
export async function listGuardedObjects(db: SqlReader): Promise<GuardedObject[]> {
  const out: GuardedObject[] = []
  const tables = await queryRows<{ table_name: string }>(db, sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name LIKE ${GUARD_PREFIX + '%'} ORDER BY table_name`)
  for (const t of tables) {
    const parsed = parseGuardedName(t.table_name)
    if (!parsed || !isSafeIdent(t.table_name)) continue
    out.push({ kind: 'table', table: t.table_name, name: t.table_name, ...parsed, rows: await count(db, t.table_name) })
  }
  const cols = await queryRows<{ table_name: string; column_name: string }>(db, sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name LIKE ${GUARD_PREFIX + '%'} ORDER BY table_name, column_name`)
  for (const c of cols) {
    const parsed = parseGuardedName(c.column_name)
    if (!parsed || isGuardedName(c.table_name) || !isSafeIdent(c.table_name) || !isSafeIdent(c.column_name)) continue
    out.push({ kind: 'column', table: c.table_name, name: c.column_name, ...parsed, rows: await count(db, c.table_name, `"${safeId(c.column_name)}" IS NOT NULL`) })
  }
  return out
}

async function count(db: SqlReader, table: string, where = ''): Promise<number | null> {
  try {
    const rows = await queryRows<{ n: number }>(db, sql.raw(`SELECT count(*)::int AS n FROM "${safeId(table)}"${where ? ` WHERE ${where}` : ''}`))
    return rows[0]?.n ?? 0
  } catch { return null }
}

/** The approval token a purge of this object needs. */
export const purgeToken = (o: Pick<GuardedObject, 'name'>) => `purge-guarded:${o.name}`

/** The operation the policy classifies and the purge applies. */
export function purgeOperation(o: GuardedObject): ChangeOperation {
  return o.kind === 'table'
    ? { op: 'PURGE_GUARDED', kind: 'table', table: o.table, name: o.name, original: o.original } as ChangeOperation
    : { op: 'PURGE_GUARDED', kind: 'column', table: o.table, name: o.name, original: o.original } as ChangeOperation
}

/** The statements that physically delete a guarded object (its side table too, for a table). */
export function purgeStatements(o: GuardedObject): PlannedStatement[] {
  if (o.kind === 'column') {
    return [{ group: 'content', label: `${o.table}.${o.name}: purge guarded column (was "${o.original}")`, sql: `ALTER TABLE "${safeId(o.table)}" DROP COLUMN IF EXISTS "${safeId(o.name)}"` }]
  }
  const side = guardedName(`${o.original}_i18n`, o.id)
  return [
    { group: 'content', label: `${side}: purge guarded side table`, sql: `DROP TABLE IF EXISTS "${safeId(side)}"` },
    { group: 'content', label: `${o.name}: purge guarded table (was "${o.original}")`, sql: `DROP TABLE IF EXISTS "${safeId(o.name)}"` },
  ]
}

export interface PurgeGuardedInput {
  /** The deployment role of the process running the purge; production refuses. */
  role: DeploymentRole
  /** Guarded physical names, or `<table>.<guarded column>`. */
  targets: string[]
  approvals: string[]
  /** Runs the statements in one transaction (the real apply in production; tests inject). */
  apply?: (statements: PlannedStatement[]) => Promise<void>
}

export interface PurgeGuardedResult {
  applied: boolean
  objects: GuardedObject[]
  statements: PlannedStatement[]
  message: string
}

/**
 * Purges exactly the named guarded objects, under the destructive policy:
 * one `purge-guarded:<name>` approval per object, never in production, and
 * an approval naming anything else is an error.
 */
export async function purgeGuarded(db: SqlReader, input: PurgeGuardedInput): Promise<PurgeGuardedResult> {
  const all = await listGuardedObjects(db)
  const objects: GuardedObject[] = []
  const missing: string[] = []
  for (const t of input.targets) {
    const [tbl, col] = t.includes('.') ? t.split('.', 2) : [null, t]
    const found = all.find((o) => o.name === col && (tbl === null || o.table === tbl)) ?? all.find((o) => o.kind === 'table' && o.name === t)
    if (found) objects.push(found); else missing.push(t)
  }
  if (missing.length > 0) {
    return { applied: false, objects, statements: [], message: `No guarded object named: ${missing.join(', ')}. \`tangen purge guarded --list\` shows what exists.` }
  }
  const plan = { operations: objects.map(purgeOperation), hasDestructive: objects.length > 0, hasMigrations: objects.length > 0 } as ChangePlan
  const verdict = evaluateDestructivePolicy(plan, {
    approvals: input.approvals, role: input.role,
    counts: objects.map((o) => ({ key: `PURGE_GUARDED:${o.name}`, rows: o.rows, label: o.kind === 'table' ? `rows in "${o.name}"` : `rows of "${o.table}" hold a value` })),
  })
  if (!verdict.allowed) return { applied: false, objects, statements: [], message: verdict.message }
  const statements = objects.flatMap(purgeStatements)
  const apply = input.apply ?? (async (stmts) => { for (const s of stmts) await queryRows(db, sql.raw(s.sql)) })
  await apply(statements)
  return { applied: true, objects, statements, message: '' }
}
