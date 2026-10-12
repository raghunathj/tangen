/**
 * File Name: reconcile.ts
 * Purpose: Safety latch for drizzle migration-ledger drift — records migrations
 *          whose SQL is ALREADY applied to the database but was never written to
 *          `drizzle.__drizzle_migrations` (e.g. schema applied via `push` or an
 *          out-of-band `ALTER` before the migrator ran). Pure bookkeeping: it
 *          never runs migration SQL, it only inserts the missing ledger rows with
 *          the correct sha256 hash + journal timestamp.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: SAFETY — only reconcile when the schema is genuinely up to
 *          date (tables/columns exist from push or a partial migrate). It marks
 *          migrations as applied WITHOUT running them, so on a truly-behind DB it
 *          would skip real schema changes. Dry-run by default; `apply` writes.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const migrationsFolder = join(import.meta.dir, '..', 'drizzle')

export interface JournalMigration { idx: number; tag: string; when: number; hash: string }

/**
 * Read the drizzle journal and compute each migration's sha256 (the exact value
 * the __drizzle_migrations table stores — a hash of the raw .sql file content).
 */
export function readJournalMigrations(folder = migrationsFolder): JournalMigration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string; when: number }[]
  }
  return journal.entries.map((e) => ({
    idx: e.idx,
    tag: e.tag,
    when: e.when,
    hash: createHash('sha256').update(readFileSync(join(folder, `${e.tag}.sql`), 'utf8')).digest('hex'),
  }))
}

/** Pure: journal migrations not present in the recorded-hash set, in journal order. */
export function computeMissingMigrations(
  journal: JournalMigration[],
  recordedHashes: ReadonlySet<string>,
): JournalMigration[] {
  return journal.filter((m) => !recordedHashes.has(m.hash))
}

export interface ReconcileResult {
  /** True when the ledger table exists; false means the DB was never migrated. */
  ledgerExists: boolean
  recorded: number
  total: number
  missing: JournalMigration[]
  applied: boolean
}

/**
 * Reconcile the migration ledger with the journal. Dry-run by default (reports
 * what's missing); pass `{ apply: true }` to insert the missing rows.
 */
export async function reconcileMigrations(
  databaseUrl: string,
  opts: { apply?: boolean } = {},
): Promise<ReconcileResult> {
  const journal = readJournalMigrations()
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const exists = await sql.unsafe(
      `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
    )
    if (!exists[0]?.present) {
      return { ledgerExists: false, recorded: 0, total: journal.length, missing: [], applied: false }
    }
    const rows = await sql.unsafe(`SELECT hash FROM drizzle.__drizzle_migrations`)
    const recorded = new Set(rows.map((r) => (r as unknown as { hash: string }).hash))
    const missing = computeMissingMigrations(journal, recorded)
    if (opts.apply) {
      for (const m of missing) {
        await sql.unsafe(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [m.hash, m.when],
        )
      }
    }
    return { ledgerExists: true, recorded: recorded.size, total: journal.length, missing, applied: !!opts.apply }
  } finally {
    await sql.end()
  }
}

// CLI: `bun src/reconcile.ts [--apply]`. Dry-run reports drift; --apply records it.
if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const res = await reconcileMigrations(url, { apply })
  if (!res.ledgerExists) {
    console.log('No migration ledger found - this DB has never been migrated. Run `db:migrate` first.')
  } else if (res.missing.length === 0) {
    console.log(`Migration ledger is in sync (${res.recorded}/${res.total} recorded). Nothing to reconcile.`)
  } else if (apply) {
    console.log(`Recorded ${res.missing.length} previously-applied migration(s): ${res.missing.map((m) => m.tag).join(', ')}`)
    console.log(`Ledger now in sync (${res.total}/${res.total}).`)
  } else {
    console.log(`Ledger drift: ${res.recorded}/${res.total} recorded. Missing (already applied, not recorded):`)
    for (const m of res.missing) console.log(`  - ${m.tag}`)
    console.log('\nRun with --apply to record them (only do this if the schema is actually up to date).')
  }
}
