/**
 * File Name: apply-gin-indexes.ts
 * Purpose: One-shot script that reads `gin-indexes.sql` and applies GIN indexes to
 *   JSONB columns, improving full-text and containment query performance.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: postgres (pg driver); DATABASE_URL must be set. Run via
 *   `bun packages/db/src/sql/apply-gin-indexes.ts`. Safe to re-run — SQL uses
 *   CREATE INDEX IF NOT EXISTS.
 */
import postgres from 'postgres'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill in your connection string.')
  process.exit(1)
}

const sql = postgres(url)

const script = readFileSync(join(import.meta.dir, 'gin-indexes.sql'), 'utf8')

console.log('Applying GIN indexes...')
await sql.unsafe(script)
console.log('✓ GIN indexes applied')

await sql.end()
