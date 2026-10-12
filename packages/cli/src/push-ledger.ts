/**
 * File Name: push-ledger.ts
 * Purpose: Writes the per-environment push ledger (schema_pushes): a row at
 *          the start of the apply phase (status running) and its outcome at
 *          the end (applied, or failed with the error), with the git sha, the
 *          CLI version, the plan and the statements. `--plan` never writes it.
 *          Reads the last row for the health route, the builder banner and
 *          `tangen doctor`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Best-effort by design - the ledger is the audit trail,
 *          not a gate: a database whose guard could not create the table gets
 *          a warning, never a failed push. Each row carries the checksum of
 *          its plan and statements (push-history.ts); the verification of
 *          that history before a push IS a gate. The table itself is created by
 *          migration 0032 and the ensure-system-schema guard that push runs
 *          before its transaction.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { schemaPushes } from '@tangen/db'
import type { DbClient } from '@tangen/db'
import { fingerprintPush } from './push-history'

export type PushLedgerStatus = 'running' | 'applied' | 'failed'

export interface PushLedgerStart {
  workspaceId: string
  gitSha: string | null
  cliVersion: string | null
  plan: unknown
  statements: unknown
}

export interface PushLedgerRow {
  id: string
  workspaceId: string
  startedAt: Date
  finishedAt: Date | null
  status: PushLedgerStatus
  gitSha: string | null
  cliVersion: string | null
  error: string | null
}

/** The version of the CLI that is running (packages/cli/package.json), or null. */
export function readCliVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

/** The project's git HEAD, or null when not a repository (best-effort, never throws). */
export async function readGitSha(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd, stdout: 'pipe', stderr: 'ignore' })
    await proc.exited
    if (proc.exitCode !== 0) return null
    const out = (await new Response(proc.stdout).text()).trim()
    return /^[0-9a-f]{40}$/.test(out) ? out : null
  } catch {
    return null
  }
}

/** Records the start of a push (status running). Returns the row id, or null when the ledger is unavailable. */
export async function startPushRecord(db: DbClient, entry: PushLedgerStart, warn: (msg: string) => void = () => {}): Promise<string | null> {
  const id = createId()
  try {
    await db.insert(schemaPushes).values({
      id,
      workspaceId: entry.workspaceId,
      status: 'running',
      gitSha: entry.gitSha,
      cliVersion: entry.cliVersion,
      planJson: entry.plan as never,
      statementsJson: entry.statements as never,
      checksum: fingerprintPush(entry.plan, entry.statements),
    })
    return id
  } catch (e) {
    warn(`push ledger unavailable (schema_pushes): ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** Records the outcome of a push started with startPushRecord. No-op without an id. */
export async function finishPushRecord(
  db: DbClient,
  id: string | null,
  status: 'applied' | 'failed',
  error?: string,
  warn: (msg: string) => void = () => {},
): Promise<void> {
  if (!id) return
  try {
    await db.update(schemaPushes)
      .set({ status, finishedAt: new Date(), error: error ?? null })
      .where(eq(schemaPushes.id, id))
  } catch (e) {
    warn(`push ledger not updated (schema_pushes): ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The most recent push recorded for an environment, or null (also when the table is absent). */
export async function readLastPush(db: DbClient): Promise<PushLedgerRow | null> {
  try {
    const [row] = await db.select({
      id: schemaPushes.id,
      workspaceId: schemaPushes.workspaceId,
      startedAt: schemaPushes.startedAt,
      finishedAt: schemaPushes.finishedAt,
      status: schemaPushes.status,
      gitSha: schemaPushes.gitSha,
      cliVersion: schemaPushes.cliVersion,
      error: schemaPushes.error,
    }).from(schemaPushes).orderBy(desc(schemaPushes.startedAt)).limit(1)
    return row ? { ...row, status: row.status as PushLedgerStatus } : null
  } catch {
    return null
  }
}

/** One line for a banner or a doctor: "applied 2026-08-23T10:12:00Z by cli 0.1.99" / "FAILED: ..." / "running since ...". */
export function describeLastPush(row: PushLedgerRow | null): string {
  if (!row) return 'no push recorded'
  const when = (row.finishedAt ?? row.startedAt).toISOString()
  const by = row.cliVersion ? ` by cli ${row.cliVersion}` : ''
  if (row.status === 'applied') return `applied ${when}${by}`
  if (row.status === 'failed') return `FAILED ${when}${by}: ${row.error ?? 'unknown error'}`
  return `running since ${row.startedAt.toISOString()}${by}`
}
