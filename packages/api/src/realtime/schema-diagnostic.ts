/**
 * File Name: schema-diagnostic.ts
 * Purpose: When a realtime query hits a table that is not there, the error
 *          names the migration that creates it and the step that runs
 *          migrations - never a CREATE TABLE of its own (closure plan
 *          Phase 3, Unit 5: the migrations are the one schema authority).
 *
 * Author: Raghunath J
 * License: MIT
 */
import { getLogger } from '@tangen/logging'

const logger = getLogger(['tangen', 'api', 'realtime'])
const warned = new Set<string>()

/** Does this driver error say a relation is missing? */
export function isMissingRelation(err: unknown, table: string): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null
  const code = e?.code ?? e?.cause?.code
  const message = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`
  return code === '42P01' || new RegExp(`relation "${table}" does not exist`).test(message)
}

/**
 * Rethrows a missing-table error as the operator's diagnostic, logged once
 * per table per process; any other error passes through unchanged.
 */
export function explainMissingRealtimeTable(err: unknown, table: 'realtime_presence' | 'realtime_events', migration: string): never {
  if (!isMissingRelation(err, table)) throw err
  const message = `${table} is missing: Tangen's migrations have not run against this database (migration ${migration} creates it). Start the API with migrations enabled, or run \`bun run db:migrate\` in packages/db. Realtime never creates its own tables.`
  if (!warned.has(table)) { warned.add(table); logger.error(message) }
  throw new Error(message)
}
