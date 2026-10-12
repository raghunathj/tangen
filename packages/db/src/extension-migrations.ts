/**
 * File Name: extension-migrations.ts
 * Purpose: The extension migration runner (closure plan Phase 4, Unit 5).
 *          An extension declares SQL migrations in order; INSTALL and
 *          UPGRADE run the pending ones for one workspace x environment,
 *          each in its own transaction with its ledger row, and stop at
 *          the first failure. History is never rewritten: a changed
 *          checksum, a migration the extension no longer declares, or one
 *          inserted before applied history refuses the whole run.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Lives in @tangen/db so the API's admin install and
 *          the CLI run the same code over the same ledger. Plain SQL over a
 *          `MigrationDb` (an executor plus a transaction) with adapters for
 *          postgres.js and PGlite. Migrations are SQL text, so their
 *          checksum is the truth of what ran; they run once per workspace x
 *          environment the extension is installed in, and physical
 *          structures are shared across scopes, so an extension writes
 *          them idempotently (`CREATE TABLE IF NOT EXISTS ...`). Nothing
 *          here is called at import, REGISTER, ENABLE or START.
 */
import { createHash } from 'node:crypto'

/** One declared migration: a stable id and the SQL it runs. (Mirrors ExtensionMigration in @tangen/types.) */
export interface DeclaredMigration {
  id: string
  sql: string
}

export type MigrationExec = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export interface MigrationDb {
  exec: MigrationExec
  /** Runs `fn` in one transaction; a throw rolls it back and rethrows. */
  transaction<T>(fn: (exec: MigrationExec) => Promise<T>): Promise<T>
}

