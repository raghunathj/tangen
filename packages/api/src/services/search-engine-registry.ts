/**
 * File Name: search-engine-registry.ts
 * Purpose: Build the content-search engine for this process.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: One engine ships - PostgreSQL, in the database Tangen
 *   already requires. There is no engine setting, because there is nothing to
 *   choose between; a deployment that could not run PostgreSQL could not run
 *   Tangen at all.
 *
 *   The seam above this stays deliberately: `SearchEngine` is a contract, not a
 *   description of PostgreSQL, so a future ParadeDB or Typesense provider slots
 *   in without any caller changing. The tests prove that with a fake engine,
 *   which is what a second implementation is actually for.
 */
import { getLogger } from '@tangen/logging'
import type { SearchEngine } from './search-engine'
import { PostgresSearchEngine } from './postgres-search-engine'
import { searchGovernor } from './search-governor'

const logger = getLogger(['tangen', 'api', 'search'])

/**
 * Typo tolerance needs pg_trgm and is opt-in: measured at a million documents
 * it cost 36% of write throughput and 175% more WAL than the full-text index it
 * accompanied. Only the exact string `true` turns it on.
 */
export function fuzzyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TANGEN_SEARCH_FUZZY === 'true'
}

let cached: { key: string; engine: SearchEngine } | null = null

/**
 * The engine for this process, built once - it holds no state beyond its
 * database handle, and rebuilding it would only discard the governor's metrics.
 */
export function resolveSearchEngine(
  db: unknown,
  env: Record<string, string | undefined> = process.env,
): SearchEngine {
  const key = String(fuzzyEnabled(env))
  if (cached && cached.key === key) return cached.engine
  const engine = new PostgresSearchEngine(db as never, searchGovernor, fuzzyEnabled(env))
  logger.info(
    `content search engine: ${engine.id}`
    + ` (consistency ${engine.capabilities.consistency}, fuzzy ${engine.capabilities.fuzzy ? 'on' : 'off'})`,
  )
  cached = { key, engine }
  return engine
}

/** Tests build their own engines; this drops the memo between them. */
export function resetSearchEngine(): void { cached = null }
