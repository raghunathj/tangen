/**
 * File Name: migrate.ts
 * Purpose: Applies pending Drizzle ORM migrations against a PostgreSQL database,
 *          and can be run directly as a CLI script via `bun src/migrate.ts`.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Uses a single-connection postgres.js client (max: 1) and
 *                     holds ONE session advisory lock for the whole run, so N
 *                     replicas booting together migrate one after another: the
 *                     first applies, the rest wait and find nothing pending
 *                     (plan T1.16). Requires DATABASE_URL
 *                     environment variable when invoked as a script. After the
 *                     ledgered migrations it applies the conditional system
 *                     schema (knowledge_chunks once pgvector exists) - see
 *                     knowledge-schema.ts; this is the ONLY entrypoint for it.
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { join } from 'node:path'
import { ensureConditionalSystemSchema } from './knowledge-schema'

const migrationsFolder = join(import.meta.dir, '..', 'drizzle')

/** One key for every Tangen migrator on a database ("tangen" as digits). */
export const MIGRATION_LOCK_KEY = 7461676531

/**
 * Applies all pending Drizzle migrations from the `drizzle/` folder to the target database.
 * @param databaseUrl - PostgreSQL connection string for the target database
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  // onnotice: idempotent re-runs emit "already exists, skipping" NOTICEs —
  // expected, so keep them out of stdout.
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  const db = drizzle(client)
  try {
    // Session-level: released explicitly below, and by the server if this
    // connection dies. Every migrator on this database queues here.
    await client.unsafe(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`)
    // Migration 0051 (remove environments) keeps one environment per workspace;
    // when that choice is ambiguous the operator names it, and the migration
    // reads the name from this session setting.
    const keep = process.env.TANGEN_KEEP_ENVIRONMENT?.trim()
    if (keep) await client.unsafe(`SET tangen.keep_environment = '${keep.replace(/'/g, "''")}'`)
    await migrate(db, { migrationsFolder })
    // The part of the system schema that waits on an optional server
    // extension: the migration declares it, and this applies it once the
    // extension is there - the same canonical text, from the same entrypoint.
    await ensureConditionalSystemSchema((text, params) => client.unsafe(text, (params ?? []) as never) as unknown as Promise<Array<Record<string, unknown>>>)
    console.log('Migrations applied successfully')
  } finally {
    await client.unsafe(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => {})
    await client.end()
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  await runMigrations(url)
}