/** postgres.js: `sql.begin` reserves one connection for the transaction. */
export function migrationDbFromPostgres(sql: {
  unsafe: (text: string, params?: unknown[]) => Promise<unknown>
  begin: <T>(fn: (tx: { unsafe: (text: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
}): MigrationDb {
  const wrap = (u: (text: string, params?: unknown[]) => Promise<unknown>): MigrationExec =>
    async (text, params) => (await u(text, params && params.length > 0 ? params : undefined)) as Array<Record<string, unknown>>
  return { exec: wrap(sql.unsafe.bind(sql)), transaction: (fn) => sql.begin((tx) => fn(wrap(tx.unsafe.bind(tx)))) }
}

/** PGlite (tests): `query` for parameterised statements, `exec` for multi-statement SQL text. */
export function migrationDbFromPglite(client: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
  exec: (text: string) => Promise<unknown>
  transaction: <T>(fn: (tx: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (text: string) => Promise<unknown> }) => Promise<T>) => Promise<T>
}): MigrationDb {
  const wrap = (c: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (text: string) => Promise<unknown> }): MigrationExec =>
    async (text, params) => {
      if (!params || params.length === 0) { await c.exec(text); return [] }
      return (await c.query(text, params)).rows as Array<Record<string, unknown>>
    }
  return {
    exec: async (text, params) => (await client.query(text, params ?? [])).rows as Array<Record<string, unknown>>,
    transaction: (fn) => client.transaction((tx) => fn(wrap(tx))),
  }
}

/** The MigrationDb behind a drizzle client, whichever driver it wraps. */
export function migrationDbFromDrizzle(db: unknown): MigrationDb {
  const d = db as { $rawClient?: unknown; session?: { client?: unknown }; $client?: unknown }
  const raw = (d.$rawClient ?? d.session?.client) as Parameters<typeof migrationDbFromPostgres>[0] | undefined
  if (raw && typeof raw.begin === 'function') return migrationDbFromPostgres(raw)
  const pg = d.$client as Parameters<typeof migrationDbFromPglite>[0] | undefined
  if (pg && typeof pg.transaction === 'function') return migrationDbFromPglite(pg)
  throw new Error('migrationDbFromDrizzle: not a drizzle client this platform knows')
}

const MIGRATION_CHECKSUM_VERSION = 1
export const MIGRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

/** sha256 over the migration id and its SQL; the ledger's truth of what ran. */
export function migrationChecksum(m: DeclaredMigration): string {
  return createHash('sha256').update(JSON.stringify({ v: MIGRATION_CHECKSUM_VERSION, id: m.id, sql: m.sql })).digest('hex')
}

export interface MigrationScope { workspaceId: string; extensionId: string }

export interface LedgerRow {
  migrationId: string
  checksum: string
  status: string
  extensionVersion: string | null
  error: string | null
  appliedAt: Date | string
}

export interface MigrationPlan {
  /** Declared and not yet applied (or previously failed), in declared order. */
  pending: DeclaredMigration[]
  applied: string[]
  /** Previously failed rows the run will retry. */
  retrying: string[]
  /** Why the run must not proceed; empty when it may. */
  refusals: string[]
}

/** Validates the declaration itself: ids, uniqueness, SQL present. */
export function validateDeclaredMigrations(migrations: unknown): string[] {
  const errors: string[] = []
  if (!Array.isArray(migrations)) return ['migrations must be an array of { id, sql }']
  const seen = new Set<string>()
  migrations.forEach((m, i) => {
    const id = (m as { id?: unknown })?.id
    const sql = (m as { sql?: unknown })?.sql
    if (typeof id !== 'string' || !MIGRATION_ID_PATTERN.test(id)) { errors.push(`migrations[${i}].id must match ${MIGRATION_ID_PATTERN}`); return }
    if (seen.has(id)) errors.push(`migrations[${i}]: '${id}' is declared twice`)
    seen.add(id)
    if (typeof sql !== 'string' || sql.trim() === '') errors.push(`migrations[${i}] '${id}': sql must be a non-empty string`)
  })
  return errors
}

/**
 * Pure: what a run would do, from the declared list and the ledger rows of
 * the scope. Refuses when history and declaration disagree.
 */
export function planExtensionMigrations(declared: DeclaredMigration[], ledger: LedgerRow[]): MigrationPlan {
  const refusals = validateDeclaredMigrations(declared)
  const byId = new Map(ledger.map((r) => [r.migrationId, r]))
  const declaredIds = new Set(declared.map((m) => m.id))
  for (const r of ledger) {
    if (r.status === 'applied' && !declaredIds.has(r.migrationId)) refusals.push(`the ledger has '${r.migrationId}' applied, which the extension no longer declares`)
  }
  const pending: DeclaredMigration[] = []
  const applied: string[] = []
  const retrying: string[] = []
  let sawPending = false
  for (const m of declared) {
    const row = byId.get(m.id)
    if (row?.status === 'applied') {
      if (row.checksum !== migrationChecksum(m)) refusals.push(`'${m.id}' was applied with a different SQL (checksum ${row.checksum.slice(0, 12)}, now ${migrationChecksum(m).slice(0, 12)})`)
      if (sawPending) refusals.push(`'${m.id}' is applied but a migration declared before it is not: the order changed after it ran`)
      applied.push(m.id)
      continue
    }
    if (row?.status === 'failed') retrying.push(m.id)
    sawPending = true
    pending.push(m)
  }
  return { pending, applied, retrying, refusals }
}

export interface RunMigrationsInput extends MigrationScope {
  extensionVersion: string | null
  migrations: DeclaredMigration[]
  /** Report only; run nothing. */
  dryRun?: boolean
}

export interface RunMigrationsResult {
  ok: boolean
  plan: MigrationPlan
  applied: string[]
  /** The migration that failed and why; the ones after it did not run. */
  failed: { id: string; error: string } | null
  /** Migrations recorded for this environment without running their SQL: another environment in this database had applied them. */
  adopted?: string[]
  /** Ready to print. */
  message: string
}

const ROW_COLUMNS = `migration_id AS "migrationId", checksum, status, extension_version AS "extensionVersion", error, applied_at AS "appliedAt"`

/** The ledger rows of one extension in one scope, oldest first. */
export async function readExtensionMigrationLedger(exec: MigrationExec, scope: MigrationScope): Promise<LedgerRow[]> {
  const rows = await exec(
    `SELECT ${ROW_COLUMNS} FROM extension_migrations WHERE workspace_id = $1 AND extension_id = $2 ORDER BY applied_at, migration_id`,
    [scope.workspaceId, scope.extensionId],
  )
  return rows as unknown as LedgerRow[]
}

/** The ledger of every extension in a scope, grouped by extension (the gate's one query). */
export async function readScopeMigrationLedger(exec: MigrationExec, scope: { workspaceId: string }): Promise<Record<string, LedgerRow[]>> {
  const rows = await exec(
    `SELECT extension_id AS "extensionId", ${ROW_COLUMNS} FROM extension_migrations WHERE workspace_id = $1 ORDER BY applied_at, migration_id`,
    [scope.workspaceId],
  )
  const out: Record<string, LedgerRow[]> = {}
  for (const r of rows as unknown as Array<LedgerRow & { extensionId: string }>) (out[r.extensionId] ??= []).push(r)
  return out
}

/**
 * Runs the pending migrations of one extension in one scope. Each
 * migration runs in its own transaction together with its ledger row, so
 * a failure leaves neither half; the failure is then recorded as a
 * `failed` row (retried next time) and the run stops. The result never
 * reports more than what actually ran.
 */
export async function runExtensionMigrations(db: MigrationDb, input: RunMigrationsInput): Promise<RunMigrationsResult> {
  const ledger = await readExtensionMigrationLedger(db.exec, input)
  const plan = planExtensionMigrations(input.migrations, ledger)
  const label = `${input.extensionId} in ${input.workspaceId}`
  if (plan.refusals.length > 0) {
    return { ok: false, plan, applied: [], failed: null, message: `Refused: the migration history of ${label} does not match its declaration. Nothing ran.\n${plan.refusals.map((r) => `  - ${r}`).join('\n')}` }
  }
  if (plan.pending.length === 0) return { ok: true, plan, applied: [], failed: null, message: `${label}: schema up to date (${plan.applied.length} applied)` }
  if (input.dryRun) return { ok: true, plan, applied: [], failed: null, message: `${label}: ${plan.pending.length} pending: ${plan.pending.map((m) => m.id).join(', ')}` }

  const applied: string[] = []
  const adopted: string[] = []
  for (const m of plan.pending) {
    const checksum = migrationChecksum(m)
    const rowId = `xmig_${createHash('sha256').update(`${input.workspaceId}:${input.extensionId}:${m.id}`).digest('hex').slice(0, 24)}`
    // Physical schema is DATABASE-scoped; the ledger is per environment
    // (plan section 16). When another environment (or workspace) in this
    // database already applied this exact migration, its SQL has run against
    // the tables this environment will use: record this environment's row
    // and run nothing, whether or not the SQL was written idempotently.
    const present = await db.exec(
      `SELECT 1 FROM extension_migrations WHERE extension_id = $1 AND migration_id = $2 AND checksum = $3 AND status = 'applied' LIMIT 1`,
      [input.extensionId, m.id, checksum],
    )
    const physicallyApplied = present.length > 0
    try {
      await db.transaction(async (tx) => {
        if (!physicallyApplied) await tx(m.sql)
        await tx(
          `INSERT INTO extension_migrations (id, workspace_id, extension_id, migration_id, extension_version, checksum, status, error, applied_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'applied', NULL, now())
             ON CONFLICT (workspace_id, extension_id, migration_id)
             DO UPDATE SET checksum = EXCLUDED.checksum, extension_version = EXCLUDED.extension_version, status = 'applied', error = NULL, applied_at = now()`,
          [rowId, input.workspaceId, input.extensionId, m.id, input.extensionVersion, checksum],
        )
      })
      ;(physicallyApplied ? adopted : applied).push(m.id)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      // Outside the rolled-back transaction: the diagnosable trace of what failed.
      await db.exec(
        `INSERT INTO extension_migrations (id, workspace_id, extension_id, migration_id, extension_version, checksum, status, error, applied_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7, now())
           ON CONFLICT (workspace_id, extension_id, migration_id)
           DO UPDATE SET checksum = EXCLUDED.checksum, extension_version = EXCLUDED.extension_version, status = 'failed', error = EXCLUDED.error, applied_at = now()`,
        [rowId, input.workspaceId, input.extensionId, m.id, input.extensionVersion, checksum, error],
      ).catch(() => {})
      const remaining = plan.pending.slice(plan.pending.indexOf(m) + 1).map((x) => x.id)
      return {
        ok: false, plan, applied, failed: { id: m.id, error },
        message: `${label}: migration '${m.id}' failed and was rolled back: ${error}${applied.length > 0 ? `\n  applied before it: ${applied.join(', ')}` : ''}${remaining.length > 0 ? `\n  not run: ${remaining.join(', ')}` : ''}\n  Fix the migration and run the install or upgrade again; the ledger keeps the failure until it succeeds.`,
      }
    }
  }
  const adoptedNote = adopted.length ? `; ${adopted.length} already present in this database from another workspace (${adopted.join(', ')}), recorded without running` : ''
  return { ok: true, plan, applied, adopted, failed: null, message: `${label}: applied ${applied.length} migration${applied.length === 1 ? '' : 's'} (${applied.join(', ')})${adoptedNote}` }
}

/**
 * What the gate and doctor ask: is the declared schema there? Null when it
 * is; otherwise a reason an operator can act on.
 */
export function explainPendingSchema(declared: DeclaredMigration[], ledger: LedgerRow[]): string | null {
  if (declared.length === 0) return null
  const plan = planExtensionMigrations(declared, ledger)
  if (plan.refusals.length > 0) return `its migration history does not match its declaration: ${plan.refusals[0]}`
  const failed = ledger.find((r) => r.status === 'failed')
  if (failed) return `migration '${failed.migrationId}' failed here: ${failed.error ?? 'unknown error'}; run the install or upgrade again`
  if (plan.pending.length > 0) return `${plan.pending.length} migration${plan.pending.length === 1 ? '' : 's'} not applied here (${plan.pending.map((m) => m.id).join(', ')}); run the install or upgrade`
  return null
}
