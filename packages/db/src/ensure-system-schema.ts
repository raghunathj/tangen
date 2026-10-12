/**
 * File Name: ensure-system-schema.ts
 * Purpose: The idempotent system-schema floor, DERIVED from the canonical
 *          migrations (closure plan, Phase 1 Unit 5). Tangen has one
 *          authoritative definition and evolution path for its system
 *          schema: the drizzle migrations under `drizzle/`. This module
 *          declares nothing of its own. It extracts, mechanically and in
 *          journal order, the statements those migrations already wrote in
 *          an idempotent form (CREATE TABLE / CREATE INDEX / ADD COLUMN ...
 *          IF NOT EXISTS) so a database the migrator could not bring up to
 *          date (no DATABASE_URL, TANGEN_SKIP_MIGRATE=1, a drifted ledger)
 *          still gets the tables and columns the current code reads, as a
 *          best-effort fallback that can never fail a working database.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Runs only when the migrator did not (API boot) or
 *          could not (push): when `runMigrations` succeeded the schema is
 *          current by definition and the floor has nothing to add. Reads the
 *          .sql files the package ships (the same files the migrator runs).
 *          Statements inside DO blocks are not extracted: they are the
 *          conditional path with its own entrypoint (knowledge-schema.ts).
 *          A migration written without IF NOT EXISTS is not derivable and is
 *          therefore only reachable through the migrator - the test lists
 *          what the floor covers so a gap is a visible decision, not a
 *          surprise.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsFolder = join(import.meta.dir, '..', 'drizzle')

/** Splits SQL text into statements, honouring quotes, dollar-quoted blocks and `--` comments. */
export function splitSqlStatements(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  let dollarTag: string | null = null
  while (i < text.length) {
    const ch = text[i]!
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) { cur += dollarTag; i += dollarTag.length; dollarTag = null; continue }
      cur += ch; i++; continue
    }
    if (inSingle) {
      cur += ch
      if (ch === "'") { if (text[i + 1] === "'") { cur += "'"; i += 2; continue } inSingle = false }
      i++; continue
    }
    if (inDouble) { cur += ch; if (ch === '"') inDouble = false; i++; continue }
    if (ch === '-' && text[i + 1] === '-') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue }
    if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 64))
      if (m) { dollarTag = m[0]; cur += m[0]; i += m[0].length; continue }
    }
    if (ch === "'") { inSingle = true; cur += ch; i++; continue }
    if (ch === '"') { inDouble = true; cur += ch; i++; continue }
    if (ch === ';') { const s = cur.trim(); if (s) out.push(s); cur = ''; i++; continue }
    cur += ch; i++
  }
  const tail = cur.trim()
  if (tail) out.push(tail)
  return out
}

/** The statement forms that are idempotent by construction, and so safe to run on any database. */
const IDEMPOTENT = /^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX (CONCURRENTLY )?IF NOT EXISTS|ALTER TABLE\s+(?:"[^"]+"|\w+)\s+ADD COLUMN IF NOT EXISTS)\b/i

/** Tables migration 0051 drops: the Environment model. Never part of the floor. */
const DROPPED_TABLES = new Set(['environments', 'member_env_membership', 'member_env_roles', 'promotion_log'])

/**
 * Migration 0051 removes the Environment column from every table
 * (tasks/remove-environments-programme.md). It runs as one plpgsql block, so
 * the floor cannot extract it - instead every earlier statement is rewritten
 * the way 0051 leaves the table: no env column, the keys, uniques and
 * indexes re-keyed without it (renamed the way 0051 renames them), and the
 * dropped tables absent. Null when the statement has nothing left to say.
 */
export function withoutEnvironmentColumns(stmt: string): string | null {
  const table = /^CREATE TABLE IF NOT EXISTS "?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(stmt)?.[1]
  if (table && DROPPED_TABLES.has(table)) return null
  const indexOn = /^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS "?[A-Za-z0-9_]+"?\s+ON\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(stmt)?.[1]
  if (indexOn && DROPPED_TABLES.has(indexOn)) return null
  const alterOf = /^ALTER TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD COLUMN IF NOT EXISTS "?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(stmt)
  if (alterOf && (DROPPED_TABLES.has(alterOf[1]!) || ENV_COLUMNS.has(alterOf[2]!))) return null
  if (!/env_id/i.test(stmt)) return stmt
  const renameIndex = (name: string) => name.replace(/_env_id(?=_|$)/g, '').replace(/_workspace_env_/g, '_workspace_').replace(/_ws_env_/g, '_ws_').replace(/_env_/g, '_')
  if (table) {
    const open = stmt.indexOf('(')
    const close = stmt.lastIndexOf(')')
    const body = stmt.slice(open + 1, close)
    const parts = splitTopLevel(body).map((p) => p.trim()).filter(Boolean)
    const kept: string[] = []
    for (const part of parts) {
      const col = /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s/.exec(part)?.[1]
      if (col && ENV_COLUMNS.has(col) && !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(part)) continue
      const constraint = /^(CONSTRAINT\s+"?([A-Za-z0-9_]+)"?\s+)?(PRIMARY KEY|UNIQUE)\s*\(([^)]*)\)/i.exec(part)
      if (constraint) {
        const cols = constraint[4]!.split(',').map((c) => c.trim()).filter((c) => !ENV_COLUMNS.has(c.replace(/"/g, '')))
        if (cols.length === 0) continue
        const name = constraint[2] ? `CONSTRAINT "${renameIndex(constraint[2])}" ` : ''
        kept.push(`${name}${constraint[3]}(${cols.join(',')})`)
        continue
      }
      kept.push(part)
    }
    return `${stmt.slice(0, open + 1)}\n\t${kept.join(',\n\t')}\n${stmt.slice(close)}`
  }
  if (indexOn) {
    const m = /^(CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS )"?([A-Za-z0-9_]+)"?(\s+ON\s+"?[A-Za-z_][A-Za-z0-9_]*"?\s*(?:USING\s+\w+\s*)?)\(([\s\S]*)\)([\s\S]*)$/i.exec(stmt)
    if (!m) return null
    const cols = splitTopLevel(m[4]!).map((c) => c.trim()).filter((c) => !ENV_COLUMNS.has(c.replace(/"/g, '')))
    if (cols.length === 0) return null
    return `${m[1]}"${renameIndex(m[2]!)}"${m[3]}(${cols.join(', ')})${m[5] ?? ''}`
  }
  return stmt
}

const ENV_COLUMNS = new Set(['env_id', 'source_env_id', 'target_env_id', 'from_env_id', 'to_env_id'])

/** Splits `a, b(c, d), e` on the commas outside parentheses. */
function splitTopLevel(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/** The floor: every idempotent statement the migrations carry, in journal order, each once, as 0051 leaves it. */
export function deriveSystemSchemaFloor(migrationSql: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const file of migrationSql) {
    for (const raw of splitSqlStatements(file)) {
      if (!IDEMPOTENT.test(raw.replace(/\s+/g, ' '))) continue
      const stmt = withoutEnvironmentColumns(raw)
      if (!stmt) continue
      const key = stmt.replace(/\s+/g, ' ')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(stmt)
    }
  }
  return out
}

/** The migration files in journal order, as the migrator reads them. */
export function readMigrationSql(folder = migrationsFolder): string[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }
  return journal.entries.map((e) => readFileSync(join(folder, `${e.tag}.sql`), 'utf8'))
}

let derived: readonly string[] | null = null

/** The floor for the migrations this package ships (computed once). */
export function systemSchemaFloor(): readonly string[] {
  return (derived ??= deriveSystemSchemaFloor(readMigrationSql()))
}

/** @deprecated The floor is derived; kept as a name for the callers and tests that read it. */
export const SYSTEM_COLUMN_GUARDS: readonly string[] = new Proxy([] as string[], {
  get(_, prop) {
    const list = systemSchemaFloor() as string[]
    const v = (list as unknown as Record<PropertyKey, unknown>)[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(list) : v
  },
  has(_, prop) { return prop in (systemSchemaFloor() as string[]) },
  ownKeys() { return Reflect.ownKeys(systemSchemaFloor() as string[]) },
  getOwnPropertyDescriptor(_, prop) { return Reflect.getOwnPropertyDescriptor(systemSchemaFloor() as string[], prop) },
})

/**
 * Runs the derived floor. Best-effort per statement - a failure on one (a
 * base table absent, an extension the server lacks) never blocks the others
 * or the caller; the migrator is the path that reports errors.
 * @param exec - Runs a raw SQL string against the database.
 */
export async function ensureSystemColumns(
  exec: (sql: string) => Promise<unknown>,
): Promise<void> {
  for (const stmt of systemSchemaFloor()) {
    try { await exec(stmt) } catch { /* base table absent / extension missing / transient - the migrator reconciles */ }
  }
}
